import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import CurrencyInput from '../../components/CurrencyInput'
import Modal from '@shared/components/Modal'
import NfceQrScanner from '../../components/NfceQrScanner'
import QuickNotice from '@shared/components/QuickNotice'
import { Page, PageHeader } from '@ui/components'
import { dataService } from '@shared/services/dataService'
import { importPeNfceData } from '@shared/services/nfceImportService'
import { getSupabaseClient, isSupabaseEnabled } from '@shared/services/supabaseClient'
import { useERPData } from '@shared/store/appStore'
import type { Material, PurchaseRecord } from '@shared/types/erp'
import type { ImportedNfceData } from '@shared/types/nfce'
import type { PageIntentAction } from '@shared/types/ui'
import { getPaymentMethodLabel } from '@shared/data/paymentMethods'
import { hasCameraSupport, isMobileDevice, resolveDeviceId } from '@shared/utils/device'
import { formatCurrency, formatDateShort } from '@shared/utils/format'
import { createId } from '@shared/utils/ids'
import {
  buildPeNfceUrlFromAccessKey,
  extractAccessKeyFromUrl,
  normalizeNfceLabel,
} from '@shared/utils/nfce'
import { adjustProductStock } from '@shared/utils/stock'
import { findStockItemIndex } from '@shared/utils/stockItems'
import { getMaterialUnitLabel } from '@shared/utils/units'

type PurchaseItemForm = {
  id: string
  type: 'material' | 'extra'
  materialId: string
  description: string
  quantity: number
  unitPrice: number
  pricingMode: 'unit' | 'lot'
  total: number
}

type PurchaseForm = {
  date: string
  supplierId: string
  notes: string
  items: PurchaseItemForm[]
  cashboxId: string
}

type NfceImportItemForm = {
  id: string
  originalDescription: string
  description: string
  code?: string
  quantity: number
  unit?: string
  unitPrice: number
  totalPrice: number
  mapping: 'material' | 'produto' | 'uso_interno' | 'ignorar'
  materialId: string
  productId: string
  variantId: string
  lengthM: number
  saveAlias: boolean
  includeInStock: boolean
}

type NfceSaveMode = 'purchase' | 'finance' | 'stock'

const createMaterialItem = (): PurchaseItemForm => ({
  id: createId(),
  type: 'material',
  materialId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  pricingMode: 'unit',
  total: 0,
})

const createExtraItem = (): PurchaseItemForm => ({
  id: createId(),
  type: 'extra',
  materialId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  pricingMode: 'unit',
  total: 0,
})

type ComprasProps = {
  pageIntent?: PageIntentAction
  onConsumeIntent?: () => void
  onNavigate?: (page: string) => void
}

