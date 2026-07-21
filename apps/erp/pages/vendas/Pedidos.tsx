import { useEffect, useMemo, useState, type FormEvent } from 'react'
import ActionMenu from '../../components/ActionMenu'
import ConfirmDialog from '../../components/ConfirmDialog'
import CurrencyInput from '../../components/CurrencyInput'
import DimensionInput from '@shared/components/DimensionInput'
import Modal from '@shared/components/Modal'
import QuickNotice from '@shared/components/QuickNotice'
import logotipo from '@shared/assets/brand/logotipo.svg'
import { Page, PageHeader } from '@ui/components'
import {
  getPaymentCashboxId,
  getPaymentMethodId,
  getPaymentMethodLabel,
  getPaymentMethodOptions,
} from '@shared/data/paymentMethods'
import { dataService } from '@shared/services/dataService'
import { buildTrackingPayloads } from '@shared/services/trackingPayload'
import { trackingRemote } from '@shared/services/trackingRemote'
import { useERPData } from '@shared/store/appStore'
import type { Client, FulfillmentMode, Order, ProductVariant, ProductionOrder } from '@shared/types/erp'
import { formatCurrency, formatDateShort } from '@shared/utils/format'
import { createId } from '@shared/utils/ids'
import {
  resolveOrderCode,
  resolveOrderInternalCode,
  resolveOrderPublicCode,
} from '@shared/utils/orderCode'
import {
  getBaseCost,
  getLaborUnitCost,
  getMaxDiscountSummary,
  getMinUnitPrice,
} from '@shared/utils/pricing'
import {
  resolveUnitPrice as resolveUnitPriceBase,
  resolveVariantPrice as resolveVariantPriceBase,
} from '@shared/utils/sales'
import { findStockItem, findStockItemIndex } from '@shared/utils/stockItems'
import { getProductUnitLabel } from '@shared/utils/units'

type OrderItemForm = {
  productId: string
  variantId: string
  quantity: number
  unitPrice: number
  customLength: number
  customWidth: number
  customHeight: number
}

type OrderPaymentForm = {
  id: string
  amount: number
  receivedAt: string
}

type OrderForm = {
  clientId: string
  clientName: string
  obraId: string
  items: OrderItemForm[]
  payments: OrderPaymentForm[]
  paymentMethod: string
  discountType: '' | 'percent' | 'value'
  discountValue: number
  discountPercent: string
  status: Order['status']
  fulfillment: FulfillmentMode
}

const statusLabels: Record<Order['status'], string> = {
  aguardando_pagamento: 'Aguardando',
  pago: 'Pago',
  em_producao: 'Em producao',
  entregue: 'Entregue',
}

const TRACKING_BASE_URL =
  (import.meta.env.VITE_TRACKING_BASE_URL as string | undefined) ||
  'https://rastreio.umoya.ind.br'

const buildTrackingLink = (orderCode: string) =>
  `${TRACKING_BASE_URL.replace(/\/+$/, '')}/${orderCode}`

const createEmptyItem = (): OrderItemForm => ({
  productId: '',
  variantId: '',
  quantity: 1,
  unitPrice: 0,
  customLength: 0,
  customWidth: 0,
  customHeight: 0,
})

const createEmptyPayment = (): OrderPaymentForm => ({
  id: createId(),
  amount: 0,
  receivedAt: new Date().toISOString().slice(0, 10),
})

type PedidosProps = {
  openOrderId?: string
  onConsumeOpen?: () => void
}