const Compras = ({ pageIntent, onConsumeIntent, onNavigate }: ComprasProps) => {
  const { data, refresh } = useERPData()
  const now = new Date()
  const [status, setStatus] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<PurchaseForm>({
    date: new Date().toISOString().slice(0, 10),
    supplierId: '',
    notes: '',
    items: [createMaterialItem()],
    cashboxId: 'caixa_producao',
  })
  const purchaseFormId = 'compra-form'
  const importFormId = 'nfce-import-form'
  const [filterSupplierId, setFilterSupplierId] = useState('')
  const [filterMaterialId, setFilterMaterialId] = useState('')
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importStep, setImportStep] = useState<'input' | 'scan' | 'review'>('input')
  const [importUrl, setImportUrl] = useState('')
  const [importAccessKey, setImportAccessKey] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [isImportLoading, setIsImportLoading] = useState(false)
  const [importData, setImportData] = useState<ImportedNfceData | null>(null)
  const [importItems, setImportItems] = useState<NfceImportItemForm[]>([])
  const [importSaveMode, setImportSaveMode] = useState<NfceSaveMode>('finance')
  const [importTarget, setImportTarget] = useState<'local' | 'desktop'>('local')
  const deviceIdRef = useRef(resolveDeviceId())
  const importStartRef = useRef<
    (input: { url?: string; accessKey?: string }) => Promise<void>
  >(async () => undefined)
  const bridgeChannelRef = useRef<RealtimeChannel | null>(null)
  const [bridgeId, setBridgeId] = useState<string | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null)

  const suppliers = useMemo(
    () => [...data.fornecedores].sort((a, b) => a.name.localeCompare(b.name)),
    [data.fornecedores],
  )
  const materials = useMemo(
    () => [...data.materiais].sort((a, b) => a.name.localeCompare(b.name)),
    [data.materiais],
  )
  const products = useMemo(
    () => [...data.produtos].sort((a, b) => a.name.localeCompare(b.name)),
    [data.produtos],
  )

  const monthlyExpenses = useMemo(() => {
    return data.financeiro
      .filter((entry) => {
        const entryDate = new Date(entry.createdAt)
        return (
          entry.type === 'saida' &&
          entryDate.getMonth() === now.getMonth() &&
          entryDate.getFullYear() === now.getFullYear()
        )
      })
      .reduce((acc, entry) => acc + entry.amount, 0)
  }, [data.financeiro, now])

  const recentExpenses = useMemo(
    () =>
      [...data.financeiro]
        .filter((entry) => entry.type === 'saida')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [data.financeiro],
  )

  const purchases = useMemo(
    () => [...data.comprasHistorico].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.comprasHistorico],
  )
  const filteredPurchases = useMemo(() => {
    return purchases.filter((purchase) => {
      const supplierMatch = filterSupplierId ? purchase.supplierId === filterSupplierId : true
      const materialMatch = filterMaterialId
        ? purchase.items.some((item) => item.materialId === filterMaterialId)
        : true
      return supplierMatch && materialMatch
    })
  }, [filterMaterialId, filterSupplierId, purchases])

  const openModal = () => {
    setStatus(null)
    setForm({
      date: new Date().toISOString().slice(0, 10),
      supplierId: '',
      notes: '',
      items: materials.length > 0 ? [createMaterialItem()] : [createExtraItem()],
      cashboxId: 'caixa_producao',
    })
    setIsModalOpen(true)
  }

  useEffect(() => {
    if (pageIntent?.type !== 'new') {
      return
    }
    openModal()
    onConsumeIntent?.()
  }, [pageIntent, onConsumeIntent])

  const closeModal = () => {
    setIsModalOpen(false)
  }

  const updateForm = (patch: Partial<PurchaseForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const updateItem = (id: string, patch: Partial<PurchaseItemForm>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  const addMaterialItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, createMaterialItem()] }))
  }

  const addExtraItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, createExtraItem()] }))
  }

  const removeItem = (id: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }))
  }

  const resolveMaterialPrice = (
    material: Material | undefined,
    mode: PurchaseItemForm['pricingMode'],
  ) => {
    if (!material) {
      return 0
    }
    if (mode === 'lot') {
      return material.marketLotPrice ?? material.marketUnitPrice ?? material.cost ?? 0
    }
    return material.marketUnitPrice ?? material.cost ?? 0
  }

  const handleMaterialChange = (id: string, materialId: string) => {
    const material = materials.find((item) => item.id === materialId)
    const current = form.items.find((item) => item.id === id)
    const pricingMode = current?.pricingMode ?? 'unit'
    updateItem(id, {
      materialId,
      unitPrice: resolveMaterialPrice(material, pricingMode),
    })
  }

  const handlePricingModeChange = (id: string, mode: PurchaseItemForm['pricingMode']) => {
    const current = form.items.find((item) => item.id === id)
    const material = materials.find((item) => item.id === current?.materialId)
    updateItem(id, {
      pricingMode: mode,
      unitPrice: resolveMaterialPrice(material, mode),
    })
  }

  const getItemTotal = (item: PurchaseItemForm) => {
    if (item.type === 'extra') {
      return item.total
    }
    return item.quantity * item.unitPrice
  }

  const totalAmount = useMemo(
    () => form.items.reduce((acc, item) => acc + getItemTotal(item), 0),
    [form.items],
  )

  const canScanNfce = isMobileDevice() && hasCameraSupport()
  const canBridgeNfce = isSupabaseEnabled()
  const canSelectImportTarget = canScanNfce && canBridgeNfce
  const shouldSendNfceToDesktop = canSelectImportTarget && importTarget === 'desktop'
  const shouldListenNfceBridge = !canScanNfce && canBridgeNfce

  const getSupplierName = (id?: string) =>
    suppliers.find((supplier) => supplier.id === id)?.name ?? 'Sem fornecedor'

  const buildPurchaseSummary = (purchase: PurchaseRecord) => {
    if (purchase.items.length === 0) {
      return '-'
    }
    const labels = purchase.items.map((item) => item.description)
    if (labels.length <= 2) {
      return labels.join(' + ')
    }
    return `${labels[0]} +${labels.length - 1}`
  }

  const getPurchaseDate = (purchase: PurchaseRecord) =>
    purchase.purchaseDate ? formatDateShort(purchase.purchaseDate) : formatDateShort(purchase.createdAt)

  const parseNfceDate = (value?: string) => {
    if (!value) {
      return ''
    }
    const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!match) {
      return ''
    }
    const [, day, month, year] = match
    return `${year}-${month}-${day}`
  }

  const formatImportIssuedAt = (value?: string) => {
    if (!value) {
      return '-'
    }
    const parsed = parseNfceDate(value)
    return parsed ? formatDateShort(parsed) : value
  }

  const normalizeDocument = (value?: string) => (value ?? '').replace(/\D/g, '')

  const buildImportItems = (imported: ImportedNfceData) => {
    const defaultMapping: NfceImportItemForm['mapping'] = 'uso_interno'
    return imported.items.map((item) => {
      const normalized = normalizeNfceLabel(item.description)
      const alias = data.nfceItemAliases?.find(
        (entry) => entry.normalizedLabel === normalized,
      )
      const mapping = alias?.targetType ?? defaultMapping
      const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1
      const unitPrice =
        Number.isFinite(item.unitPrice) && item.unitPrice > 0
          ? item.unitPrice
          : item.totalPrice > 0
            ? item.totalPrice / quantity
            : 0
      const totalPrice =
        Number.isFinite(item.totalPrice) && item.totalPrice > 0
          ? item.totalPrice
          : quantity * unitPrice
      return {
        id: createId(),
        originalDescription: item.description,
        description: alias?.description ?? item.description,
        code: item.code,
        quantity,
        unit: item.unit,
        unitPrice,
        totalPrice,
        mapping,
        materialId: alias?.materialId ?? '',
        productId: alias?.productId ?? '',
        variantId: alias?.variantId ?? '',
        lengthM: alias?.lengthM ?? 0,
        saveAlias: !alias && (mapping === 'material' || mapping === 'produto'),
        includeInStock: mapping === 'material' || mapping === 'produto',
      }
    })
  }

  const importTotal = useMemo(
    () =>
      importItems
        .filter((item) => item.mapping !== 'ignorar')
        .reduce((acc, item) => acc + item.totalPrice, 0),
    [importItems],
  )

  const resetImportState = () => {
    setImportUrl('')
    setImportAccessKey('')
    setImportStatus(null)
    setBridgeStatus(null)
    setIsImportLoading(false)
    setImportData(null)
    setImportItems([])
    setImportSaveMode('finance')
    setImportTarget((prev) => (canSelectImportTarget ? prev : 'local'))
    setImportStep(canScanNfce ? 'scan' : 'input')
  }

  const openImportModal = () => {
    resetImportState()
    setIsImportOpen(true)
  }

  const closeImportModal = () => {
    setIsImportOpen(false)
    resetImportState()
  }

  useEffect(() => {
    if (!isImportOpen) {
      setBridgeId(null)
      return
    }
    if (!isSupabaseEnabled()) {
      setBridgeId(null)
      return
    }
    if (data.meta?.workspaceId) {
      setBridgeId(data.meta.workspaceId)
      return
    }
    const supabaseClient = getSupabaseClient()
    if (!supabaseClient) {
      setBridgeId(null)
      return
    }
    let active = true
    supabaseClient.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (!active) {
          return
        }
        const user = sessionData.session?.user
        if (!user) {
          setBridgeId(null)
          return
        }
        const workspaceId =
          (user.app_metadata?.workspace_id as string | undefined) ?? user.id
        setBridgeId(workspaceId ?? null)
      })
      .catch(() => {
        if (active) {
          setBridgeId(null)
        }
      })
    return () => {
      active = false
    }
  }, [data.meta?.workspaceId, isImportOpen])

  useEffect(() => {
    if (!isImportOpen || !bridgeId || !isSupabaseEnabled()) {
      return
    }
    const supabaseClient = getSupabaseClient()
    if (!supabaseClient) {
      return
    }
    setBridgeStatus(null)
    const channel = supabaseClient.channel(`nfce_bridge_${bridgeId}`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    })
    bridgeChannelRef.current = channel

    if (!canScanNfce) {
      channel.on('broadcast', { event: 'nfce_qr' }, (payload) => {
        const message =
          payload && typeof payload === 'object'
            ? (payload as { payload?: Record<string, unknown> })
            : null
        const data = (message?.payload ?? message) as
          | {
              url?: string
              accessKey?: string
              deviceId?: string
            }
          | null
        if (!data?.url) {
          return
        }
        if (data.deviceId && data.deviceId === deviceIdRef.current) {
          return
        }
        setImportStatus(null)
        setBridgeStatus('NFC-e recebida do celular.')
        setImportUrl(data.url)
        setImportAccessKey(data.accessKey ?? extractAccessKeyFromUrl(data.url))
        void importStartRef.current({ url: data.url, accessKey: data.accessKey })
      })
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (!canScanNfce) {
          setBridgeStatus('Aguardando leitura do celular.')
        }
        return
      }
      if (status === 'CHANNEL_ERROR') {
        setBridgeStatus('Nao foi possivel conectar ao canal do celular.')
      }
      if (status === 'TIMED_OUT') {
        setBridgeStatus('Conexao com o celular expirou.')
      }
    })

    return () => {
      void supabaseClient.removeChannel(channel)
      if (bridgeChannelRef.current === channel) {
        bridgeChannelRef.current = null
      }
    }
  }, [bridgeId, canScanNfce, isImportOpen])

  const updateImportItem = (id: string, patch: Partial<NfceImportItemForm>) => {
    setImportStatus(null)
    setImportItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const handleImportMappingChange = (
    id: string,
    mapping: NfceImportItemForm['mapping'],
  ) => {
    setImportStatus(null)
    setImportItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item
        }
        if (item.mapping === mapping) {
          return item
        }
        const shouldStock = mapping === 'material' || mapping === 'produto'
        return {
          ...item,
          mapping,
          materialId: mapping === 'material' ? item.materialId : '',
          productId: mapping === 'produto' ? item.productId : '',
          variantId: mapping === 'produto' ? item.variantId : '',
          lengthM: mapping === 'produto' ? item.lengthM : 0,
          saveAlias: shouldStock,
          includeInStock: shouldStock,
        }
      }),
    )
  }

  const handleImportProductChange = (id: string, productId: string) => {
    setImportStatus(null)
    setImportItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item
        }
        const product = products.find((entry) => entry.id === productId)
        const shouldUseVariant =
          product?.unit !== 'metro_linear' && (product?.hasVariants ?? false)
        const firstVariant = shouldUseVariant ? product?.variants?.[0]?.id ?? '' : ''
        const shouldUpdateDescription =
          item.description.trim() === '' ||
          item.description.trim() === item.originalDescription.trim()
        return {
          ...item,
          productId,
          variantId: firstVariant,
          lengthM: product?.unit === 'metro_linear' ? product.length ?? 0 : 0,
          description: shouldUpdateDescription ? product?.name ?? item.description : item.description,
        }
      }),
    )
  }

  const handleImportMaterialChange = (id: string, materialId: string) => {
    setImportStatus(null)
    setImportItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item
        }
        const material = materials.find((entry) => entry.id === materialId)
        const shouldUpdateDescription =
          item.description.trim() === '' ||
          item.description.trim() === item.originalDescription.trim()
        return {
          ...item,
          materialId,
          description: shouldUpdateDescription ? material?.name ?? item.description : item.description,
        }
      }),
    )
  }

  const handleImportVariantChange = (id: string, variantId: string) => {
    setImportStatus(null)
    updateImportItem(id, { variantId })
  }

  const handleImportLengthChange = (id: string, lengthM: number) => {
    setImportStatus(null)
    updateImportItem(id, { lengthM })
  }

  const handleImportStart = async (input: { url?: string; accessKey?: string }) => {
    setImportStatus(null)
    setIsImportLoading(true)
    try {
      const data = await importPeNfceData(input)
      setImportData(data)
      setImportItems(buildImportItems(data))
      setImportStep('review')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao importar NFC-e.'
      setImportStatus(message)
    } finally {
      setIsImportLoading(false)
    }
  }

  useEffect(() => {
    importStartRef.current = handleImportStart
  }, [handleImportStart])

  const sendNfceToDesktop = async (value: string) => {
    if (!canBridgeNfce) {
      setBridgeStatus('Envio para o desktop indisponivel.')
      return false
    }
    if (!bridgeId) {
      setBridgeStatus('Conecte sua conta no desktop para receber a leitura.')
      return false
    }
    const channel = bridgeChannelRef.current
    if (!channel) {
      setBridgeStatus('Nao foi possivel conectar ao desktop.')
      return false
    }
    setImportStatus(null)
    setBridgeStatus('Enviando leitura para o desktop...')
    const response = await channel.send({
      type: 'broadcast',
      event: 'nfce_qr',
      payload: {
        url: value,
        accessKey: extractAccessKeyFromUrl(value),
        deviceId: deviceIdRef.current,
        createdAt: new Date().toISOString(),
      },
    })
    if (response !== 'ok') {
      setBridgeStatus('Nao foi possivel enviar para o desktop.')
      return false
    }
    setBridgeStatus('QR enviado para o desktop. Abra o ERP no computador para importar.')
    setStatus('QR enviado para o desktop. Abra o ERP no computador para importar.')
    closeImportModal()
    return true
  }

  const handleImportSubmit = async () => {
    const trimmedUrl = importUrl.trim()
    const trimmedAccessKey = importAccessKey.trim()
    if (!trimmedUrl && !trimmedAccessKey) {
      setImportStatus('Informe a URL da NFC-e ou a chave de acesso.')
      return
    }
    let resolvedUrl = trimmedUrl
    if (!resolvedUrl && trimmedAccessKey) {
      try {
        const builtUrl = buildPeNfceUrlFromAccessKey(trimmedAccessKey)
        resolvedUrl = builtUrl
        setImportUrl(builtUrl)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Chave de acesso invalida.'
        setImportStatus(message)
        return
      }
    }
    if (shouldSendNfceToDesktop && resolvedUrl) {
      const sent = await sendNfceToDesktop(resolvedUrl)
      if (sent) {
        return
      }
    }
    handleImportStart({ url: resolvedUrl, accessKey: trimmedAccessKey })
  }

  const handleQrScan = async (value: string) => {
    setImportUrl(value)
    setImportAccessKey(extractAccessKeyFromUrl(value))
    if (shouldSendNfceToDesktop) {
      const sent = await sendNfceToDesktop(value)
      if (sent) {
        return
      }
    }
    handleImportStart({ url: value })
  }

  const handleImportConfirm = () => {
    if (!importData) {
      setImportStatus('Nenhuma NFC-e carregada.')
      return
    }

    const payload = dataService.getAll()
    const purchaseDate = parseNfceDate(importData.issuedAt)
    const createdAt = purchaseDate
      ? new Date(purchaseDate).toISOString()
      : new Date().toISOString()
    const supplierName = importData.supplierName?.trim() || 'Fornecedor'
    const supplierDocument = normalizeDocument(importData.supplierDocument) || undefined
    const supplierByDocument = supplierDocument
      ? payload.fornecedores.find(
          (supplier) => normalizeDocument(supplier.document) === supplierDocument,
        )
      : undefined
    const supplierByName = payload.fornecedores.find(
      (supplier) => supplier.name.trim().toLowerCase() === supplierName.toLowerCase(),
    )
    let supplier = supplierByDocument ?? supplierByName

    if (!supplier) {
      supplier = {
        id: createId(),
        name: supplierName,
        document: supplierDocument,
        notes: importData.supplierAddress
          ? `Endereco: ${importData.supplierAddress}`
          : undefined,
        active: true,
      }
      payload.fornecedores = [...payload.fornecedores, supplier]
    }

    const errors: string[] = []
    const purchaseItems: PurchaseRecord['items'] = []
    const shouldUpdateStock = importSaveMode === 'stock'

    importItems.forEach((item) => {
      if (item.mapping === 'ignorar') {
        return
      }
      const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1
      const unitPrice =
        Number.isFinite(item.unitPrice) && item.unitPrice > 0
          ? item.unitPrice
          : item.totalPrice > 0
            ? item.totalPrice / quantity
            : 0
      const total =
        Number.isFinite(item.totalPrice) && item.totalPrice > 0
          ? item.totalPrice
          : quantity * unitPrice

      if (!Number.isFinite(total) || total <= 0) {
        errors.push(`Valor invalido para ${item.originalDescription}.`)
        return
      }

      if (item.mapping === 'material') {
        if (!item.materialId) {
          errors.push(`Selecione o material para ${item.originalDescription}.`)
          return
        }
        const materialIndex = payload.materiais.findIndex(
          (material) => material.id === item.materialId,
        )
        if (materialIndex < 0) {
          errors.push(`Material nao encontrado para ${item.originalDescription}.`)
          return
        }
        const material = payload.materiais[materialIndex]
        purchaseItems.push({
          id: item.id,
          type: 'material',
          materialId: material.id,
          description: material.name,
          quantity,
          unitPrice,
          pricingMode: 'unit',
          total,
        })
        if (shouldUpdateStock && item.includeInStock) {
          payload.materiais[materialIndex] = {
            ...material,
            stock: (material.stock ?? 0) + quantity,
            marketUnitPrice: unitPrice > 0 ? unitPrice : material.marketUnitPrice,
          }
        }
        return
      }

      if (item.mapping === 'produto') {
        if (!item.productId) {
          errors.push(`Selecione o produto para ${item.originalDescription}.`)
          return
        }
        const productIndex = payload.produtos.findIndex(
          (product) => product.id === item.productId,
        )
        if (productIndex < 0) {
          errors.push(`Produto nao encontrado para ${item.originalDescription}.`)
          return
        }
        const product = payload.produtos[productIndex]
        const isLinear = product.unit === 'metro_linear'
        const lengthM = isLinear
          ? item.lengthM > 0
            ? item.lengthM
            : product.length ?? 0
          : 0
        if (isLinear && lengthM <= 0) {
          errors.push(`Informe o comprimento para ${product.name}.`)
          return
        }
        let variantLabel = ''
        let variantId = ''
        if (!isLinear && product.hasVariants) {
          variantId = item.variantId
          const variant = product.variants?.find((entry) => entry.id === variantId)
          if (!variant) {
            errors.push(`Selecione a variacao para ${product.name}.`)
            return
          }
          variantLabel = ` - ${variant.name}`
        }
        const lengthLabel = isLinear ? ` (${lengthM} m)` : ''
        const fallbackDescription = `${product.name}${variantLabel}${lengthLabel}`
        const description = item.description.trim() || fallbackDescription
        purchaseItems.push({
          id: item.id,
          type: 'extra',
          description,
          quantity,
          unitPrice,
          total,
        })
        if (shouldUpdateStock && item.includeInStock) {
          if (isLinear) {
            const stockIndex = findStockItemIndex(payload.stockItems, product.id, lengthM)
            if (stockIndex >= 0) {
              const target = payload.stockItems[stockIndex]
              payload.stockItems[stockIndex] = {
                ...target,
                quantity: (target.quantity ?? 0) + quantity,
                updatedAt: new Date().toISOString(),
              }
            } else {
              payload.stockItems = [
                ...payload.stockItems,
                {
                  id: createId(),
                  productId: product.id,
                  lengthM,
                  unit: 'un',
                  quantity,
                  createdAt: new Date().toISOString(),
                },
              ]
            }
          } else {
            payload.produtos[productIndex] = adjustProductStock(product, variantId, quantity)
          }
        }
        return
      }

      purchaseItems.push({
        id: item.id,
        type: 'extra',
        description: item.description.trim() || item.originalDescription,
        quantity,
        unitPrice,
        total,
      })
    })

    if (errors.length > 0) {
      setImportStatus(errors[0])
      return
    }
    if (purchaseItems.length === 0) {
      setImportStatus('Nenhum item selecionado para importar.')
      return
    }

    const purchaseTotal = purchaseItems.reduce((acc, item) => acc + item.total, 0)
    if (!Number.isFinite(purchaseTotal) || purchaseTotal <= 0) {
      setImportStatus('Total da compra invalido.')
      return
    }

    payload.comprasHistorico = [
      {
        id: createId(),
        supplierId: supplier?.id,
        purchaseDate: purchaseDate || undefined,
        notes: undefined,
        items: purchaseItems,
        total: purchaseTotal,
        createdAt: new Date().toISOString(),
        source: 'nfce',
        accessKey: importData.accessKey,
        sourceUrl: importData.sourceUrl,
        noteNumber: importData.noteNumber,
        noteSeries: importData.noteSeries,
        issuedAt: importData.issuedAt,
        authorizationProtocol: importData.authorizationProtocol,
        paymentMethod: importData.paymentMethod,
        paymentValue: importData.paymentValue,
      },
      ...payload.comprasHistorico,
    ]

    if (importSaveMode !== 'purchase') {
      const paymentAmount =
        importData.paymentValue && importData.paymentValue > 0
          ? importData.paymentValue
          : purchaseTotal
      const cashboxId = 'caixa_producao'
      const noteLabel = importData.noteNumber ? `NFC-e ${importData.noteNumber}` : 'NFC-e'
      const paymentLabel = importData.paymentMethod
        ? ` · ${getPaymentMethodLabel(
            importData.paymentMethod,
            data.tabelas?.paymentMethods,
          )}`
        : ''
      const description = `Compra ${noteLabel} · ${supplierName}${paymentLabel}`
      payload.financeiro = [
        ...payload.financeiro,
        {
          id: createId(),
          type: 'saida',
          description,
          amount: paymentAmount,
          category: 'Compras',
          createdAt,
          cashboxId,
        },
      ]
    }

    if (payload.nfceItemAliases) {
      const now = new Date().toISOString()
      const nextAliases = [...payload.nfceItemAliases]
      const upsertAlias = (alias: (typeof nextAliases)[number]) => {
        const index = nextAliases.findIndex(
          (entry) => entry.normalizedLabel === alias.normalizedLabel,
        )
        if (index >= 0) {
          nextAliases[index] = {
            ...nextAliases[index],
            ...alias,
            id: nextAliases[index].id,
            createdAt: nextAliases[index].createdAt,
          }
        } else {
          nextAliases.push(alias)
        }
      }
      importItems.forEach((item) => {
        if (!item.saveAlias) {
          return
        }
        if (item.mapping === 'material' && item.materialId) {
          const normalizedLabel = normalizeNfceLabel(item.originalDescription)
          if (!normalizedLabel) {
            return
          }
          upsertAlias({
            id: createId(),
            sourceLabel: item.originalDescription,
            normalizedLabel,
            targetType: 'material',
            materialId: item.materialId,
            description: item.description.trim() || item.originalDescription,
            createdAt: now,
          })
        }
        if (item.mapping === 'produto' && item.productId) {
          const normalizedLabel = normalizeNfceLabel(item.originalDescription)
          if (!normalizedLabel) {
            return
          }
          upsertAlias({
            id: createId(),
            sourceLabel: item.originalDescription,
            normalizedLabel,
            targetType: 'produto',
            productId: item.productId,
            variantId: item.variantId || undefined,
            lengthM: item.lengthM > 0 ? item.lengthM : undefined,
            description: item.description.trim() || item.originalDescription,
            createdAt: now,
          })
        }
      })
      payload.nfceItemAliases = nextAliases
    }

    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: 'Compra NFC-e importada',
        description: `${supplierName} · ${formatCurrency(purchaseTotal)}`,
      },
    })
    refresh()
    setStatus('Compra importada com sucesso.')
    closeImportModal()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (form.items.length === 0) {
      setStatus('Adicione pelo menos um item na compra.')
      return
    }

    for (const item of form.items) {
      if (item.type === 'material') {
        if (!item.materialId) {
          setStatus('Selecione o material em todos os itens de compra.')
          return
        }
        if (item.quantity <= 0 || item.unitPrice <= 0) {
          setStatus('Informe quantidade e valor validos para os materiais.')
          return
        }
      } else {
        if (!item.description.trim()) {
          setStatus('Descreva os itens avulsos.')
          return
        }
        if (item.total <= 0) {
          setStatus('Informe o valor total dos itens avulsos.')
          return
        }
      }
    }

    if (totalAmount <= 0) {
      setStatus('O total da compra deve ser maior que zero.')
      return
    }

    const payload = dataService.getAll()
    const createdAt = form.date ? new Date(form.date).toISOString() : new Date().toISOString()
    const supplier = form.supplierId
      ? suppliers.find((item) => item.id === form.supplierId)
      : undefined

    const purchaseItems: PurchaseRecord['items'] = form.items.map((item) => {
      if (item.type === 'material') {
        const material = payload.materiais.find((material) => material.id === item.materialId)
        return {
          id: item.id,
          type: 'material',
          materialId: item.materialId,
          description: material?.name ?? 'Material',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          pricingMode: item.pricingMode,
          total: item.quantity * item.unitPrice,
        }
      }
      return {
        id: item.id,
        type: 'extra',
        description: item.description.trim(),
        total: item.total,
      }
    })

    payload.materiais = payload.materiais.map((material) => {
      const updates = purchaseItems.filter(
        (item) => item.type === 'material' && item.materialId === material.id,
      )
      if (updates.length === 0) {
        return material
      }
      const latest = updates[updates.length - 1]
      if (latest.type !== 'material') {
        return material
      }
      const lotSize = material.lotSize && material.lotSize > 0 ? material.lotSize : 1
      const addedStock = updates.reduce((acc, item) => {
        if (item.type !== 'material') {
          return acc
        }
        if (item.pricingMode === 'lot') {
          return acc + (item.quantity ?? 0) * lotSize
        }
        return acc + (item.quantity ?? 0)
      }, 0)
      const nextStock = (material.stock ?? 0) + addedStock
      if (latest.pricingMode === 'lot') {
        return {
          ...material,
          stock: nextStock,
          marketLotPrice: latest.unitPrice,
        }
      }
      return {
        ...material,
        stock: nextStock,
        marketUnitPrice: latest.unitPrice,
      }
    })

    const labels = purchaseItems.map((item) => {
      if (item.type === 'material') {
        return `${item.description} x${item.quantity ?? 0}`
      }
      return item.description
    })
    const summary = labels.join(' + ')
    const supplierLabel = supplier ? `Fornecedor: ${supplier.name}. ` : ''
    const notes = form.notes.trim()
    const description = notes
      ? `Compra: ${summary}. ${supplierLabel}${notes}`
      : `Compra: ${summary}. ${supplierLabel}`.trim()

    payload.comprasHistorico = [
      {
        id: createId(),
        supplierId: form.supplierId || undefined,
        purchaseDate: form.date || undefined,
        notes: notes || undefined,
        items: purchaseItems,
        total: totalAmount,
        createdAt: new Date().toISOString(),
      },
      ...payload.comprasHistorico,
    ]
    payload.financeiro = [
      ...payload.financeiro,
      {
        id: createId(),
        type: 'saida',
        description,
        amount: totalAmount,
        category: 'Compras',
        createdAt,
        cashboxId: form.cashboxId || 'caixa_producao',
      },
    ]

    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: 'Compra registrada',
        description: `${summary} · ${formatCurrency(totalAmount)}`,
      },
    })
    refresh()
    setStatus('Compra registrada no financeiro.')
    setIsModalOpen(false)
  }

  return (
    <Page className="compras">
      <PageHeader
        actions={
          <>
            <button className="button button--primary" type="button" onClick={openImportModal}>
              <span
                className="material-symbols-outlined page-header__action-icon"
                aria-hidden="true"
              >
                qr_code_scanner
              </span>
              <span className="page-header__action-label">
                {canScanNfce ? 'Ler QR da nota' : 'Importar NFC-e'}
              </span>
            </button>
            <button className="button button--ghost" type="button" onClick={openModal}>
              <span
                className="material-symbols-outlined page-header__action-icon"
                aria-hidden="true"
              >
                shopping_cart
              </span>
              <span className="page-header__action-label">Registrar compra</span>
            </button>
          </>
        }
      />

      <QuickNotice message={status} onClear={() => setStatus(null)} />

      <div className="summary summary-card">
        <article className="summary__item">
          <span className="summary__label">Fornecedores ativos</span>
          <strong className="summary__value">{suppliers.length}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Materiais cadastrados</span>
          <strong className="summary__value">{materials.length}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Saidas do mes</span>
          <strong className="summary__value">{formatCurrency(monthlyExpenses)}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Solicitacoes em aberto</span>
          <strong className="summary__value">0</strong>
        </article>
      </div>

      <div className="grid grid--two">
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Ultimas despesas</h2>
              <p className="panel__subtitle">Saidas registradas no financeiro</p>
            </div>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onNavigate?.('relatorios-historico')}
            >
              Ver historico completo
            </button>
          </div>
          <div className="list">
            {recentExpenses.length === 0 && (
              <div className="list__empty">Nenhuma despesa registrada.</div>
            )}
            {recentExpenses.map((entry) => (
              <div key={entry.id} className="list__item">
                <div>
                  <strong>{entry.description}</strong>
                  <span className="list__meta">{formatDateShort(entry.createdAt)}</span>
                </div>
                <strong>{formatCurrency(entry.amount)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Fornecedores ativos</h2>
              <p className="panel__subtitle">Principais parceiros de compra</p>
            </div>
          </div>
          <div className="list">
            {suppliers.length === 0 && (
              <div className="list__empty">Nenhum fornecedor cadastrado.</div>
            )}
            {suppliers.slice(0, 6).map((supplier) => (
              <div key={supplier.id} className="list__item">
                <span>{supplier.name}</span>
                <strong>{supplier.city ?? '-'}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel panel--full">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Materiais cadastrados</h2>
            <p className="panel__subtitle">Lista de insumos e unidades</p>
          </div>
        </div>
        <div className="list list--compact">
          {materials.length === 0 && (
            <div className="list__empty">Nenhum material cadastrado.</div>
          )}
          {materials.slice(0, 8).map((material) => (
            <div key={material.id} className="list__item">
              <span>{material.name}</span>
              <strong>
                {getMaterialUnitLabel(material.unit, data.tabelas)}
                {material.marketUnitPrice ? ` • ${formatCurrency(material.marketUnitPrice)}` : ''}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel--full">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Historico de compras</h2>
            <p className="panel__subtitle">Filtro por fornecedor ou material</p>
          </div>
        </div>
        <div className="filters">
          <div className="form__group">
            <label className="form__label" htmlFor="purchase-filter-supplier">
              Fornecedor
            </label>
            <select
              id="purchase-filter-supplier"
              className="form__input"
              value={filterSupplierId}
              onChange={(event) => setFilterSupplierId(event.target.value)}
            >
              <option value="">Todos</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form__group">
            <label className="form__label" htmlFor="purchase-filter-material">
              Material
            </label>
            <select
              id="purchase-filter-material"
              className="form__input"
              value={filterMaterialId}
              onChange={(event) => setFilterMaterialId(event.target.value)}
            >
              <option value="">Todos</option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-card">
          <table className="table">
            <thead className="table__head table__head--mobile-hide">
              <tr>
                <th>Data</th>
                <th>Fornecedor</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Observacoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredPurchases.length === 0 && (
                <tr>
                  <td colSpan={5} className="table__empty">
                    Nenhuma compra encontrada para os filtros selecionados.
                  </td>
                </tr>
              )}
              {filteredPurchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="table__cell--mobile-hide">{getPurchaseDate(purchase)}</td>
                  <td className="table__cell--mobile-hide">
                    {getSupplierName(purchase.supplierId)}
                  </td>
                  <td className="table__cell--truncate">
                    <div className="table__stack">
                      <strong>{buildPurchaseSummary(purchase)}</strong>
                      <span className="table__sub table__sub--mobile">
                        {formatCurrency(purchase.total)}
                      </span>
                    </div>
                  </td>
                  <td className="table__cell--mobile-hide">
                    {formatCurrency(purchase.total)}
                  </td>
                  <td className="table__cell--mobile-hide">{purchase.notes ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={isImportOpen}
        onClose={closeImportModal}
        title={
          importStep === 'review'
            ? 'Conferir NFC-e'
            : canScanNfce
              ? 'Ler NFC-e'
              : 'Importar NFC-e'
        }
        size="lg"
        actions={
          importStep === 'input' ? (
            <button
              className="button button--primary"
              type="submit"
              form={importFormId}
              disabled={isImportLoading}
            >
              <span
                className="material-symbols-outlined modal__action-icon"
                aria-hidden="true"
              >
                search
              </span>
              <span className="modal__action-label">
                {isImportLoading ? 'Importando...' : 'Importar NFC-e'}
              </span>
            </button>
          ) : importStep === 'review' ? (
            <button
              className="button button--primary"
              type="button"
              onClick={handleImportConfirm}
              disabled={isImportLoading}
            >
              <span
                className="material-symbols-outlined modal__action-icon"
                aria-hidden="true"
              >
                save
              </span>
              <span className="modal__action-label">Salvar compra</span>
            </button>
          ) : undefined
        }
      >
        {importStep === 'scan' && (
          <div className="nfce-import">
            <p className="modal__description">
              Aponte a camera para o QR Code da NFC-e.
            </p>
            {canSelectImportTarget && (
              <div className="modal__group">
                <label className="modal__label" htmlFor="nfce-import-target">
                  Destino da importacao
                </label>
                <select
                  id="nfce-import-target"
                  className="modal__input"
                  value={importTarget}
                  onChange={(event) =>
                    setImportTarget(event.target.value as 'local' | 'desktop')
                  }
                >
                  <option value="local">Importar neste celular</option>
                  <option value="desktop">Enviar para o desktop</option>
                </select>
                <p className="modal__help">
                  {importTarget === 'desktop'
                    ? 'A leitura sera enviada para o desktop conectado.'
                    : 'A leitura sera importada neste dispositivo.'}
                </p>
              </div>
            )}
            {!canSelectImportTarget && canScanNfce && (
              <p className="modal__help">A leitura sera importada neste dispositivo.</p>
            )}
            {bridgeStatus && <p className="modal__help">{bridgeStatus}</p>}
            {importStatus && <p className="modal__status">{importStatus}</p>}
            <NfceQrScanner
              onScan={(value) => {
                void handleQrScan(value)
              }}
              onError={(message) => setImportStatus(message)}
              successLabel={
                shouldSendNfceToDesktop
                  ? 'QR Code lido. Enviando para o desktop...'
                  : 'QR Code lido. Importando...'
              }
            />
            <div className="modal__form-actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setImportStatus(null)
                  setImportStep('input')
                }}
              >
                Digitar chave manualmente
              </button>
            </div>
          </div>
        )}

        {importStep === 'input' && (
          <form
            id={importFormId}
            className="nfce-import"
            onSubmit={(event) => {
              event.preventDefault()
              void handleImportSubmit()
            }}
          >
            <p className="modal__description">
              Cole a URL da consulta da NFC-e ou digite a chave de acesso.
            </p>
            {canSelectImportTarget && (
              <div className="modal__group">
                <label className="modal__label" htmlFor="nfce-import-target">
                  Destino da importacao
                </label>
                <select
                  id="nfce-import-target"
                  className="modal__input"
                  value={importTarget}
                  onChange={(event) =>
                    setImportTarget(event.target.value as 'local' | 'desktop')
                  }
                >
                  <option value="local">Importar neste celular</option>
                  <option value="desktop">Enviar para o desktop</option>
                </select>
                <p className="modal__help">
                  {importTarget === 'desktop'
                    ? 'A leitura sera enviada para o desktop conectado.'
                    : 'A leitura sera importada neste dispositivo.'}
                </p>
              </div>
            )}
            {shouldListenNfceBridge && (
              <p className="modal__help">
                {bridgeStatus ??
                  (bridgeId
                    ? 'Abra a leitura no celular e a NFC-e chega aqui automaticamente.'
                    : 'Conectando ao canal para receber do celular...')}
              </p>
            )}
            <div className="modal__group">
              <label className="modal__label" htmlFor="nfce-url">
                URL da NFC-e
              </label>
              <input
                id="nfce-url"
                className="modal__input"
                type="text"
                value={importUrl}
                onChange={(event) => {
                  setImportStatus(null)
                  setImportUrl(event.target.value)
                }}
                placeholder="Cole aqui a URL da consulta"
                disabled={isImportLoading}
              />
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="nfce-access-key">
                Chave de acesso
              </label>
              <input
                id="nfce-access-key"
                className="modal__input"
                type="text"
                value={importAccessKey}
                onChange={(event) => {
                  setImportStatus(null)
                  setImportAccessKey(event.target.value)
                }}
                placeholder="44 numeros da chave de acesso"
                disabled={isImportLoading}
              />
              <p className="modal__help">
                Se informar apenas a chave, a URL sera montada automaticamente.
              </p>
            </div>
            {importStatus && <p className="modal__status">{importStatus}</p>}
            {canScanNfce && (
              <div className="modal__form-actions">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    setImportStatus(null)
                    setImportStep('scan')
                  }}
                  disabled={isImportLoading}
                >
                  Ler QR com a camera
                </button>
              </div>
            )}
          </form>
        )}

        {importStep === 'review' && importData && (
          <div className="nfce-import">
            <div className="nfce-import__header">
              <div>
                <h3 className="nfce-import__title">{importData.supplierName}</h3>
                <p className="nfce-import__meta">
                  {importData.supplierDocument || 'Documento nao informado'}
                </p>
                {importData.supplierAddress && (
                  <p className="nfce-import__meta">{importData.supplierAddress}</p>
                )}
              </div>
              <div className="nfce-import__total">
                <span>Total na nota</span>
                <strong>{formatCurrency(importData.totalAmount)}</strong>
                <span className="nfce-import__meta">
                  Total importado: {formatCurrency(importTotal)}
                </span>
              </div>
            </div>

            {importStatus && <p className="modal__status">{importStatus}</p>}

            <div className="nfce-import__grid">
              <div className="nfce-import__card">
                <span className="nfce-import__label">Nota</span>
                <strong>{importData.noteNumber ?? '-'}</strong>
                <span className="nfce-import__meta">
                  Serie {importData.noteSeries ?? '-'}
                </span>
              </div>
              <div className="nfce-import__card">
                <span className="nfce-import__label">Emissao</span>
                <strong>{formatImportIssuedAt(importData.issuedAt)}</strong>
                <span className="nfce-import__meta">
                  {importData.authorizationProtocol
                    ? `Protocolo ${importData.authorizationProtocol}`
                    : 'Protocolo nao informado'}
                </span>
              </div>
              <div className="nfce-import__card">
                <span className="nfce-import__label">Pagamento</span>
                <strong>
                  {importData.paymentMethod
                    ? getPaymentMethodLabel(
                        importData.paymentMethod,
                        data.tabelas?.paymentMethods,
                      )
                    : 'Nao informado'}
                </strong>
                <span className="nfce-import__meta">
                  {importData.paymentValue
                    ? formatCurrency(importData.paymentValue)
                    : 'Valor nao informado'}
                </span>
              </div>
              <div className="nfce-import__card nfce-import__card--wide">
                <span className="nfce-import__label">Chave</span>
                <strong className="nfce-import__value">
                  {importData.accessKey ?? 'Nao informada'}
                </strong>
              </div>
            </div>

            <div className="nfce-import__items">
              {importItems.map((item, index) => {
                const product = item.productId
                  ? products.find((entry) => entry.id === item.productId)
                  : undefined
                const isLinear = product?.unit === 'metro_linear'
                const showVariant =
                  !!product &&
                  !isLinear &&
                  (product.hasVariants ?? false) &&
                  (product.variants?.length ?? 0) > 0

                return (
                  <div key={item.id} className="nfce-import__item">
                    <div className="nfce-import__item-header">
                      <div>
                        <strong>
                          {index + 1}. {item.originalDescription}
                        </strong>
                        {item.code && (
                          <span className="nfce-import__item-meta">
                            Codigo: {item.code}
                          </span>
                        )}
                        <span className="nfce-import__item-meta">
                          Qtd: {item.quantity} {item.unit ?? ''}
                        </span>
                      </div>
                      <div className="nfce-import__item-total">
                        <span className="nfce-import__item-meta">
                          {formatCurrency(item.unitPrice)} {item.unit ? `/${item.unit}` : ''}
                        </span>
                        <strong>{formatCurrency(item.totalPrice)}</strong>
                      </div>
                    </div>

                    <div className="nfce-import__item-body">
                      <div className="modal__group">
                        <label
                          className="modal__label"
                          htmlFor={`nfce-desc-${item.id}`}
                        >
                          Descricao amigavel
                        </label>
                        <input
                          id={`nfce-desc-${item.id}`}
                          className="modal__input"
                          type="text"
                          value={item.description}
                          onChange={(event) =>
                            updateImportItem(item.id, { description: event.target.value })
                          }
                          placeholder="Descricao para a compra"
                        />
                      </div>
                      <div className="modal__group">
                        <label
                          className="modal__label"
                          htmlFor={`nfce-mapping-${item.id}`}
                        >
                          Destino do item
                        </label>
                        <select
                          id={`nfce-mapping-${item.id}`}
                          className="modal__input"
                          value={item.mapping}
                          onChange={(event) =>
                            handleImportMappingChange(
                              item.id,
                              event.target.value as NfceImportItemForm['mapping'],
                            )
                          }
                        >
                          <option value="material">Material</option>
                          <option value="produto">Produto</option>
                          <option value="uso_interno">Despesa livre / uso interno</option>
                          <option value="ignorar">Ignorar</option>
                        </select>
                      </div>

                      {item.mapping === 'material' && (
                        <div className="modal__group">
                          <label
                            className="modal__label"
                            htmlFor={`nfce-material-${item.id}`}
                          >
                            Material
                          </label>
                          <select
                            id={`nfce-material-${item.id}`}
                            className="modal__input"
                            value={item.materialId}
                            onChange={(event) =>
                              handleImportMaterialChange(item.id, event.target.value)
                            }
                          >
                            <option value="">Selecionar material</option>
                            {materials.map((material) => (
                              <option key={material.id} value={material.id}>
                                {material.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {item.mapping === 'produto' && (
                        <div className="nfce-import__item-grid">
                          <div className="modal__group">
                            <label
                              className="modal__label"
                              htmlFor={`nfce-product-${item.id}`}
                            >
                              Produto
                            </label>
                            <select
                              id={`nfce-product-${item.id}`}
                              className="modal__input"
                              value={item.productId}
                              onChange={(event) =>
                                handleImportProductChange(item.id, event.target.value)
                              }
                            >
                              <option value="">Selecionar produto</option>
                              {products.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {showVariant && (
                            <div className="modal__group">
                              <label
                                className="modal__label"
                                htmlFor={`nfce-variant-${item.id}`}
                              >
                                Variacao
                              </label>
                              <select
                                id={`nfce-variant-${item.id}`}
                                className="modal__input"
                                value={item.variantId}
                                onChange={(event) =>
                                  handleImportVariantChange(item.id, event.target.value)
                                }
                              >
                                <option value="">Selecionar variacao</option>
                                {product?.variants?.map((variant) => (
                                  <option key={variant.id} value={variant.id}>
                                    {variant.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {isLinear && (
                            <div className="modal__group">
                              <label
                                className="modal__label"
                                htmlFor={`nfce-length-${item.id}`}
                              >
                                Comprimento (m)
                              </label>
                              <input
                                id={`nfce-length-${item.id}`}
                                className="modal__input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.lengthM ? item.lengthM : ''}
                                onChange={(event) =>
                                  handleImportLengthChange(
                                    item.id,
                                    Number(event.target.value),
                                  )
                                }
                                placeholder="0"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="nfce-import__item-footer">
                      {(item.mapping === 'material' || item.mapping === 'produto') && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={item.saveAlias}
                            onChange={(event) =>
                              updateImportItem(item.id, {
                                saveAlias: event.target.checked,
                              })
                            }
                          />
                          <span className="toggle__track" aria-hidden="true">
                            <span className="toggle__thumb" />
                          </span>
                          <span className="toggle__label">Salvar alias</span>
                        </label>
                      )}

                      {importSaveMode === 'stock' &&
                        (item.mapping === 'material' || item.mapping === 'produto') && (
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={item.includeInStock}
                              onChange={(event) =>
                                updateImportItem(item.id, {
                                  includeInStock: event.target.checked,
                                })
                              }
                            />
                            <span className="toggle__track" aria-hidden="true">
                              <span className="toggle__thumb" />
                            </span>
                            <span className="toggle__label">Entrar no estoque</span>
                          </label>
                        )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="nfce-import__options">
              <div className="modal__group">
                <label className="modal__label" htmlFor="nfce-save-mode">
                  Salvamento
                </label>
                <select
                  id="nfce-save-mode"
                  className="modal__input"
                  value={importSaveMode}
                  onChange={(event) =>
                    setImportSaveMode(event.target.value as NfceSaveMode)
                  }
                >
                  <option value="purchase">Somente compra</option>
                  <option value="finance">Compra + financeiro</option>
                  <option value="stock">Compra + financeiro + estoque</option>
                </select>
              </div>
              <div className="nfce-import__summary">
                <span>Total a salvar</span>
                <strong>{formatCurrency(importTotal)}</strong>
              </div>
            </div>

            <div className="modal__form-actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => resetImportState()}
              >
                Importar outra NFC-e
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        title="Registrar compra"
        size="lg"
        actions={
          <button className="button button--primary" type="submit" form={purchaseFormId}>
            <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
              save
            </span>
            <span className="modal__action-label">Registrar compra</span>
          </button>
        }
      >
        <form id={purchaseFormId} className="modal__form" onSubmit={handleSubmit}>
          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="purchase-date">
                Data da compra
              </label>
              <input
                id="purchase-date"
                className="modal__input"
                type="date"
                value={form.date}
                onChange={(event) => updateForm({ date: event.target.value })}
              />
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="purchase-supplier">
                Fornecedor
              </label>
              <select
                id="purchase-supplier"
                className="modal__input"
                value={form.supplierId}
                onChange={(event) => updateForm({ supplierId: event.target.value })}
              >
                <option value="">Selecionar fornecedor</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="modal__form-actions">
            <button className="button button--ghost" type="button" onClick={addMaterialItem}>
              Adicionar material
            </button>
            <button className="button button--ghost" type="button" onClick={addExtraItem}>
              Adicionar item livre
            </button>
          </div>

          {form.items.map((item, index) => {
            const material = materials.find((value) => value.id === item.materialId)
            const unitLabel = material?.unit ?? 'unid.'
            const lotLabel = material?.lotSize
              ? `1 lote = ${material.lotSize} ${unitLabel}`
              : 'Lote sem tamanho definido'
            const lineTotal = getItemTotal(item)
            return (
              <div key={item.id} className="modal__section">
                <div className="modal__form-actions">
                  <strong>{item.type === 'material' ? `Material ${index + 1}` : `Item livre ${index + 1}`}</strong>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={form.items.length === 1}
                  >
                    Remover
                  </button>
                </div>

                {item.type === 'material' ? (
                  <>
                    <div className="modal__group">
                      <label className="modal__label" htmlFor={`purchase-material-${item.id}`}>
                        Material
                      </label>
                      <select
                        id={`purchase-material-${item.id}`}
                        className="modal__input"
                        value={item.materialId}
                        onChange={(event) => handleMaterialChange(item.id, event.target.value)}
                      >
                        <option value="">Selecionar material</option>
                        {materials.map((material) => (
                          <option key={material.id} value={material.id}>
                            {material.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="modal__row">
                      <div className="modal__group">
                        <label className="modal__label" htmlFor={`purchase-quantity-${item.id}`}>
                          Quantidade
                        </label> 
                        <input
                          id={`purchase-quantity-${item.id}`}
                          className="modal__input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.id, { quantity: Number(event.target.value) })
                          }
                        />
                      </div>
                      <div className="modal__group">
                        <label className="modal__label" htmlFor={`purchase-mode-${item.id}`}>
                          Base de preco
                        </label>
                        <select
                          id={`purchase-mode-${item.id}`}
                          className="modal__input"
                          value={item.pricingMode}
                          onChange={(event) =>
                            handlePricingModeChange(
                              item.id,
                              event.target.value as PurchaseItemForm['pricingMode'],
                            )
                          }
                        >
                          <option value="unit">Por unidade</option>
                          <option value="lot">Por lote</option>
                        </select>
                        {item.pricingMode === 'lot' && (
                          <p className="modal__help">{lotLabel}</p>
                        )}
                      </div>
                    </div>

                    <div className="modal__row">
                      <div className="modal__group">
                        <label className="modal__label" htmlFor={`purchase-price-${item.id}`}>
                          Valor {item.pricingMode === 'lot' ? 'por lote' : `por ${unitLabel}`}
                        </label>
                        <CurrencyInput
                          id={`purchase-price-${item.id}`}
                          className="modal__input"
                          value={item.unitPrice}
                          onValueChange={(value) =>
                            updateItem(item.id, { unitPrice: value ?? 0 })
                          }
                        />
                      </div>
                      <div className="modal__group">
                        <label className="modal__label">Total do item</label>
                        <div className="summary">
                          <strong>{formatCurrency(lineTotal)}</strong>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="modal__group">
                      <label className="modal__label" htmlFor={`purchase-extra-${item.id}`}>
                        Descricao do item
                      </label>
                      <input
                        id={`purchase-extra-${item.id}`}
                        className="modal__input"
                        type="text"
                        value={item.description}
                        onChange={(event) => updateItem(item.id, { description: event.target.value })}
                        placeholder="Ex: Lanche equipe, etiquetas"
                      />
                    </div>
                    <div className="modal__group">
                      <label className="modal__label" htmlFor={`purchase-extra-total-${item.id}`}>
                        Valor total
                      </label>
                      <CurrencyInput
                        id={`purchase-extra-total-${item.id}`}
                        className="modal__input"
                        value={item.total}
                        onValueChange={(value) =>
                          updateItem(item.id, { total: value ?? 0 })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="purchase-cashbox">
                Debitar de qual Caixa?
              </label>
              <select
                id="purchase-cashbox"
                className="modal__input"
                value={form.cashboxId}
                onChange={(event) => updateForm({ cashboxId: event.target.value })}
              >
                <option value="caixa_producao">Caixa de Producao (Padrao)</option>
                <option value="caixa_lucro">Caixa de Lucro</option>
                {data.caixas?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="purchase-notes">
                Observacoes
              </label>
              <textarea
                id="purchase-notes"
                className="modal__input modal__textarea"
                style={{ minHeight: '44px' }}
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                placeholder="Detalhes adicionais"
              />
            </div>
          </div>

          <div className="summary">
            <span>Total da compra</span>
            <strong>{formatCurrency(totalAmount)}</strong>
          </div>

        </form>
      </Modal>
    </Page>
  )
}

export default Compras