const Pedidos = ({ openOrderId, onConsumeOpen }: PedidosProps) => {
  const { data, refresh } = useERPData()
  const [status, setStatus] = useState<string | null>(null)
  const [trackingLink, setTrackingLink] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [printId, setPrintId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<OrderForm>({
    clientId: '',
    clientName: '',
    obraId: '',
    items: [createEmptyItem()],
    payments: [],
    paymentMethod: 'a_definir',
    discountType: '',
    discountValue: 0,
    discountPercent: '',
    status: 'aguardando_pagamento',
    fulfillment: 'producao',
  })
  const orderFormId = 'pedido-form'

  const paymentOptions = useMemo(
    () => getPaymentMethodOptions(data.tabelas?.paymentMethods),
    [data.tabelas?.paymentMethods],
  )

  const subtotal = useMemo(
    () => form.items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0),
    [form.items],
  )
  const pricingItems = useMemo(
    () =>
      form.items
        .map((item) => {
          const product = data.produtos.find((entry) => entry.id === item.productId)
          if (!product) {
            return null
          }
          const variant = product.variants?.find((entry) => entry.id === item.variantId)
          return {
            product,
            variant,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            customLength: item.customLength,
            customWidth: item.customWidth,
          }
        })
        .filter((item): item is NonNullable<typeof item> => !!item),
    [data.produtos, form.items],
  )
  const discountSummary = useMemo(
    () => getMaxDiscountSummary(pricingItems, data.materiais),
    [pricingItems, data.materiais],
  )
  const maxDiscountPercent = discountSummary.maxDiscountPercent
  const maxDiscountValue = Math.min(discountSummary.maxDiscountValue, subtotal)
  const parsedDiscountPercent = form.discountPercent.trim()
    ? Number(form.discountPercent.replace(',', '.'))
    : 0
  const safeDiscountValue = Number.isFinite(form.discountValue) ? form.discountValue : 0
  const safeDiscountPercent = Number.isNaN(parsedDiscountPercent) ? 0 : parsedDiscountPercent
  const rawDiscount =
    form.discountType === 'percent'
      ? subtotal * (safeDiscountPercent / 100)
      : form.discountType === 'value'
        ? safeDiscountValue
        : 0
  const appliedDiscount = Math.min(rawDiscount, maxDiscountValue)
  const total = Math.max(subtotal - appliedDiscount, 0)
  const appliedDiscountPercent = subtotal > 0 ? (appliedDiscount / subtotal) * 100 : 0
  const costSummary = useMemo(
    () =>
      pricingItems.reduce(
        (acc, item) => {
          const baseUnitCost = getBaseCost(item.product, item.variant, {
            materials: data.materiais,
            customLength: item.customLength,
            customWidth: item.customWidth,
          })
          const laborUnitCost = getLaborUnitCost(
            item.product,
            item.variant,
            item.customLength,
          )
          const quantity = item.quantity
          acc.base += baseUnitCost * quantity
          acc.labor += laborUnitCost * quantity
          return acc
        },
        { base: 0, labor: 0 },
      ),
    [data.materiais, pricingItems],
  )
  const estimatedCost = costSummary.base + costSummary.labor
  const estimatedProfit = total - estimatedCost
  const estimatedMargin = total > 0 ? (estimatedProfit / total) * 100 : 0
  const paymentsTotal = useMemo(
    () => form.payments.reduce((acc, payment) => acc + payment.amount, 0),
    [form.payments],
  )
  const remainingBalance = Math.max(total - paymentsTotal, 0)
  const overpaidAmount = Math.max(paymentsTotal - total, 0)
  const orderSummary = useMemo(() => {
    return data.pedidos.reduce(
      (acc, order) => {
        acc.total += 1
        if (order.status === 'aguardando_pagamento') {
          acc.awaiting += 1
        }
        if (order.status === 'em_producao') {
          acc.inProduction += 1
        }
        if (order.status !== 'aguardando_pagamento') {
          acc.confirmedValue += order.total
        }
        return acc
      },
      { total: 0, awaiting: 0, inProduction: 0, confirmedValue: 0 },
    )
  }, [data.pedidos])
  const availableProducts = data.produtos.filter((product) => product.active !== false)
  const hasProducts = availableProducts.length > 0
  const availableClients = useMemo(
    () => [...data.clientes].sort((a, b) => a.name.localeCompare(b.name)),
    [data.clientes],
  )
  const selectedClient = form.clientId
    ? data.clientes.find((client) => client.id === form.clientId)
    : null
  const clientObras = selectedClient?.obras ?? []
  const trackingLinkNotice = useMemo(() => {
    if (!trackingLink) {
      return null
    }
    return (
      <>
        Link de rastreio:{' '}
        <a href={trackingLink} target="_blank" rel="noreferrer">
          {trackingLink}
        </a>
      </>
    )
  }, [trackingLink])

  const updateForm = (patch: Partial<OrderForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const copyTrackingLink = async (order: Order) => {
    const orderCode = resolveOrderPublicCode(order)
    const link = buildTrackingLink(orderCode)
    setTrackingLink(link)
    const workspaceId = data.meta?.workspaceId
    if (workspaceId) {
      const snapshot = dataService.getAll()
      const trackingPayload = buildTrackingPayloads(snapshot).find(
        (entry) => entry.orderId === order.id,
      )
      if (trackingPayload) {
        void trackingRemote.upsertOrders(workspaceId, [trackingPayload])
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link)
        setStatus('Link de rastreio copiado.')
        return
      } catch {
        // fallback below
      }
    }
    setStatus('Link de rastreio gerado. Copie abaixo.')
  }

  const toLengthCmLabel = (lengthMeters: number) => {
    const cm = Math.round(lengthMeters * 100)
    return cm > 0 ? cm : 0
  }

  const upsertLinearStockVariant = (
    product: (typeof data.produtos)[number],
    lengthMeters: number,
    quantityDelta: number,
  ) => {
    const length = Number.isFinite(lengthMeters) && lengthMeters > 0 ? lengthMeters : 1
    const lengthCm = toLengthCmLabel(length)
    const variantId = `auto-${product.id}-${lengthCm}`
    const baseSku = product.sku?.trim()
    const variantSku = baseSku ? `${baseSku}-${lengthCm}` : undefined
    const variants = product.variants ?? []
    const targetIndex = variants.findIndex(
      (variant) =>
        variant.id === variantId ||
        (variant.locked &&
          Number.isFinite(variant.length) &&
          Math.abs((variant.length ?? 0) - length) < 0.0001),
    )
    if (targetIndex >= 0) {
      const target = variants[targetIndex]
      const nextStock = (target.stock ?? 0) + quantityDelta
      const updated = {
        ...target,
        stock: nextStock,
        name: target.name || `${lengthCm}`,
        length,
        sku: variantSku ?? target.sku,
        active: target.active ?? true,
        locked: true,
      }
      return {
        ...product,
        variants: variants.map((variant, index) =>
          index === targetIndex ? updated : variant,
        ),
      }
    }
    const nextVariant = {
      id: variantId,
      productId: product.id,
      name: `${lengthCm}`,
      length,
      stock: quantityDelta,
      sku: variantSku,
      active: true,
      locked: true,
      isCustom: true,
    }
    return {
      ...product,
      variants: [...variants, nextVariant],
    }
  }

  const updateItem = (index: number, patch: Partial<OrderItemForm>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    }))
  }

  const addItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, createEmptyItem()] }))
  }

  const removeItem = (index: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }))
  }

  const updatePayment = (index: number, patch: Partial<OrderPaymentForm>) => {
    setForm((prev) => ({
      ...prev,
      payments: prev.payments.map((payment, idx) =>
        idx === index ? { ...payment, ...patch } : payment,
      ),
    }))
  }

  const addPayment = () => {
    setForm((prev) => ({
      ...prev,
      payments: [...prev.payments, createEmptyPayment()],
    }))
  }

  const removePayment = (index: number) => {
    setForm((prev) => ({
      ...prev,
      payments: prev.payments.filter((_, idx) => idx !== index),
    }))
  }

  const resetForm = () => {
    setForm({
      clientId: '',
      clientName: '',
      obraId: '',
      items: [createEmptyItem()],
      payments: [],
      paymentMethod: 'a_definir',
      discountType: '',
      discountValue: 0,
      discountPercent: '',
      status: 'aguardando_pagamento',
      fulfillment: 'producao',
    })
    setEditingId(null)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setStatus(null)
    resetForm()
  }

  const openNewModal = () => {
    setStatus(null)
    resetForm()
    setIsModalOpen(true)
  }

  const normalize = (value: string) => value.trim().toLowerCase()

  const findOrCreateClient = (name: string, clients: Client[]) => {
    const normalized = normalize(name)
    const existing = clients.find((client) => normalize(client.name) === normalized)
    if (existing) {
      return existing
    }
    const next: Client = {
      id: createId(),
      name: name.trim(),
    }
    clients.push(next)
    return next
  }

  const resolveVariantPrice = (
    product: (typeof data.produtos)[number] | null,
    variantId: string,
  ) => resolveVariantPriceBase(product, variantId)

  const resolveUnitPrice = (
    product: (typeof data.produtos)[number] | null,
    variant?: ProductVariant,
    item?: OrderItemForm,
  ) => resolveUnitPriceBase(product, variant, item)

  const validatePriceRules = (
    item: OrderItemForm,
    product: (typeof data.produtos)[number],
    variant?: ProductVariant,
  ) => {
    const minPrice = getMinUnitPrice(product, variant, {
      materials: data.materiais,
      customLength: item.customLength,
      customWidth: item.customWidth,
    })
    if (item.unitPrice < minPrice) {
      return `Valor unitario abaixo do minimo sem prejuizo (${formatCurrency(minPrice)}).`
    }
    return null
  }

  const handleProductChange = (index: number, productId: string) => {
    const product = data.produtos.find((item) => item.id === productId)
    if (product?.unit === 'metro_linear') {
      const baseLength = product.length && product.length > 0 ? product.length : 1
      updateItem(index, {
        productId,
        variantId: '',
        customLength: baseLength,
        customWidth: 0,
        customHeight: 0,
        unitPrice: resolveUnitPrice(product, undefined, {
          ...form.items[index],
          customLength: baseLength,
        }),
      })
      return
    }
    if (product && !product.hasVariants) {
      updateItem(index, {
        productId,
        variantId: '',
        customLength: 0,
        customWidth: 0,
        customHeight: 0,
        unitPrice: resolveUnitPrice(product, undefined, form.items[index]),
      })
      return
    }
    const firstVariant = product?.variants?.[0]
    const nextVariantId = firstVariant?.id ?? 'custom'
    updateItem(index, {
      productId,
      variantId: nextVariantId,
      unitPrice: product ? resolveVariantPrice(product, nextVariantId) : 0,
      customLength: 0,
      customWidth: 0,
      customHeight: 0,
    })
  }

  const handleVariantChange = (index: number, variantId: string) => {
    const product = data.produtos.find((item) => item.id === form.items[index]?.productId)
    if (product?.unit === 'metro_linear') {
      updateItem(index, {
        variantId: '',
        unitPrice: resolveUnitPrice(product, undefined, form.items[index]),
      })
      return
    }
    if (product && !product.hasVariants) {
      updateItem(index, {
        variantId: '',
        unitPrice: resolveUnitPrice(product, undefined, form.items[index]),
      })
      return
    }
    if (variantId === 'custom') {
      updateItem(index, {
        variantId,
        unitPrice: product?.price ?? 0,
      })
      return
    }
    updateItem(index, {
      variantId,
      unitPrice: resolveVariantPrice(product ?? null, variantId),
    })
  }

  const handleLinearLengthChange = (index: number, lengthMeters: number) => {
    const product = data.produtos.find((item) => item.id === form.items[index]?.productId)
    updateItem(index, {
      customLength: lengthMeters,
      unitPrice: resolveUnitPrice(product ?? null, undefined, {
        ...form.items[index],
        customLength: lengthMeters,
      }),
    })
  }

  const buildCustomVariantName = (item: OrderItemForm) => {
    const parts = [item.customLength, item.customWidth, item.customHeight]
      .filter((value) => value > 0)
      .map((value) => value.toString())
    if (parts.length === 0) {
      return 'Personalizada'
    }
    return `Personalizada ${parts.join('x')}`
  }

  const ensureCustomVariant = (
    product: { id: string; variants?: ProductVariant[] },
    item: OrderItemForm,
  ) => {
    const hasDimensions =
      item.customLength > 0 || item.customWidth > 0 || item.customHeight > 0
    if (!hasDimensions) {
      return { error: 'Informe as medidas para a variacao personalizada.' }
    }
    const variant: ProductVariant = {
      id: createId(),
      productId: product.id,
      name: buildCustomVariantName(item),
      length: item.customLength || undefined,
      width: item.customWidth || undefined,
      height: item.customHeight || undefined,
      stock: 0,
      priceOverride: undefined,
      isCustom: true,
    }

    product.variants = [...(product.variants ?? []), variant]
    return { variant }
  }

  const buildProductionKey = (value: {
    productId: string
    variantId?: string
    customLength?: number
  }) => {
    const lengthKey =
      value.customLength && value.customLength > 0 ? value.customLength.toFixed(4) : ''
    return `${value.productId}:${value.variantId ?? ''}:${lengthKey}`
  }

  const applyOrderUpdate = (payload: ReturnType<typeof dataService.getAll>, nextOrder: Order, previousOrder?: Order) => {
    const fulfillment = nextOrder.fulfillment ?? 'producao'
    if (fulfillment === 'estoque' && nextOrder.status === 'em_producao') {
      return { error: 'Pedidos de estoque nao entram em producao.' }
    }
    const movingToProduction =
      fulfillment !== 'estoque' &&
      (nextOrder.status === 'em_producao' || nextOrder.status === 'entregue')
    const paymentsTotal = (nextOrder.payments ?? []).reduce(
      (acc, payment) => acc + (Number.isFinite(payment.amount) ? payment.amount : 0),
      0,
    )
    const hasPayments = paymentsTotal > 0
    if (
      movingToProduction &&
      (!previousOrder || previousOrder.status === 'aguardando_pagamento') &&
      nextOrder.status !== 'pago' &&
      !hasPayments
    ) {
      return { error: 'O pedido precisa ter recebimento para iniciar a producao.' }
    }
    if (nextOrder.status === 'pago' && (!nextOrder.paymentMethod || nextOrder.paymentMethod === 'a_definir')) {
      return { error: 'Defina a forma de pagamento antes de marcar como pago.' }
    }

    const existingProductions: ProductionOrder[] = payload.ordensProducao.filter(
      (production) => production.orderId === nextOrder.id,
    )


    if (
      fulfillment !== 'estoque' &&
      nextOrder.status === 'entregue' &&
      previousOrder?.status !== 'entregue'
    ) {
      const allFinalized =
        existingProductions.length > 0 &&
        existingProductions.every((production) => production.status === 'CONCLUIDA')
      if (!allFinalized) {
        return { error: 'Finalize todas as ordens de producao antes de entregar.' }
      }

      for (const item of nextOrder.items) {
        const product = payload.produtos.find((current) => current.id === item.productId)
        if (!product) {
          return { error: 'Produto nao encontrado para entrega.' }
        }
        if (product.unit === 'metro_linear') {
          const length = item.customLength ?? product.length ?? 1
          const stockItem = findStockItem(payload.stockItems, product.id, length)
          if (stockItem) {
            if ((stockItem.quantity ?? 0) < item.quantity) {
              return { error: 'Estoque insuficiente para entregar este pedido.' }
            }
            continue
          }
          const lengthCm = toLengthCmLabel(length)
          const targetVariant = (product.variants ?? []).find(
            (variant) =>
              variant.id === `auto-${product.id}-${lengthCm}` ||
              (variant.locked &&
                Number.isFinite(variant.length) &&
                Math.abs((variant.length ?? 0) - length) < 0.0001),
          )
          if (!targetVariant || (targetVariant.stock ?? 0) < item.quantity) {
            return { error: 'Estoque insuficiente para entregar este pedido.' }
          }
          continue
        }
        if (!product.hasVariants) {
          if ((product.stock ?? 0) < item.quantity) {
            return { error: 'Estoque insuficiente para entregar este pedido.' }
          }
          continue
        }
        const variant = product.variants?.find((current) => current.id === item.variantId)
        if (!variant) {
          return { error: 'Variacao nao encontrada para entrega.' }
        }
        if ((variant.stock ?? 0) < item.quantity) {
          return { error: 'Estoque insuficiente para entregar este pedido.' }
        }
      }
    }

    payload.pedidos = payload.pedidos.map((item) => (item.id === nextOrder.id ? nextOrder : item))

    if (!previousOrder) {
      payload.pedidos = [...payload.pedidos, nextOrder]
    }

    const cashboxId = getPaymentCashboxId(
      nextOrder.paymentMethod,
      data.tabelas?.paymentMethods,
    )
    const nextPayments = nextOrder.payments ?? []
    const previousPayments = previousOrder?.payments ?? []

    if (nextPayments.length > 0 || previousPayments.length > 0) {
      const previousById = new Map(previousPayments.map((payment) => [payment.id, payment]))
      const nextById = new Map(nextPayments.map((payment) => [payment.id, payment]))
      const orderLabel = nextOrder.id.slice(0, 8)
      const paymentDescription = `Recebimento pedido ${orderLabel}`
      const paymentAdjustmentDescription = `Ajuste recebimento pedido ${orderLabel}`
      const paymentReversalDescription = `Estorno recebimento pedido ${orderLabel}`
      const paymentEntries: typeof payload.financeiro = []
      const pushPaymentEntry = (
        amount: number,
        type: 'entrada' | 'saida',
        description: string,
        receivedAt: string,
      ) => {
        if (!Number.isFinite(amount) || amount <= 0) {
          return
        }
        paymentEntries.push({
          id: createId(),
          type,
          description,
          amount,
          createdAt: receivedAt || new Date().toISOString().slice(0, 10),
          cashboxId,
        })
      }

      nextPayments.forEach((payment) => {
        const previous = previousById.get(payment.id)
        if (!previous) {
          pushPaymentEntry(payment.amount, 'entrada', paymentDescription, payment.receivedAt)
          return
        }
        const delta = payment.amount - previous.amount
        if (Math.abs(delta) > 0.01) {
          pushPaymentEntry(
            Math.abs(delta),
            delta > 0 ? 'entrada' : 'saida',
            paymentAdjustmentDescription,
            payment.receivedAt,
          )
        }
      })

      previousPayments.forEach((payment) => {
        if (!nextById.has(payment.id)) {
          pushPaymentEntry(
            payment.amount,
            'saida',
            paymentReversalDescription,
            payment.receivedAt,
          )
        }
      })

      if (paymentEntries.length > 0) {
        payload.financeiro = [...payload.financeiro, ...paymentEntries]
      }
    }

    if (nextOrder.status === 'pago' && previousOrder?.status !== 'pago') {
      payload.recibos = [
        ...payload.recibos,
        {
          id: createId(),
          orderId: nextOrder.id,
          amount: nextOrder.total,
          paymentMethod: nextOrder.paymentMethod,
          issuedAt: new Date().toISOString(),
        },
      ]
      if (!hasPayments) {
        payload.financeiro = [
          ...payload.financeiro,
          {
            id: createId(),
            type: 'entrada',
            description: `Pedido ${nextOrder.id.slice(0, 8)}`,
            amount: nextOrder.total,
            createdAt: new Date().toISOString(),
            cashboxId,
          },
        ]
      }
    }

    if (
      fulfillment !== 'estoque' &&
      (nextOrder.status === 'pago' ||
        nextOrder.status === 'em_producao' ||
        nextOrder.status === 'entregue')
    ) {
      const existingByKey = new Map(
        existingProductions.map((production) => [
          buildProductionKey(production),
          production,
        ]),
      )

      const nextProductions: ProductionOrder[] = nextOrder.items.map((item) => {
      const key = buildProductionKey(item)
      const existing = existingByKey.get(key)
      const product = payload.produtos.find((current) => current.id === item.productId)
      const isLinear = product?.unit === 'metro_linear'
      const plannedLengthM = isLinear
        ? item.customLength ?? product?.length ?? 0
        : undefined

      if (existing) {
        existingByKey.delete(key)

        const nextStatus: ProductionOrder['status'] =
          nextOrder.status === 'entregue'
            ? 'CONCLUIDA'
            : nextOrder.status === 'em_producao'
              ? 'EM_ANDAMENTO'
              : existing.status

        return {
          ...existing,
          quantity: item.quantity,
          productId: item.productId,
          variantId: item.variantId,
          customLength: item.customLength,
          plannedQty: item.quantity,
          plannedLengthM,
          status: nextStatus,
          createdAt: existing.createdAt ?? existing.plannedAt ?? new Date().toISOString(),
          plannedAt: existing.plannedAt ?? new Date().toISOString(),
          finishedAt:
            nextOrder.status === 'entregue'
              ? existing.finishedAt ?? new Date().toISOString()
              : existing.finishedAt,
        }
      }

      const status: ProductionOrder['status'] =
        nextOrder.status === 'entregue'
          ? 'CONCLUIDA'
          : nextOrder.status === 'em_producao'
            ? 'EM_ANDAMENTO'
            : 'ABERTA'

      return {
        id: createId(),
        orderId: nextOrder.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        customLength: item.customLength,
        plannedQty: item.quantity,
        plannedLengthM,
        status,
        createdAt: new Date().toISOString(),
        plannedAt: new Date().toISOString(),
        finishedAt: nextOrder.status === 'entregue' ? new Date().toISOString() : undefined,
      }
    })

      const preserved = Array.from(existingByKey.values()).filter(
        (production) => production.status === 'CONCLUIDA',
      )

      payload.ordensProducao = [
        ...payload.ordensProducao.filter((production) => production.orderId !== nextOrder.id),
        ...nextProductions,
        ...preserved,
      ]
    }

    if (nextOrder.status === 'entregue' && previousOrder?.status !== 'entregue') {
      nextOrder.items.forEach((item) => {
        const productIndex = payload.produtos.findIndex(
          (product) => product.id === item.productId,
        )
        if (productIndex >= 0) {
          const current = payload.produtos[productIndex]
          if (current.unit === 'metro_linear') {
            const length = item.customLength ?? current.length ?? 1
            const stockIndex = findStockItemIndex(payload.stockItems, current.id, length)
            if (stockIndex >= 0) {
              const target = payload.stockItems[stockIndex]
              payload.stockItems[stockIndex] = {
                ...target,
                quantity: (target.quantity ?? 0) - item.quantity,
                updatedAt: new Date().toISOString(),
              }
            } else {
              payload.produtos[productIndex] = upsertLinearStockVariant(
                current,
                length,
                -item.quantity,
              )
            }
          } else if (current.hasVariants) {
            const variants = current.variants ?? []
            payload.produtos[productIndex] = {
              ...current,
              variants: variants.map((variant) =>
                variant.id === item.variantId
                  ? { ...variant, stock: (variant.stock ?? 0) - item.quantity }
                  : variant,
              ),
            }
          } else {
            payload.produtos[productIndex] = {
              ...current,
              stock: (current.stock ?? 0) - item.quantity,
            }
          }
        }
      })
    }

    return { error: null }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasProducts) {
      setStatus('Cadastre produtos antes de criar pedidos.')
      return
    }
    if (!form.clientId && !form.clientName.trim()) {
      setStatus('Informe o cliente ou selecione um cadastrado.')
      return
    }
    if (form.items.length === 0) {
      setStatus('Adicione ao menos um item no pedido.')
      return
    }

    for (const item of form.items) {
      const product = data.produtos.find((current) => current.id === item.productId)
      if (!item.productId || !product) {
        setStatus('Selecione um produto valido para todos os itens.')
        return
      }
      if (product.hasVariants && !item.variantId) {
        setStatus('Selecione produto e variacao para todos os itens.')
        return
      }
      if (product.unit === 'metro_linear' && item.customLength <= 0) {
        setStatus('Informe o comprimento em cm para os itens por metro linear.')
        return
      }
      if (item.quantity <= 0 || item.unitPrice <= 0) {
        setStatus('Quantidade e valor unitario devem ser maiores que zero.')
        return
      }
    }

    if (form.discountType === 'percent') {
      if (Number.isNaN(parsedDiscountPercent)) {
        setStatus('Informe um desconto percentual valido.')
        return
      }
      if (parsedDiscountPercent < 0 || parsedDiscountPercent > 100) {
        setStatus('O desconto percentual deve ficar entre 0 e 100.')
        return
      }
    }
    if (form.discountType === 'value') {
      if (!Number.isFinite(form.discountValue)) {
        setStatus('Informe um desconto em dinheiro valido.')
        return
      }
      if (form.discountValue < 0) {
        setStatus('O desconto nao pode ser negativo.')
        return
      }
    }
    if (rawDiscount > maxDiscountValue + 0.01) {
      setStatus(
        `Desconto acima do maximo sugerido (${formatCurrency(maxDiscountValue)}).`,
      )
      return
    }
    for (const payment of form.payments) {
      if (!payment.receivedAt) {
        setStatus('Informe a data do recebimento.')
        return
      }
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        setStatus('Informe um valor maior que zero nos recebimentos.')
        return
      }
    }
    if (
      form.status === 'pago' &&
      form.payments.length > 0 &&
      paymentsTotal + 0.01 < total
    ) {
      setStatus('Os recebimentos ainda nao completam o total do pedido.')
      return
    }
    const normalizedPayment =
      getPaymentMethodId(form.paymentMethod, data.tabelas?.paymentMethods) ||
      form.paymentMethod
    if (form.status === 'pago' && (!normalizedPayment || normalizedPayment === 'a_definir')) {
      setStatus('Defina a forma de pagamento antes de marcar como pago.')
      return
    }

    const payload = dataService.getAll()
    const client = form.clientId
      ? payload.clientes.find((item) => item.id === form.clientId)
      : undefined

    if (form.clientId && !client) {
      setStatus('Cliente selecionado nao encontrado.')
      return
    }

    const resolvedClient = client ?? findOrCreateClient(form.clientName, payload.clientes)
    const existingOrder = editingId
      ? payload.pedidos.find((order) => order.id === editingId)
      : undefined

    const items: Order['items'] = []
    for (let index = 0; index < form.items.length; index += 1) {
      const item = form.items[index]
      const productIndex = payload.produtos.findIndex((product) => product.id === item.productId)
      if (productIndex < 0) {
        setStatus('Produto nao encontrado.')
        return
      }
      const product = payload.produtos[productIndex]
      const variant =
        product.unit === 'metro_linear'
          ? undefined
          : product.variants?.find((entry) => entry.id === item.variantId)
      const priceRuleError = validatePriceRules(item, product, variant)
      if (priceRuleError) {
        setStatus(`Item ${index + 1}: ${priceRuleError}`)
        return
      }
      let variantId = item.variantId
      if (product.hasVariants && item.variantId === 'custom') {
        const result = ensureCustomVariant(payload.produtos[productIndex], item)
        if (result.error) {
          setStatus(result.error)
          return
        }
        variantId = result.variant!.id
      }
      items.push({
        productId: item.productId,
        variantId: product.unit === 'metro_linear' ? undefined : variantId || undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        customLength: item.customLength > 0 ? item.customLength : undefined,
        customWidth: item.customWidth > 0 ? item.customWidth : undefined,
        customHeight: item.customHeight > 0 ? item.customHeight : undefined,
      })
    }

    const discountType = form.discountType || undefined
    const orderId = existingOrder?.id ?? createId()
    const payments = form.payments
      .filter((payment) => payment.amount > 0 && payment.receivedAt)
      .map((payment) => ({
        id: payment.id || createId(),
        amount: payment.amount,
        receivedAt: payment.receivedAt,
      }))
    const order: Order = {
      id: orderId,
      trackingCode: existingOrder?.trackingCode ?? resolveOrderCode({ id: orderId }),
      clientId: resolvedClient.id,
      obraId: form.clientId ? form.obraId || undefined : undefined,
      items,
      total,
      paymentMethod: normalizedPayment || 'a_definir',
      fulfillment: form.fulfillment,
      discountType,
      discountValue: discountType ? appliedDiscount : undefined,
      discountPercent: discountType ? appliedDiscountPercent : undefined,
      status: form.status,
      payments,
      createdAt: existingOrder?.createdAt ?? new Date().toISOString(),
      sourceQuoteId: existingOrder?.sourceQuoteId,
    }

    const result = applyOrderUpdate(payload, order, existingOrder)
    if (result.error) {
      setStatus(result.error)
      return
    }

    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: existingOrder ? 'Pedido atualizado' : 'Pedido criado',
        description: `${resolvedClient.name} · ${items.length} item(ns) · ${formatCurrency(total)}`,
      },
    })
    refresh()
    setStatus(existingOrder ? 'Pedido atualizado com sucesso.' : 'Pedido salvo com sucesso.')
    setIsModalOpen(false)
    resetForm()
  }

  const orders = useMemo(
    () => [...data.pedidos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.pedidos],
  )

  const getClientName = (id: string) =>
    data.clientes.find((client) => client.id === id)?.name ?? 'Cliente'

  const getProductName = (id: string) =>
    data.produtos.find((product) => product.id === id)?.name ?? 'Produto'

  const getVariant = (productId: string, variantId?: string) =>
    data.produtos
      .find((product) => product.id === productId)
      ?.variants?.find((variant) => variant.id === variantId)

  const getProductUnit = (productId: string) =>
    getProductUnitLabel(
      data.produtos.find((product) => product.id === productId)?.unit,
      data.tabelas,
    )

  const formatItemsSummary = (items: Order['items']) => {
    if (items.length === 0) {
      return '-'
    }
    const first = items[0]
    const firstName = getProductName(first.productId)
    if (items.length === 1) {
      return firstName
    }
    return `${firstName} +${items.length - 1}`
  }

  const formatPercent = (value: number) =>
    Number.isFinite(value) ? (value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)) : '0'

  const formatMeasurement = (value: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)

  const buildDimensionLabel = (values: number[]) => {
    const filtered = values.filter((value) => Number.isFinite(value) && value > 0)
    if (filtered.length === 0) {
      return null
    }
    const label = filtered.map((value) => formatMeasurement(value)).join(' x ')
    return `${label} m`
  }

  const getItemDimensions = (item: Order['items'][number]) => {
    const product = data.produtos.find((entry) => entry.id === item.productId)
    const variant = item.variantId ? getVariant(item.productId, item.variantId) : undefined
    const length = item.customLength ?? variant?.length ?? product?.length ?? 0
    const width = item.customWidth ?? variant?.width ?? product?.width ?? 0
    const height = item.customHeight ?? variant?.height ?? product?.height ?? 0
    if (product?.unit === 'metro_linear') {
      return buildDimensionLabel([length])
    }
    return buildDimensionLabel([length, width, height])
  }

  const getProductNameLabel = (item: Order['items'][number]) => {
    const product = data.produtos.find((entry) => entry.id === item.productId)
    const productName = getProductName(item.productId)
    if (product && !product.hasVariants) {
      return productName
    }
    const variant = getVariant(item.productId, item.variantId)
    if (!variant) {
      return productName
    }
    return `${productName} - ${variant.name}`
  }

  const getOrderDiscountInfo = (order: Order) => {
    const subtotalValue = order.items.reduce(
      (acc, item) => acc + item.quantity * item.unitPrice,
      0,
    )
    const valueFromPercent = order.discountPercent
      ? subtotalValue * (order.discountPercent / 100)
      : 0
    const discountValue = order.discountValue ?? valueFromPercent
    const discountPercent =
      order.discountPercent ??
      (subtotalValue > 0 ? (discountValue / subtotalValue) * 100 : 0)
    return { subtotalValue, discountValue, discountPercent }
  }

  const printOrder = printId ? data.pedidos.find((order) => order.id === printId) : null
  const printDiscountInfo = printOrder ? getOrderDiscountInfo(printOrder) : null
  const company = data.empresa
  const companyName = company.name?.trim() || company.tradeName?.trim() || ''
  const companyDocument = company.document?.trim() || ''
  const addressLine = [company.street, company.number, company.neighborhood]
    .filter(Boolean)
    .join(', ')
  const cityLine = [company.city, company.state, company.zip].filter(Boolean).join(' - ')
  const contactLine = [company.phone, company.email, company.website].filter(Boolean).join(' • ')
  const companyLines = [companyName, companyDocument, addressLine, cityLine, contactLine].filter(
    (value) => value && value.trim().length > 0,
  )
  const printClient = printOrder
    ? data.clientes.find((client) => client.id === printOrder.clientId)
    : null
  const printObra =
    printOrder && printClient?.obras
      ? printClient.obras.find((obra) => obra.id === printOrder.obraId)
      : null
  const clientDocument = printClient?.document?.trim() || ''
  const clientContactLine = [printClient?.phone, printClient?.email].filter(Boolean).join(' • ')
  const clientAddressLine = [printObra?.address, printObra?.city ?? printClient?.city]
    .filter(Boolean)
    .join(' - ')
  const clientNotes = [printObra?.notes, printClient?.notes].filter(Boolean).join(' • ')

  const handleEdit = (order: Order) => {
    setEditingId(order.id)
    const inferredDiscountType =
      order.discountType ??
      (order.discountPercent ? 'percent' : order.discountValue ? 'value' : '')
    setForm({
      clientId: order.clientId,
      clientName: getClientName(order.clientId),
      obraId: order.obraId ?? '',
      items: order.items.map((item) => {
        const product = data.produtos.find((entry) => entry.id === item.productId)
        const variant = item.variantId ? getVariant(item.productId, item.variantId) : undefined
        const isLinear = product?.unit === 'metro_linear'
        const customLength =
          item.customLength ?? variant?.length ?? product?.length ?? 0
        const customWidth =
          item.customWidth ?? variant?.width ?? product?.width ?? 0
        const customHeight =
          item.customHeight ?? variant?.height ?? product?.height ?? 0
        const unitPrice = isLinear
          ? resolveUnitPrice(product ?? null, undefined, {
              productId: item.productId,
              variantId: '',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              customLength,
              customWidth,
              customHeight,
            })
          : item.unitPrice
        return {
          productId: item.productId,
          variantId: isLinear ? '' : item.variantId ?? '',
          quantity: item.quantity,
          unitPrice,
          customLength,
          customWidth,
          customHeight,
        }
      }),
      payments: (order.payments ?? []).map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        receivedAt: payment.receivedAt.slice(0, 10),
      })),
      paymentMethod:
        getPaymentMethodId(order.paymentMethod, data.tabelas?.paymentMethods) ||
        order.paymentMethod ||
        'a_definir',
      discountType: inferredDiscountType as OrderForm['discountType'],
      discountValue: order.discountValue ?? 0,
      discountPercent:
        order.discountPercent !== undefined ? String(order.discountPercent) : '',
      status: order.status,
      fulfillment: order.fulfillment ?? 'producao',
    })
    setStatus(null)
    setIsModalOpen(true)
  }

  const handlePrint = (order: Order) => {
    setPrintId(order.id)
  }

  useEffect(() => {
    if (!printId || typeof window === 'undefined') {
      return
    }
    let cancelled = false
    const runPrint = async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })
      if (document.fonts?.ready) {
        await document.fonts.ready
      }
      if (!cancelled) {
        window.print()
      }
    }
    void runPrint()
    return () => {
      cancelled = true
    }
  }, [printId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }
    const handleAfterPrint = () => setPrintId(null)
    window.addEventListener('afterprint', handleAfterPrint)
    return () => window.removeEventListener('afterprint', handleAfterPrint)
  }, [])

  useEffect(() => {
    if (!openOrderId) {
      return
    }
    const order = data.pedidos.find((item) => item.id === openOrderId)
    if (order) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- abrir modal via historico/busca.
      handleEdit(order)
    }
    onConsumeOpen?.()
  }, [data.pedidos, handleEdit, onConsumeOpen, openOrderId])

  const editingOrder = editingId
    ? data.pedidos.find((order) => order.id === editingId) ?? null
    : null
  const orderToDelete = deleteId
    ? data.pedidos.find((order) => order.id === deleteId)
    : null

  const handleDelete = () => {
    if (!deleteId) {
      return
    }
    const payload = dataService.getAll()
    payload.pedidos = payload.pedidos.filter((order) => order.id !== deleteId)
    payload.ordensProducao = payload.ordensProducao.filter(
      (order) => order.orderId !== deleteId,
    )
    payload.recibos = payload.recibos.filter((receipt) => receipt.orderId !== deleteId)
    payload.entregas = payload.entregas.filter((delivery) => delivery.orderId !== deleteId)
    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: 'Pedido excluido',
        description: orderToDelete ? getClientName(orderToDelete.clientId) : undefined,
      },
    })
    if (payload.meta?.workspaceId && orderToDelete) {
      void trackingRemote.deleteOrders(payload.meta.workspaceId, [
        resolveOrderPublicCode(orderToDelete),
      ])
    }
    refresh()
    setIsModalOpen(false)
    resetForm()
    setStatus('Pedido excluido.')
    setDeleteId(null)
  }

  const handleInlineStatusChange = (order: Order, nextStatus: Order['status']) => {
    const payload = dataService.getAll()
    const target = payload.pedidos.find((item) => item.id === order.id)
    if (!target) {
      return
    }
    const updated: Order = { ...target, status: nextStatus }
    const result = applyOrderUpdate(payload, updated, target)
    if (result.error) {
      setStatus(result.error)
      return
    }
    payload.pedidos = payload.pedidos.map((item) => (item.id === updated.id ? updated : item))
    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'alteracao',
        title: 'Status do pedido atualizado',
        description: `${getClientName(updated.clientId)} → ${statusLabels[nextStatus]}`,
      },
    })
    refresh()
  }

  return (
    <Page className="pedidos">
      {printOrder && (
        <div id="quote-print" className="quote-print">
          {[
            { id: 'cliente', label: 'Via do cliente' },
            { id: 'empresa', label: 'Via da empresa' },
          ].map((copy) => (
            <section key={copy.id} className="quote-print__copy">
              <header className="quote-print__header">
                <div className="quote-print__brand">
                  <img className="quote-print__logo" src={logotipo} alt={companyName} />
                  {companyLines.length > 0 && (
                    <div className="quote-print__company">
                      {companyLines.map((line, index) => {
                        const isNameLine = index === 0 && companyName && line === companyName
                        return isNameLine ? (
                          <strong key={`${copy.id}-company-${index}`}>{line}</strong>
                        ) : (
                          <span key={`${copy.id}-company-${index}`}>{line}</span>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="quote-print__meta">
                  <span>Emissao: {formatDateShort(printOrder.createdAt)}</span>
                  <span>Status: {statusLabels[printOrder.status]}</span>
                  <span>
                    Pagamento:{' '}
                    {getPaymentMethodLabel(
                      printOrder.paymentMethod,
                      data.tabelas?.paymentMethods,
                    )}
                  </span>
                  <span>Pedido #{resolveOrderInternalCode(printOrder)}</span>
                  <span className="quote-print__copy-tag">{copy.label}</span>
                </div>
              </header>

              <section className="quote-print__client">
                <div className="quote-print__client-block">
                  <span>Cliente</span>
                  <strong>{getClientName(printOrder.clientId)}</strong>
                  {clientDocument && <span>Documento: {clientDocument}</span>}
                  {clientContactLine && <span>{clientContactLine}</span>}
                </div>
                <div className="quote-print__client-block">
                  <span>Obra / Endereco</span>
                  <strong>{printObra?.name || '—'}</strong>
                  <span>{clientAddressLine || '—'}</span>
                </div>
              </section>

              <table className="quote-print__table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Medidas (m)</th>
                    <th>Qtd</th>
                    <th>Unidade</th>
                    <th>Valor unitario</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {printOrder.items.map((item, index) => {
                    const dimensions = getItemDimensions(item)
                    return (
                      <tr key={`${printOrder.id}-${copy.id}-item-${index}`}>
                        <td>{getProductNameLabel(item)}</td>
                        <td>
                          {dimensions ? (
                            <span className="quote-print__dimension">{dimensions}</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>{item.quantity}</td>
                        <td>{getProductUnit(item.productId) || '-'}</td>
                        <td>{formatCurrency(item.unitPrice)}</td>
                        <td>{formatCurrency(item.quantity * item.unitPrice)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="quote-print__total">
                {printDiscountInfo && (
                  <div className="quote-print__total-row">
                    <span>Subtotal</span>
                    <strong>{formatCurrency(printDiscountInfo.subtotalValue)}</strong>
                  </div>
                )}
                {printDiscountInfo && printDiscountInfo.discountValue > 0 && (
                  <div className="quote-print__total-row">
                    <span>
                      Desconto ({formatPercent(printDiscountInfo.discountPercent)}%)
                    </span>
                    <strong>-{formatCurrency(printDiscountInfo.discountValue)}</strong>
                  </div>
                )}
                <div className="quote-print__total-row quote-print__total-main">
                  <span>Total do pedido</span>
                  <strong>{formatCurrency(printOrder.total)}</strong>
                </div>
              </div>

              <section className="quote-print__notes">
                <span>Observacoes</span>
                {clientNotes ? <p>{clientNotes}</p> : <div className="quote-print__notes-line" />}
              </section>

              <section className="quote-print__signatures">
                <div className="quote-print__signature">
                  <span>Assinatura do cliente</span>
                  <div className="quote-print__line" />
                  <span>Data: ____/____/______</span>
                </div>
                <div className="quote-print__signature">
                  <span>
                    {companyName ? `Responsavel ${companyName}` : 'Responsavel'}
                  </span>
                  <div className="quote-print__line" />
                  <span>Data: ____/____/______</span>
                </div>
              </section>
            </section>
          ))}
        </div>
      )}
      <PageHeader
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={openNewModal}
            disabled={!hasProducts}
            aria-label="Novo pedido"
          >
            <span className="material-symbols-outlined page-header__action-icon" aria-hidden="true">
              shopping_bag
            </span>
            <span className="page-header__action-label">Novo pedido</span>
          </button>
        }
      />
      <QuickNotice message={status} onClear={() => setStatus(null)} />
      <QuickNotice
        message={trackingLinkNotice}
        tone="info"
        autoHideMs={9000}
        interactive
        onClear={() => setTrackingLink(null)}
        slot={1}
      />

      <div className="summary summary-card">
        <article className="summary__item">
          <span className="summary__label">Total</span>
          <strong className="summary__value">{orderSummary.total}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Aguardando</span>
          <strong className="summary__value">{orderSummary.awaiting}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Em producao</span>
          <strong className="summary__value">{orderSummary.inProduction}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Receita confirmada</span>
          <strong className="summary__value">
            {formatCurrency(orderSummary.confirmedValue)}
          </strong>
        </article>
      </div>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar pedido' : 'Novo pedido'}
        size="lg"
        actions={
          <>
            {editingOrder && (
              <button
                className="button button--ghost"
                type="button"
                onClick={() => handlePrint(editingOrder)}
              >
                <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                  print
                </span>
                <span className="modal__action-label">Imprimir</span>
              </button>
            )}
            {editingId && (
              <button
                className="button button--danger"
                type="button"
                onClick={() => setDeleteId(editingId)}
              >
                <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                  delete
                </span>
                <span className="modal__action-label">Excluir</span>
              </button>
            )}
            <button
              className="button button--primary"
              type="submit"
              form={orderFormId}
              disabled={!hasProducts}
            >
              <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                save
              </span>
              <span className="modal__action-label">
                {editingId ? 'Atualizar pedido' : 'Salvar pedido'}
              </span>
            </button>
          </>
        }
      >
        <form id={orderFormId} className="modal__form" onSubmit={handleSubmit}>
          <div className="modal__group">
            <label className="modal__label" htmlFor="order-client-select">
              Cliente cadastrado
            </label>
            <select
              id="order-client-select"
              className="modal__input"
              value={form.clientId}
              onChange={(event) => {
                const value = event.target.value
                const selected = data.clientes.find((client) => client.id === value)
                const obraId =
                  selected && selected.obras && selected.obras.length === 1
                    ? selected.obras[0].id
                    : ''
                updateForm({
                  clientId: value,
                  clientName: value ? selected?.name ?? '' : '',
                  obraId,
                })
              }}
            >
              <option value="">Selecionar cliente</option>
              {availableClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="modal__group">
            <label className="modal__label" htmlFor="order-client">
              Novo cliente
            </label>
            <input
              id="order-client"
              className="modal__input"
              type="text"
              value={form.clientName}
              onChange={(event) => updateForm({ clientName: event.target.value })}
              placeholder={form.clientId ? 'Cliente selecionado' : 'Nome do cliente'}
              disabled={!!form.clientId}
            />
            {form.clientId && (
              <p className="modal__help">Limpe o cliente cadastrado para digitar outro.</p>
            )}
          </div>

          <div className="modal__group">
            <label className="modal__label" htmlFor="order-obra">
              Obra do cliente
            </label>
            <select
              id="order-obra"
              className="modal__input"
              value={form.obraId}
              onChange={(event) => updateForm({ obraId: event.target.value })}
              disabled={!form.clientId || clientObras.length === 0}
            >
              <option value="">Selecionar obra</option>
              {clientObras.map((obra) => (
                <option key={obra.id} value={obra.id}>
                  {obra.name}
                </option>
              ))}
            </select>
            {form.clientId && clientObras.length === 0 && (
              <p className="modal__help">Nenhuma obra cadastrada para este cliente.</p>
            )}
          </div>

      {form.items.map((item, index) => {
        const itemProduct = data.produtos.find((product) => product.id === item.productId)
        const itemVariants = itemProduct?.variants ?? []
        const isLinear = itemProduct?.unit === 'metro_linear'
        const usesVariants = !!itemProduct?.hasVariants && !isLinear
        const itemVariant = usesVariants
          ? itemVariants.find((variant) => variant.id === item.variantId)
          : undefined
        const basePrice = itemProduct ? resolveUnitPrice(itemProduct, itemVariant, item) : 0
        const minPrice = itemProduct
          ? getMinUnitPrice(itemProduct, itemVariant, {
              materials: data.materiais,
              customLength: item.customLength,
              customWidth: item.customWidth,
            })
          : 0
        return (
          <div key={`item-${index}`} className="modal__section">
            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor={`order-product-${index}`}>
                  Produto
                </label>
                <select
                  id={`order-product-${index}`}
                  className="modal__input"
                  value={item.productId}
                  onChange={(event) => handleProductChange(index, event.target.value)}
                  disabled={!hasProducts}
                >
                  <option value="">Selecione um produto</option>
                  {availableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              {isLinear ? (
                <div className="modal__group">
                  <label className="modal__label" htmlFor={`order-length-${index}`}>
                    Comprimento
                  </label>
                  <DimensionInput
                    id={`order-length-${index}`}
                    className="modal__input"
                    min="0"
                    step={0.01}
                    value={item.customLength}
                    onValueChange={(value) => handleLinearLengthChange(index, value)}
                    disabled={!item.productId}
                  />
                </div>
              ) : usesVariants ? (
                <div className="modal__group">
                  <label className="modal__label" htmlFor={`order-variant-${index}`}>
                    Variacao
                  </label>
                  <select
                    id={`order-variant-${index}`}
                    className="modal__input"
                    value={item.variantId}
                    onChange={(event) => handleVariantChange(index, event.target.value)}
                    disabled={!item.productId}
                  >
                    <option value="">Selecione uma variacao</option>
                    {itemVariants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.name}
                        {variant.isCustom ? ' (Custom)' : ''}
                      </option>
                    ))}
                    <option value="custom">Personalizada</option>
                  </select>
                </div>
              ) : (
                <div className="modal__group">
                  <label className="modal__label">Variacao</label>
                  <input
                    className="modal__input"
                    type="text"
                    value="Produto sem variacoes"
                    disabled
                  />
                </div>
              )}
            </div>

            {usesVariants && item.variantId === 'custom' && (
              <div className="modal__row">
                <div className="modal__group">
                  <label className="modal__label" htmlFor={`order-length-${index}`}>
                    Comprimento
                  </label>
                  <DimensionInput
                    id={`order-length-${index}`}
                    className="modal__input"
                    min="0"
                    value={item.customLength}
                    step={0.01}
                    onValueChange={(value) => updateItem(index, { customLength: value })}
                  />
                </div>
                <div className="modal__group">
                  <label className="modal__label" htmlFor={`order-width-${index}`}>
                    Largura
                  </label>
                  <DimensionInput
                    id={`order-width-${index}`}
                    className="modal__input"
                    min="0"
                    value={item.customWidth}
                    step={0.01}
                    onValueChange={(value) => updateItem(index, { customWidth: value })}
                  />
                </div>
                <div className="modal__group">
                  <label className="modal__label" htmlFor={`order-height-${index}`}>
                    Altura
                  </label>
                  <DimensionInput
                    id={`order-height-${index}`}
                    className="modal__input"
                    min="0"
                    value={item.customHeight}
                    step={0.01}
                    onValueChange={(value) => updateItem(index, { customHeight: value })}
                  />
                </div>
              </div>
            )}

            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor={`order-quantity-${index}`}>
                  Quantidade
                </label>
                <input
                  id={`order-quantity-${index}`}
                  className="modal__input"
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(index, { quantity: Number(event.target.value) })
                  }
                />
              </div>
              <div className="modal__group">
                <label className="modal__label" htmlFor={`order-price-${index}`}>
                  Valor unitario
                </label>
                <CurrencyInput
                  id={`order-price-${index}`}
                  className="modal__input"
                  value={item.unitPrice}
                  onValueChange={(value) => updateItem(index, { unitPrice: value ?? 0 })}
                  disabled={isLinear}
                />
                {itemProduct && (
                  <p className="modal__help">
                    Base {formatCurrency(basePrice)} | Min sem prejuizo{' '}
                    {formatCurrency(minPrice)}
                  </p>
                )}
              </div>
            </div>

                {form.items.length > 1 && (
                  <div className="modal__form-actions">
                    <button
                      className="button button--danger"
                      type="button"
                      onClick={() => removeItem(index)}
                    >
                      Remover item
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <button className="button button--ghost" type="button" onClick={addItem}>
            Adicionar item
          </button>

          <div className="modal__section">
            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor="order-discount-type">
                  Desconto
                </label>
                <select
                  id="order-discount-type"
                  className="modal__input"
                  value={form.discountType}
                  onChange={(event) =>
                    updateForm({ discountType: event.target.value as OrderForm['discountType'] })
                  }
                >
                  <option value="">Sem desconto</option>
                  <option value="percent">Percentual</option>
                  <option value="value">Valor</option>
                </select>
              </div>
              {form.discountType === 'percent' && (
                <div className="modal__group">
                  <label className="modal__label" htmlFor="order-discount-percent">
                    Percentual
                  </label>
                  <input
                    id="order-discount-percent"
                    className="modal__input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.discountPercent}
                    onChange={(event) => updateForm({ discountPercent: event.target.value })}
                    placeholder={`Max ${maxDiscountPercent.toFixed(1)}%`}
                  />
                </div>
              )}
              {form.discountType === 'value' && (
                <div className="modal__group">
                  <label className="modal__label" htmlFor="order-discount-value">
                    Valor
                  </label>
                  <CurrencyInput
                    id="order-discount-value"
                    className="modal__input"
                    value={form.discountValue}
                    onValueChange={(value) => updateForm({ discountValue: value ?? 0 })}
                    placeholder={`Max ${formatCurrency(maxDiscountValue)}`}
                  />
                </div>
              )}
            </div>
            {subtotal > 0 ? (
              <p className="modal__help">
                Desconto maximo sugerido: {formatCurrency(maxDiscountValue)} (
                {maxDiscountPercent.toFixed(1)}%).
              </p>
            ) : (
              <p className="modal__help">Preencha os itens para calcular o desconto sugerido.</p>
            )}
          </div>

          <div className="modal__group">
            <label className="modal__label" htmlFor="order-payment">
              Forma de pagamento
            </label>
            <select
              id="order-payment"
              className="modal__input"
              value={form.paymentMethod}
              onChange={(event) => updateForm({ paymentMethod: event.target.value })}
            >
              {form.paymentMethod &&
                !paymentOptions.some((method) => method.id === form.paymentMethod) && (
                  <option value={form.paymentMethod}>
                    Outro ({form.paymentMethod})
                  </option>
                )}
              {paymentOptions.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.label}
                </option>
              ))}
            </select>
            <p className="modal__help">
              O meio escolhido define o caixa das entradas de recebimento.
            </p>
          </div>

          <div className="modal__section">
            <div className="modal__form-actions">
              <strong>Recebimentos parciais</strong>
              <button className="button button--ghost" type="button" onClick={addPayment}>
                Adicionar recebimento
              </button>
            </div>
            {form.payments.length === 0 ? (
              <p className="modal__help">Nenhum recebimento registrado.</p>
            ) : (
              form.payments.map((payment, index) => (
                <div key={payment.id} className="modal__row">
                  <div className="modal__group">
                    <label
                      className="modal__label"
                      htmlFor={`order-payment-date-${payment.id}`}
                    >
                      Data
                    </label>
                    <input
                      id={`order-payment-date-${payment.id}`}
                      className="modal__input"
                      type="date"
                      value={payment.receivedAt}
                      onChange={(event) =>
                        updatePayment(index, { receivedAt: event.target.value })
                      }
                    />
                  </div>
                  <div className="modal__group">
                    <label
                      className="modal__label"
                      htmlFor={`order-payment-amount-${payment.id}`}
                    >
                      Valor recebido
                    </label>
                    <CurrencyInput
                      id={`order-payment-amount-${payment.id}`}
                      className="modal__input"
                      value={payment.amount}
                      onValueChange={(value) =>
                        updatePayment(index, { amount: value ?? 0 })
                      }
                    />
                  </div>
                  <div className="modal__group">
                    <span className="modal__label">Acoes</span>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => removePayment(index)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))
            )}
            <div className="modal__row">
              <div className="summary">
                <span>Recebido</span>
                <strong>{formatCurrency(paymentsTotal)}</strong>
              </div>
              <div className="summary">
                <span>Saldo a receber</span>
                <strong>{formatCurrency(remainingBalance)}</strong>
              </div>
            </div>
            {overpaidAmount > 0 && (
              <p className="modal__help">
                Recebido acima do total: {formatCurrency(overpaidAmount)}.
              </p>
            )}
          </div>

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="order-fulfillment">
                Atendimento
              </label>
              <select
                id="order-fulfillment"
                className="modal__input"
                value={form.fulfillment}
                onChange={(event) => {
                  const next = event.target.value as FulfillmentMode
                  updateForm({
                    fulfillment: next,
                    status:
                      next === 'estoque' && form.status === 'em_producao'
                        ? 'pago'
                        : form.status,
                  })
                }}
              >
                <option value="producao">Enviar para producao</option>
                <option value="estoque">Retirar do estoque</option>
              </select>
              <p className="modal__help">
                Retirar do estoque pula a etapa de producao.
              </p>
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="order-status">
                Status
              </label>
              <select
                id="order-status"
                className="modal__input"
                value={form.status}
                onChange={(event) =>
                  updateForm({ status: event.target.value as Order['status'] })
                }
              >
                {Object.entries(statusLabels)
                  .filter(([key]) =>
                    form.fulfillment === 'estoque' ? key !== 'em_producao' : true,
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
              <p className="modal__help">
                Status pago gera recibo. Os recebimentos alimentam o financeiro.
              </p>
            </div>
          </div>

          <div className="modal__row">
            <div className="summary">
              <span>Subtotal</span>
              <strong>{formatCurrency(subtotal)}</strong>
            </div>
            <div className="summary">
              <span>Desconto aplicado</span>
              <strong>{formatCurrency(appliedDiscount)}</strong>
            </div>
          </div>

          <div className="summary">
            <span>Total do pedido</span>
            <strong>{formatCurrency(total)}</strong>
          </div>

          <div className="modal__row">
            <div className="summary">
              <span>Custo base</span>
              <strong>{formatCurrency(costSummary.base)}</strong>
            </div>
            <div className="summary">
              <span>Custo mao de obra</span>
              <strong>{formatCurrency(costSummary.labor)}</strong>
            </div>
          </div>

          <div className="modal__row">
            <div className="summary">
              <span>Custo estimado</span>
              <strong>{formatCurrency(estimatedCost)}</strong>
            </div>
            <div className="summary">
              <span>Lucro estimado</span>
              <strong>{formatCurrency(estimatedProfit)}</strong>
            </div>
          </div>

          <div className="summary">
            <span>Margem estimada</span>
            <strong>{formatPercent(estimatedMargin)}%</strong>
          </div>

          <p className="modal__help">
            Previa calculada com base nos custos cadastrados do produto.
          </p>

          {!hasProducts && <p className="modal__help">Cadastre produtos para liberar pedidos.</p>}
        </form>
      </Modal>

      <div className="pedidos__layout">
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>Pedidos recentes</h2>
              <p>Atualize status e gere producao sem abrir o pedido.</p>
            </div>
            <span className="panel__meta">{orders.length} registros</span>
          </div>
          <div className="table-card">
            <table className="table">
              <thead className="table__head table__head--mobile-hide">
                <tr>
                  <th>Cliente</th>
                  <th className="table__cell--mobile-hide">Codigo</th>
                  <th>Itens</th>
                  <th>Desconto</th>
                  <th>Total</th>
                  <th>Pagamento</th>
                  <th className="table__actions table__actions--end">Status / Editar</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table__empty">
                      Nenhum pedido cadastrado ainda.
                    </td>
                  </tr>
                )}
                {orders.map((order) => {
                  const discountInfo = getOrderDiscountInfo(order)
                  const orderCode = resolveOrderInternalCode(order)
                  return (
                    <tr key={order.id}>
                      <td className="table__cell--truncate">
                        <div className="table__stack">
                          <strong>{getClientName(order.clientId)}</strong>
                          <span className="table__sub table__sub--mobile">
                            Pedido #{orderCode} • {formatCurrency(order.total)}
                          </span>
                        </div>
                      </td>
                      <td className="table__cell--mobile-hide">
                        <span className="table__sub">#{orderCode}</span>
                      </td>
                      <td className="table__cell--mobile-hide">
                        {formatItemsSummary(order.items)}
                      </td>
                      <td className="table__cell--mobile-hide">
                        {discountInfo.discountValue > 0
                          ? `${formatCurrency(discountInfo.discountValue)} (${formatPercent(
                              discountInfo.discountPercent,
                            )}%)`
                          : '-'}
                      </td>
                      <td className="table__cell--mobile-hide">{formatCurrency(order.total)}</td>
                      <td className="table__cell--mobile-hide">
                        {getPaymentMethodLabel(
                          order.paymentMethod,
                          data.tabelas?.paymentMethods,
                        )}
                      </td>
                      <td className="table__actions table__actions--end">
                        <div className="table__end">
                          <select
                            className="table__select"
                            data-status={order.status}
                            value={order.status}
                            onChange={(event) =>
                              handleInlineStatusChange(
                                order,
                                event.target.value as Order['status'],
                              )
                            }
                          >
                            {Object.entries(statusLabels)
                              .filter(([key]) =>
                                order.fulfillment === 'estoque' ? key !== 'em_producao' : true,
                              )
                              .map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                          </select>
                          <ActionMenu
                            items={[
                              { label: 'Editar', onClick: () => handleEdit(order) },
                              {
                                label: 'Copiar link de rastreio',
                                onClick: () => void copyTrackingLink(order),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={!!deleteId}
        title="Excluir pedido?"
        description={
          orderToDelete
            ? `O pedido de ${getClientName(orderToDelete.clientId)} sera removido.`
            : 'Esta acao nao pode ser desfeita.'
        }
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </Page>
  )
}

export default Pedidos
