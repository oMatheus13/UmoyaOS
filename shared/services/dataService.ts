import type {
  DeliveryItem,
  ERPData,
  FinanceEntry,
  Order,
  OrderPayment,
  PdvCashMovement,
  PdvCashSession,
  Product,
  ProductMaterialUsage,
  ProductionOrder,
  ProductionScrapStatus,
  ProductUnit,
  Quote,
  Receipt,
  MaterialKind,
  MaterialUnit,
} from '../types/erp'
import { appendAuditEvent, type AuditInput } from './audit'
import { deriveUsagesFromBatch } from '../utils/batch'
import { getDefaultUsageUnit } from '../utils/materialUsage'
import {
  createEmptyState,
  DEFAULT_CASHBOXES,
  DEFAULT_COMPANY,
  DEFAULT_INTEGRATIONS,
  DEFAULT_LEVELS,
  DEFAULT_ROLES,
  DEFAULT_TABLES,
  getStorage,
  saveStorage,
} from './storage'
import { createId } from '../utils/ids'
import { ensureOrderCodes } from '../utils/orderCode'
import { buildItemKey } from '../utils/tracking'
import { buildDailyCode, generatePublicCode, getDateKey, parseDailyCode } from '../utils/humanCodes'

type RemoteSync = (data: ERPData) => void | Promise<void>
type SaveOptions = {
  touchMeta?: boolean
  skipSync?: boolean
  emitEvent?: boolean
  auditEvent?: AuditInput
}

let remoteSync: RemoteSync | null = null

const stripAvatarUrls = (data: ERPData) => {
  if (!Array.isArray(data.usuarios)) {
    return data
  }
  let changed = false
  const usuarios = data.usuarios.map((user) => {
    const { avatarUrl, ...rest } = user
    if (typeof avatarUrl !== 'undefined') {
      changed = true
      return rest
    }
    return user
  })
  return changed ? { ...data, usuarios } : data
}

const dispatchDataEvent = () => {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event('umoya:data'))
}

const saveAndSync = (data: ERPData, options?: SaveOptions) => {
  const shouldTouchMeta = options?.touchMeta !== false
  const shouldEmitEvent = options?.emitEvent !== false
  const sanitized = stripAvatarUrls(data)
  const next: ERPData = shouldTouchMeta
    ? {
        ...sanitized,
        meta: {
          ...sanitized.meta,
          updatedAt: new Date().toISOString(),
        },
      }
    : sanitized
  saveStorage(next)
  if (shouldEmitEvent) {
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(dispatchDataEvent)
    } else {
      setTimeout(dispatchDataEvent, 0)
    }
  }
  if (remoteSync && !options?.skipSync) {
    void remoteSync(next)
  }
}

const applyAudit = (data: ERPData, options?: SaveOptions) => {
  if (options?.auditEvent) {
    return appendAuditEvent(data, options.auditEvent)
  }
  return data
}

export type DataService = {
  getAll: () => ERPData
  replaceAll: (data: ERPData, options?: SaveOptions) => void
  exportJson: () => string
  importJson: (payload: string) => void
  upsertQuote: (quote: Quote, options?: SaveOptions) => void
  upsertOrder: (order: Order, options?: SaveOptions) => void
  addReceipt: (receipt: Receipt, options?: SaveOptions) => void
  addFinanceEntry: (entry: FinanceEntry, options?: SaveOptions) => void
  upsertPdvCashSession: (session: PdvCashSession, options?: SaveOptions) => void
  addPdvCashMovement: (movement: PdvCashMovement, options?: SaveOptions) => void
}

const upsert = <T extends { id: string }>(items: T[], next: T) => {
  const index = items.findIndex((item) => item.id === next.id)
  if (index >= 0) {
    items[index] = next
    return items
  }
  return [...items, next]
}

const normalizeVariants = (
  product: Product,
  materialKindById: Map<string, MaterialKind>,
  markChanged: () => void,
) => {
  const rawVariants = Array.isArray(product.variants) ? product.variants : []
  if (rawVariants !== product.variants) {
    markChanged()
  }
  return rawVariants.map((variant) => {
    let next = variant
    if (!variant.id) {
      markChanged()
      next = { ...next, id: createId() }
    }
    if (variant.stock === undefined || variant.stock === null) {
      markChanged()
      next = { ...next, stock: 0 }
    }
    if (variant.active === undefined || variant.active === null) {
      markChanged()
      next = { ...next, active: true }
    }
    if (variant.locked === undefined || variant.locked === null) {
      markChanged()
      next = { ...next, locked: false }
    }
    const rawUsages = Array.isArray(variant.materialUsages) ? variant.materialUsages : []
    if (rawUsages !== variant.materialUsages) {
      markChanged()
    }
    let materialUsages: ProductMaterialUsage[] = rawUsages.map((usage) => {
      const nextId = usage.id || createId()
      if (nextId !== usage.id) {
        markChanged()
      }
      const quantity = Number.isFinite(usage.quantity) ? usage.quantity : 0
      if (quantity !== usage.quantity) {
        markChanged()
      }
      const materialKind = materialKindById.get(usage.materialId) ?? 'outro'
      const fallbackUnit =
        usage.unitMode === 'metro'
          ? 'metro'
          : getDefaultUsageUnit(materialKind)
      const usageUnit = usage.usageUnit ?? fallbackUnit
      if (usageUnit !== usage.usageUnit) {
        markChanged()
      }
      return { ...usage, id: nextId, quantity, usageUnit }
    })
    const rawBatch =
      variant.batchRecipe && typeof variant.batchRecipe === 'object'
        ? variant.batchRecipe
        : undefined
    let batchRecipe = rawBatch
    if (rawBatch) {
      const batchItems = Array.isArray(rawBatch.items) ? rawBatch.items : []
      if (batchItems !== rawBatch.items) {
        markChanged()
      }
      const normalizedItems = batchItems.map((item) => {
        const nextId = item.id || createId()
        if (nextId !== item.id) {
          markChanged()
        }
        const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
        if (quantity !== item.quantity) {
          markChanged()
        }
        const materialKind = materialKindById.get(item.materialId) ?? 'outro'
        const usageUnit = item.usageUnit ?? getDefaultUsageUnit(materialKind)
        if (usageUnit !== item.usageUnit) {
          markChanged()
        }
        return { ...item, id: nextId, quantity, usageUnit }
      })
      const yieldQuantity = Number.isFinite(rawBatch.yieldQuantity)
        ? rawBatch.yieldQuantity
        : 0
      if (yieldQuantity !== rawBatch.yieldQuantity) {
        markChanged()
      }
      const id = rawBatch.id || createId()
      if (id !== rawBatch.id) {
        markChanged()
      }
      const productId = rawBatch.productId || product.id
      if (productId !== rawBatch.productId) {
        markChanged()
      }
      const variantId = rawBatch.variantId || variant.id
      if (variantId !== rawBatch.variantId) {
        markChanged()
      }
      batchRecipe = {
        ...rawBatch,
        id,
        productId,
        variantId,
        yieldQuantity,
        items: normalizedItems,
      }
    }
    if (
      batchRecipe &&
      batchRecipe.items.length > 0 &&
      batchRecipe.yieldQuantity > 0 &&
      (materialUsages.length === 0 || materialUsages.every((usage) => usage.source === 'batch'))
    ) {
      materialUsages = deriveUsagesFromBatch(batchRecipe)
      markChanged()
    }
    return { ...next, materialUsages, batchRecipe }
  })
}

const normalizeMaterialUnit = (unit?: string): MaterialUnit | undefined => {
  if (!unit) {
    return undefined
  }
  const normalized = unit.toLowerCase().trim()
  if (
    normalized === 'saco_50kg' ||
    normalized === 'saco50kg' ||
    normalized === 'saco_50' ||
    normalized === 'saco 50kg' ||
    normalized === 'saco50' ||
    normalized === 'saco'
  ) {
    return 'saco_50kg'
  }
  if (
    normalized === 'm3' ||
    normalized === 'm³' ||
    normalized === 'metro cubico' ||
    normalized === 'metro_cubico' ||
    normalized === 'm^3'
  ) {
    return 'm3'
  }
  if (
    normalized === 'unidade' ||
    normalized === 'unid' ||
    normalized === 'un' ||
    normalized === 'und'
  ) {
    return 'unidade'
  }
  return undefined
}

const normalizeProductUnit = (unit?: string): ProductUnit | undefined => {
  if (!unit) {
    return undefined
  }
  const normalized = unit.toLowerCase().trim()
  if (
    normalized === 'm2' ||
    normalized === 'm²' ||
    normalized === 'metro quadrado' ||
    normalized === 'metro_quadrado' ||
    normalized === 'm^2'
  ) {
    return 'm2'
  }
  if (
    normalized === 'metro_linear' ||
    normalized === 'metro linear' ||
    normalized === 'metro' ||
    normalized === 'm linear' ||
    normalized === 'm'
  ) {
    return 'metro_linear'
  }
  if (
    normalized === 'unidade' ||
    normalized === 'unid' ||
    normalized === 'un' ||
    normalized === 'und'
  ) {
    return 'unidade'
  }
  return undefined
}

const normalizeMaterialKind = (kind?: string): MaterialKind | undefined => {
  if (!kind) {
    return undefined
  }
  const normalized = kind.toLowerCase().trim()
  if (normalized === 'areia') return 'areia'
  if (normalized === 'brita') return 'brita'
  if (normalized === 'cimento') return 'cimento'
  if (normalized === 'trelica') return 'trelica'
  if (normalized === 'aco') return 'aco'
  if (normalized === 'aditivo') return 'aditivo'
  if (normalized === 'agua') return 'agua'
  if (normalized === 'outro') return 'outro'
  return undefined
}

const normalizeData = (data: ERPData) => {
  let changed = false
  const ensureArray = <T>(value: T[] | undefined | null, fallback: T[]) => {
    if (!Array.isArray(value)) {
      changed = true
      return fallback
    }
    return value
  }

  const normalizeCode = (code?: string) => code?.trim().toUpperCase() ?? ''

  const ensureDailyCodes = <
    T extends { id: string; code?: string; seq?: number },
  >(
    items: T[],
    prefix: string,
    getCreatedAt: (item: T) => string | undefined,
    sequenceMap: Map<string, number>,
  ) => {
    const usedCodes = new Set<string>()
    const invalidIds = new Set<string>()

    items.forEach((item) => {
      const code = normalizeCode(item.code)
      if (!code) {
        invalidIds.add(item.id)
        return
      }
      const parsed = parseDailyCode(code, prefix)
      if (!parsed) {
        invalidIds.add(item.id)
        return
      }
      const normalized = buildDailyCode(prefix, parsed.dateKey, parsed.seq)
      if (usedCodes.has(normalized)) {
        invalidIds.add(item.id)
        return
      }
      usedCodes.add(normalized)
      const key = `${prefix}-${parsed.dateKey}`
      const current = sequenceMap.get(key) ?? 0
      if (parsed.seq > current) {
        sequenceMap.set(key, parsed.seq)
      }
    })

    let itemChanged = false
    const nextItems = items.map((item) => {
      const createdAt = getCreatedAt(item)
      const dateKey = getDateKey(createdAt)
      const sequenceKey = `${prefix}-${dateKey}`
      let code = normalizeCode(item.code)
      let seq = Number.isFinite(item.seq) ? item.seq : undefined
      const shouldGenerate = invalidIds.has(item.id) || !code
      if (shouldGenerate) {
        const nextSeq = (sequenceMap.get(sequenceKey) ?? 0) + 1
        sequenceMap.set(sequenceKey, nextSeq)
        code = buildDailyCode(prefix, dateKey, nextSeq)
        seq = nextSeq
      } else {
        const parsed = parseDailyCode(code, prefix)
        if (parsed) {
          code = buildDailyCode(prefix, parsed.dateKey, parsed.seq)
          seq = parsed.seq
        }
      }
      if (code !== item.code || seq !== item.seq) {
        itemChanged = true
        return { ...item, code, seq }
      }
      return item
    })

    return { items: nextItems, changed: itemChanged }
  }

  const ensurePublicCodes = <T extends { id: string; publicCode?: string }>(
    items: T[],
  ) => {
    const used = new Set<string>()
    const invalidIds = new Set<string>()
    items.forEach((item) => {
      const code = item.publicCode?.trim().toLowerCase() ?? ''
      if (!code) {
        invalidIds.add(item.id)
        return
      }
      if (used.has(code)) {
        invalidIds.add(item.id)
        return
      }
      used.add(code)
    })
    let changedPublic = false
    const nextItems = items.map((item) => {
      const current = item.publicCode?.trim().toLowerCase() ?? ''
      if (!current || invalidIds.has(item.id)) {
        let nextCode = ''
        let guard = 0
        do {
          nextCode = generatePublicCode()
          guard += 1
        } while (used.has(nextCode) && guard < 50)
        used.add(nextCode)
        changedPublic = true
        return { ...item, publicCode: nextCode }
      }
      if (current !== item.publicCode) {
        changedPublic = true
        return { ...item, publicCode: current }
      }
      return item
    })
    return { items: nextItems, changed: changedPublic }
  }

  const normalizeProductionStatus = (status?: string): ProductionOrder['status'] => {
    const raw = status?.trim().toUpperCase()
    if (!raw) {
      return 'ABERTA'
    }
    if (raw === 'ABERTA' || raw === 'EM_ANDAMENTO' || raw === 'PARCIAL') {
      return raw
    }
    if (raw === 'CONCLUIDA' || raw === 'CANCELADA') {
      return raw
    }
    if (raw === 'EM_PRODUCAO') {
      return 'EM_ANDAMENTO'
    }
    if (raw === 'FINALIZADA') {
      return 'CONCLUIDA'
    }
    if (raw === 'ABERTA' || raw === 'ABERTO') {
      return 'ABERTA'
    }
    return 'ABERTA'
  }

  const rawMaterials = ensureArray(data.materiais, [])
  const materialKindById = new Map<string, MaterialKind>()
  rawMaterials.forEach((material) => {
    const kind = normalizeMaterialKind(material.kind) ?? 'outro'
    materialKindById.set(material.id, kind)
  })

  const produtos = ensureArray(data.produtos, []).map((product) => {
    const variants = normalizeVariants(product, materialKindById, () => {
      changed = true
    })
    const priceMin = product.priceMin ?? undefined
    const maxDiscountPercent = product.maxDiscountPercent ?? undefined
    if (product.priceMin === null || product.maxDiscountPercent === null) {
      changed = true
    }
    const unit = normalizeProductUnit(product.unit)
    if (unit !== product.unit) {
      changed = true
    }
    const rawUsages = ensureArray<ProductMaterialUsage>(product.materialUsages, [])
    if (rawUsages !== product.materialUsages) {
      changed = true
    }
    let materialUsages: ProductMaterialUsage[] = rawUsages.map((usage) => {
      const nextId = usage.id || createId()
      if (nextId !== usage.id) {
        changed = true
      }
      const quantity = Number.isFinite(usage.quantity) ? usage.quantity : 0
      if (quantity !== usage.quantity) {
        changed = true
      }
      const materialKind = materialKindById.get(usage.materialId) ?? 'outro'
      const fallbackUnit =
        usage.unitMode === 'metro'
          ? 'metro'
          : getDefaultUsageUnit(materialKind)
      const usageUnit = usage.usageUnit ?? fallbackUnit
      if (usageUnit !== usage.usageUnit) {
        changed = true
      }
      return { ...usage, id: nextId, quantity, usageUnit }
    })
    const rawBatch =
      product.batchRecipe && typeof product.batchRecipe === 'object'
        ? product.batchRecipe
        : undefined
    let batchRecipe = rawBatch
    if (rawBatch) {
      const batchItems = ensureArray(rawBatch.items, [])
      if (batchItems !== rawBatch.items) {
        changed = true
      }
      const normalizedItems = batchItems.map((item) => {
        const nextId = item.id || createId()
        if (nextId !== item.id) {
          changed = true
        }
        const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
        if (quantity !== item.quantity) {
          changed = true
        }
        const materialKind = materialKindById.get(item.materialId) ?? 'outro'
        const usageUnit = item.usageUnit ?? getDefaultUsageUnit(materialKind)
        if (usageUnit !== item.usageUnit) {
          changed = true
        }
        return { ...item, id: nextId, quantity, usageUnit }
      })
      const yieldQuantity = Number.isFinite(rawBatch.yieldQuantity)
        ? rawBatch.yieldQuantity
        : 0
      if (yieldQuantity !== rawBatch.yieldQuantity) {
        changed = true
      }
      const id = rawBatch.id || createId()
      if (id !== rawBatch.id) {
        changed = true
      }
      const productId = rawBatch.productId || product.id
      if (productId !== rawBatch.productId) {
        changed = true
      }
      batchRecipe = {
        ...rawBatch,
        id,
        productId,
        yieldQuantity,
        items: normalizedItems,
      }
    }
    if (
      batchRecipe &&
      batchRecipe.items.length > 0 &&
      batchRecipe.yieldQuantity > 0 &&
      (materialUsages.length === 0 || materialUsages.every((usage) => usage.source === 'batch'))
    ) {
      materialUsages = deriveUsagesFromBatch(batchRecipe)
      changed = true
    }
    const hasVariants =
      typeof product.hasVariants === 'boolean'
        ? product.hasVariants
        : variants.length > 0
    if (hasVariants !== product.hasVariants) {
      changed = true
    }
    const producedInternally =
      typeof product.producedInternally === 'boolean'
        ? product.producedInternally
        : true
    if (producedInternally !== product.producedInternally) {
      changed = true
    }
    const demoldTimeDays =
      typeof product.demoldTimeDays === 'number' && Number.isFinite(product.demoldTimeDays)
        ? Math.max(0, product.demoldTimeDays)
        : undefined
    if (demoldTimeDays !== product.demoldTimeDays) {
      changed = true
    }
    return {
      ...product,
      priceMin,
      maxDiscountPercent,
      variants,
      unit,
      producedInternally,
      hasVariants,
      materialUsages,
      batchRecipe,
      demoldTimeDays,
    }
  })

  const primaryVariantByProduct = new Map<string, string>()
  const productUnitById = new Map<string, ProductUnit | undefined>()
  const productLengthById = new Map<string, number | undefined>()
  const productHasVariantsById = new Map<string, boolean>()
  produtos.forEach((product) => {
    if (product.variants && product.variants.length > 0) {
      primaryVariantByProduct.set(product.id, product.variants[0].id)
    }
    productUnitById.set(product.id, product.unit)
    productLengthById.set(product.id, product.length)
    productHasVariantsById.set(product.id, product.hasVariants ?? false)
  })

  const normalizeItems = <
    T extends {
      productId: string
      variantId?: string
      customLength?: number
      customWidth?: number
      customHeight?: number
    },
  >(
    items: T[],
  ) =>
    items.map((item) => {
      const next = { ...item }
      const unit = productUnitById.get(item.productId)
      const hasVariants = productHasVariantsById.get(item.productId) ?? false
      if (!item.variantId && unit !== 'metro_linear' && hasVariants) {
        const fallbackVariant = primaryVariantByProduct.get(item.productId)
        if (fallbackVariant) {
          changed = true
          next.variantId = fallbackVariant
        }
      }
      const length =
        typeof item.customLength === 'number' && Number.isFinite(item.customLength)
          ? item.customLength
          : 0
      const width =
        typeof item.customWidth === 'number' && Number.isFinite(item.customWidth)
          ? item.customWidth
          : 0
      const height =
        typeof item.customHeight === 'number' && Number.isFinite(item.customHeight)
          ? item.customHeight
          : 0
      if (
        length !== item.customLength ||
        width !== item.customWidth ||
        height !== item.customHeight
      ) {
        changed = true
        return { ...next, customLength: length, customWidth: width, customHeight: height }
      }
      return next
    })

  const normalizePayments = (payments: unknown): OrderPayment[] => {
    const raw = Array.isArray(payments) ? payments : []
    if (!Array.isArray(payments)) {
      changed = true
    }
    return raw
      .map((payment) => {
        if (!payment || typeof payment !== 'object') {
          changed = true
          return null
        }
        const paymentRecord = payment as Partial<OrderPayment>
        const amount = Number.isFinite(paymentRecord.amount) ? paymentRecord.amount : 0
        const receivedAt =
          typeof paymentRecord.receivedAt === 'string' && paymentRecord.receivedAt
            ? paymentRecord.receivedAt
            : new Date().toISOString().slice(0, 10)
        const id = paymentRecord.id || createId()
        if (
          amount !== paymentRecord.amount ||
          receivedAt !== paymentRecord.receivedAt ||
          id !== paymentRecord.id
        ) {
          changed = true
        }
        return {
          id,
          amount,
          receivedAt,
        }
      })
      .filter((payment): payment is OrderPayment => !!payment)
  }

  const clientes = ensureArray(data.clientes, []).map((client) => ({
    ...client,
    obras: Array.isArray(client.obras) ? client.obras : [],
  }))
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : undefined
  const fornecedores = ensureArray(data.fornecedores, [])
  const nfceItemAliases = ensureArray(data.nfceItemAliases, [])
  const materiais = rawMaterials.map((material) => {
    const unit = normalizeMaterialUnit(material.unit)
    if (unit !== material.unit) {
      changed = true
    }
    const kind = normalizeMaterialKind(material.kind) ?? 'outro'
    if (kind !== material.kind) {
      changed = true
    }
    const metersPerUnit =
      material.metersPerUnit && material.metersPerUnit > 0
        ? material.metersPerUnit
        : undefined
    if (metersPerUnit !== material.metersPerUnit) {
      changed = true
    }
    if (material.stock === undefined || material.stock === null) {
      changed = true
      return { ...material, stock: 0, unit, kind, metersPerUnit }
    }
    return { ...material, unit, kind, metersPerUnit }
  })
  const moldes = ensureArray(data.moldes, []).map((mold) => {
    if (mold.stock === undefined || mold.stock === null) {
      changed = true
      return { ...mold, stock: 0 }
    }
    return mold
  })
  const ordensProducao = ensureArray(data.ordensProducao, [])
  let lotesProducao = ensureArray(data.lotesProducao, [])
  const productionEntries = ensureArray(data.productionEntries, []).map((entry) => {
    let entryChanged = false
    const quantity = Number.isFinite(entry.quantity) ? entry.quantity : 0
    if (quantity !== entry.quantity) {
      entryChanged = true
    }
    const lengthM = Number.isFinite(entry.lengthM) ? entry.lengthM : undefined
    if (lengthM !== entry.lengthM) {
      entryChanged = true
    }
    const scrapQuantity = Number.isFinite(entry.scrapQuantity)
      ? entry.scrapQuantity
      : undefined
    if (scrapQuantity !== entry.scrapQuantity) {
      entryChanged = true
    }
    const scrapLengthM = Number.isFinite(entry.scrapLengthM)
      ? entry.scrapLengthM
      : undefined
    if (scrapLengthM !== entry.scrapLengthM) {
      entryChanged = true
    }
    const date = entry.date ? entry.date.slice(0, 10) : new Date().toISOString().slice(0, 10)
    if (date !== entry.date) {
      entryChanged = true
    }
    const createdAt = entry.createdAt ?? new Date().toISOString()
    if (createdAt !== entry.createdAt) {
      entryChanged = true
    }
    const notes = entry.notes?.trim() || undefined
    if (notes !== entry.notes) {
      entryChanged = true
    }
    if (entryChanged) {
      changed = true
      return {
        ...entry,
        quantity,
        lengthM,
        scrapQuantity,
        scrapLengthM,
        date,
        createdAt,
        notes,
      }
    }
    return entry
  })
  const productionEntriesByOrder = new Map<string, typeof productionEntries>()
  productionEntries.forEach((entry) => {
    if (!entry.productionOrderId) {
      return
    }
    const current = productionEntriesByOrder.get(entry.productionOrderId) ?? []
    current.push(entry)
    productionEntriesByOrder.set(entry.productionOrderId, current)
  })
  const refugosProducao = ensureArray(data.refugosProducao, []).map((scrap) => {
    let changedScrap = false
    const next = { ...scrap } as typeof scrap & { status?: ProductionScrapStatus }
    const unit = productUnitById.get(scrap.productId)
    const hasVariants = productHasVariantsById.get(scrap.productId) ?? false
    if (!scrap.variantId && unit !== 'metro_linear' && hasVariants) {
      const fallbackVariant = primaryVariantByProduct.get(scrap.productId)
      if (fallbackVariant) {
        changed = true
        changedScrap = true
        next.variantId = fallbackVariant
      }
    }
    const quantity = Number.isFinite(scrap.quantity) ? scrap.quantity : 0
    if (quantity !== scrap.quantity) {
      changed = true
      changedScrap = true
      next.quantity = quantity
    }
    const estimatedCost = Number.isFinite(scrap.estimatedCost)
      ? scrap.estimatedCost
      : undefined
    if (estimatedCost !== scrap.estimatedCost) {
      changed = true
      changedScrap = true
      next.estimatedCost = estimatedCost
    }
    if (scrap.type === 'retrabalho') {
      const nextStatus: ProductionScrapStatus =
        scrap.status === 'resolvido' ? 'resolvido' : 'aberto'
      if (nextStatus !== scrap.status) {
        changed = true
        changedScrap = true
        next.status = nextStatus
      }
    } else if ('status' in next) {
      changed = true
      changedScrap = true
      delete next.status
    }
    return changedScrap ? next : scrap
  })
  const ajustesEstoqueProdutos = ensureArray(data.ajustesEstoqueProdutos, []).map(
    (entry) => {
      let entryChanged = false
      const quantity = Number.isFinite(entry.quantity) ? entry.quantity : 0
      if (quantity !== entry.quantity) {
        entryChanged = true
      }
      const lengthM = Number.isFinite(entry.lengthM) ? entry.lengthM : undefined
      if (lengthM !== entry.lengthM) {
        entryChanged = true
      }
      if (entryChanged) {
        changed = true
        return { ...entry, quantity, lengthM }
      }
      return entry
    },
  )
  const stockItems = ensureArray(data.stockItems, []).map((item) => {
    let itemChanged = false
    const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
    if (quantity !== item.quantity) {
      itemChanged = true
    }
    const lengthM = Number.isFinite(item.lengthM) ? item.lengthM : undefined
    if (lengthM !== item.lengthM) {
      itemChanged = true
    }
    const unit = item.unit === 'm' || item.unit === 'un' ? item.unit : 'un'
    if (unit !== item.unit) {
      itemChanged = true
    }
    const createdAt = item.createdAt ?? new Date().toISOString()
    if (createdAt !== item.createdAt) {
      itemChanged = true
    }
    const updatedAt = item.updatedAt || undefined
    if (updatedAt !== item.updatedAt) {
      itemChanged = true
    }
    const code = item.code?.trim() || undefined
    if (code !== item.code) {
      itemChanged = true
    }
    if (itemChanged) {
      changed = true
      return {
        ...item,
        quantity,
        lengthM,
        unit,
        createdAt,
        updatedAt,
        code,
      }
    }
    return item
  })
  const consumosMateriais = ensureArray(data.consumosMateriais, [])
  const orcamentos = ensureArray(data.orcamentos, []).map((quote) => ({
    ...quote,
    items: normalizeItems(quote.items),
  }))
  const pedidosRaw = ensureArray(data.pedidos, []).map((order) => ({
    ...order,
    paymentMethod: order.paymentMethod?.trim() || 'a_definir',
    items: normalizeItems(order.items),
    payments: normalizePayments(order.payments),
  }))
  let pedidos = (() => {
    const indexById = new Map<string, number>()
    const unique: typeof pedidosRaw = []
    pedidosRaw.forEach((order) => {
      const existingIndex = indexById.get(order.id)
      if (existingIndex === undefined) {
        indexById.set(order.id, unique.length)
        unique.push(order)
        return
      }
      unique[existingIndex] = order
    })
    if (unique.length !== pedidosRaw.length) {
      changed = true
    }
    const { orders: normalizedOrders, changed: codesChanged } = ensureOrderCodes(unique)
    if (codesChanged) {
      changed = true
    }
    return normalizedOrders
  })()
  let sequences = ensureArray(data.sequences, [])
  const sequenceMap = new Map<string, number>(
    sequences.map((entry) => [entry.key, entry.currentValue]),
  )
  const { items: codedOrders, changed: codesGenerated } = ensureDailyCodes(
    pedidos,
    'PED',
    (order) => order.createdAt,
    sequenceMap,
  )
  if (codesGenerated) {
    changed = true
  }
  const { items: publicOrders, changed: publicCodesChanged } = ensurePublicCodes(codedOrders)
  if (publicCodesChanged) {
    changed = true
  }
  pedidos = publicOrders
  const recibos = ensureArray(data.recibos, [])
  const comprasHistorico = ensureArray(data.comprasHistorico, []).map((purchase) => {
    if (!Array.isArray(purchase.items)) {
      changed = true
      return { ...purchase, items: [] }
    }
    return purchase
  })
  const pedidosById = new Map(pedidos.map((order) => [order.id, order]))
  const producaoById = new Map(ordensProducao.map((order) => [order.id, order]))

  const buildDeliveryItemsFromOrder = (order: Order): DeliveryItem[] =>
    order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      customLength: item.customLength,
      customWidth: item.customWidth,
      customHeight: item.customHeight,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    }))

  const buildDeliveryItemFromProduction = (
    production: (typeof ordensProducao)[number],
  ): DeliveryItem => ({
    productId: production.productId,
    variantId: production.variantId,
    customLength: production.customLength,
    quantity: production.quantity,
  })

  const entregas = ensureArray(data.entregas, []).map((delivery) => {
    let deliveryChanged = false
    const rawItems = Array.isArray(delivery.items) ? delivery.items : []
    if (rawItems !== delivery.items) {
      deliveryChanged = true
    }

    let items: DeliveryItem[] = rawItems.map((item) => {
      let itemChanged = false
      const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
      if (quantity !== item.quantity) {
        itemChanged = true
      }
      const customLength = Number.isFinite(item.customLength) ? item.customLength : undefined
      const customWidth = Number.isFinite(item.customWidth) ? item.customWidth : undefined
      const customHeight = Number.isFinite(item.customHeight) ? item.customHeight : undefined
      if (
        customLength !== item.customLength ||
        customWidth !== item.customWidth ||
        customHeight !== item.customHeight
      ) {
        itemChanged = true
      }
      const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : undefined
      if (unitPrice !== item.unitPrice) {
        itemChanged = true
      }
      if (itemChanged) {
        deliveryChanged = true
        return {
          ...item,
          quantity,
          customLength,
          customWidth,
          customHeight,
          unitPrice,
        }
      }
      return item
    })

    if (items.length === 0) {
      const production = producaoById.get(delivery.productionOrderId)
      if (production) {
        items = [buildDeliveryItemFromProduction(production)]
        deliveryChanged = true
      } else {
        const order = pedidosById.get(delivery.orderId)
        if (order) {
          items = buildDeliveryItemsFromOrder(order)
          deliveryChanged = true
        }
      }
    }

    const order = pedidosById.get(delivery.orderId)
    if (order && items.length > 0) {
      const orderItemsByKey = new Map<string, Order['items'][number][]>()
      order.items.forEach((item) => {
        const key = buildItemKey({ ...item, unitPrice: undefined })
        const current = orderItemsByKey.get(key)
        if (current) {
          current.push(item)
        } else {
          orderItemsByKey.set(key, [item])
        }
      })
      items = items.map((item) => {
        if (Number.isFinite(item.unitPrice)) {
          return item
        }
        const key = buildItemKey({ ...item, unitPrice: undefined })
        const matches = orderItemsByKey.get(key)
        if (matches && matches.length === 1) {
          deliveryChanged = true
          return { ...item, unitPrice: matches[0].unitPrice }
        }
        return item
      })
    }

    if (deliveryChanged) {
      changed = true
      return { ...delivery, items }
    }
    return delivery
  })
  const fiscalNotas = ensureArray(data.fiscalNotas, [])
  const qualidadeChecks = ensureArray(data.qualidadeChecks, [])
  const manutencoes = ensureArray(data.manutencoes, [])
  const financeiro = ensureArray(data.financeiro, []).map((entry) => {
    if (!entry.cashboxId) {
      changed = true
      return { ...entry, cashboxId: 'caixa_producao' }
    }
    return entry
  })
  const caixas = ensureArray(data.caixas, DEFAULT_CASHBOXES.map((cashbox) => ({ ...cashbox })))
  const physicalCashBalance = typeof data.physicalCashBalance === 'number' ? data.physicalCashBalance : 0
  const conferenciasCaixaFisico = ensureArray(data.conferenciasCaixaFisico, [])
  const pdvCaixas = ensureArray(data.pdvCaixas, [])
  const pdvMovimentacoes = ensureArray(data.pdvMovimentacoes, [])
  const tabelasRaw =
    data.tabelas && typeof data.tabelas === 'object' ? data.tabelas : undefined
  if (!tabelasRaw) {
    changed = true
  }
  const tabelas = {
    units: ensureArray(tabelasRaw?.units, DEFAULT_TABLES.units.map((item) => ({ ...item }))),
    categories: ensureArray(
      tabelasRaw?.categories,
      DEFAULT_TABLES.categories.map((item) => ({ ...item })),
    ),
    paymentMethods: ensureArray(
      tabelasRaw?.paymentMethods,
      DEFAULT_TABLES.paymentMethods.map((item) => ({ ...item })),
    ),
  }
  const auditoria = ensureArray(data.auditoria, [])
  const integracoes = ensureArray(
    data.integracoes,
    DEFAULT_INTEGRATIONS.map((item) => ({ ...item })),
  )
  let empresa = data.empresa && typeof data.empresa === 'object' ? data.empresa : null
  if (!empresa) {
    changed = true
    empresa = { ...DEFAULT_COMPANY }
  }
  const funcionarios = ensureArray(data.funcionarios, [])
  const defaultRoles = DEFAULT_ROLES.map((role) => ({ ...role }))
  const defaultLevels = DEFAULT_LEVELS.map((level) => ({ ...level }))
  const cargos = ensureArray(data.cargos, defaultRoles).map((role) => {
    if (role.permissions && typeof role.permissions !== 'object') {
      changed = true
      return { ...role, permissions: undefined }
    }
    return role
  })
  const niveis = ensureArray(data.niveis, defaultLevels)
  if (cargos.length === 0) {
    changed = true
    cargos.push(...defaultRoles)
  }
  if (cargos.length > 0) {
    const roleIds = new Set(cargos.map((role) => role.id))
    defaultRoles.forEach((role) => {
      if (!roleIds.has(role.id)) {
        cargos.push(role)
        changed = true
      }
    })
  }
  if (niveis.length === 0) {
    changed = true
    niveis.push(...defaultLevels)
  }
  if (caixas.length === 0) {
    changed = true
    caixas.push(...DEFAULT_CASHBOXES.map((cashbox) => ({ ...cashbox })))
  }
  const apontamentos = ensureArray(data.apontamentos, [])
  const presencas = ensureArray(data.presencas, [])
  const presenceLogs = ensureArray(data.presenceLogs, [])
  const legacyPinAttempts = (data as { terminalPinAttempts?: typeof data.popPinAttempts })
    .terminalPinAttempts
  const popPinAttempts = ensureArray(data.popPinAttempts ?? legacyPinAttempts, [])
  if (!data.popPinAttempts && Array.isArray(legacyPinAttempts)) {
    changed = true
  }
  const pagamentosRH = ensureArray(data.pagamentosRH, [])
  const ocorrenciasRH = ensureArray(data.ocorrenciasRH, [])
  const usuariosRaw = ensureArray(data.usuarios, [])
  const usuarios = usuariosRaw.map((user) => {
    const { avatarUrl, ...rest } = user
    if (typeof avatarUrl !== 'undefined') {
      changed = true
      return rest
    }
    return user
  })
  let normalizedProducao = ordensProducao.map((order) => {
    let next = order
    let orderChanged = false
    const unit = productUnitById.get(order.productId)
    const isLinear = unit === 'metro_linear'
    if (
      !order.variantId &&
      unit !== 'metro_linear' &&
      productHasVariantsById.get(order.productId)
    ) {
      const fallbackVariant = primaryVariantByProduct.get(order.productId)
      if (fallbackVariant) {
        changed = true
        orderChanged = true
        next = { ...next, variantId: fallbackVariant }
      }
    }
    const linkedOrderId = order.linkedOrderId || undefined
    if (linkedOrderId !== order.linkedOrderId) {
      changed = true
      orderChanged = true
      next = { ...next, linkedOrderId }
    }
    const originProductionOrderId = order.originProductionOrderId || undefined
    if (originProductionOrderId !== order.originProductionOrderId) {
      changed = true
      orderChanged = true
      next = { ...next, originProductionOrderId }
    }
    const createdAt =
      order.createdAt ?? order.plannedAt ?? order.finishedAt ?? new Date().toISOString()
    if (createdAt !== order.createdAt) {
      changed = true
      orderChanged = true
      next = { ...next, createdAt }
    }
    const plannedQty = Number.isFinite(order.plannedQty)
      ? Number(order.plannedQty)
      : order.quantity
    if (plannedQty !== order.plannedQty) {
      changed = true
      orderChanged = true
      next = { ...next, plannedQty }
    }
    const resolvedLength = isLinear
      ? Number.isFinite(order.plannedLengthM)
        ? order.plannedLengthM
        : Number.isFinite(order.customLength)
          ? order.customLength
          : productLengthById.get(order.productId)
      : undefined
    if (resolvedLength !== order.plannedLengthM) {
      changed = true
      orderChanged = true
      next = { ...next, plannedLengthM: resolvedLength }
    }

    const entries = productionEntriesByOrder.get(order.id) ?? []
    let producedQty = Number.isFinite(order.producedQty) ? Number(order.producedQty) : 0
    let producedLengthM = Number.isFinite(order.producedLengthM)
      ? Number(order.producedLengthM)
      : 0
    if (entries.length > 0) {
      producedQty = 0
      producedLengthM = 0
      entries.forEach((entry) => {
        const entryQty = Number.isFinite(entry.quantity) ? Math.max(0, entry.quantity) : 0
        const entryScrap = Number.isFinite(entry.scrapQuantity)
          ? Math.max(0, entry.scrapQuantity ?? 0)
          : 0
        const netQty = Math.max(0, entryQty - entryScrap)
        producedQty += netQty
        if (isLinear) {
          const entryLength = Number.isFinite(entry.lengthM)
            ? Math.max(0, entry.lengthM ?? 0)
            : Math.max(0, resolvedLength ?? 0)
          const entryProduced = netQty * entryLength
          const entryScrapLength = Number.isFinite(entry.scrapLengthM)
            ? Math.max(0, entry.scrapLengthM ?? 0)
            : 0
          producedLengthM += Math.max(0, entryProduced - entryScrapLength)
        }
      })
    }
    if (producedQty !== order.producedQty) {
      changed = true
      orderChanged = true
      next = { ...next, producedQty }
    }
    const nextProducedLength = isLinear ? producedLengthM : undefined
    if (nextProducedLength !== order.producedLengthM) {
      changed = true
      orderChanged = true
      next = { ...next, producedLengthM: nextProducedLength }
    }

    let status = normalizeProductionStatus(order.status)
    if (entries.length > 0 && status !== 'CANCELADA') {
      const plannedTotal = isLinear
        ? (plannedQty ?? 0) * (resolvedLength ?? 0)
        : plannedQty ?? 0
      const producedTotal = isLinear ? producedLengthM : producedQty
      if (plannedTotal > 0 && producedTotal >= plannedTotal) {
        status = 'CONCLUIDA'
      } else if (producedTotal > 0) {
        status = 'PARCIAL'
      } else if (status === 'EM_ANDAMENTO') {
        status = 'EM_ANDAMENTO'
      } else {
        status = 'ABERTA'
      }
    }
    if (status !== order.status) {
      changed = true
      orderChanged = true
      next = { ...next, status }
    }

    return orderChanged ? next : order
  })

  const { items: codedProductions, changed: productionCodesChanged } = ensureDailyCodes(
    normalizedProducao,
    'OP',
    (order) => order.createdAt ?? order.plannedAt ?? order.finishedAt,
    sequenceMap,
  )
  if (productionCodesChanged) {
    changed = true
  }
  normalizedProducao = codedProductions

  const { items: codedLots, changed: lotCodesChanged } = ensureDailyCodes(
    lotesProducao,
    'LOT',
    (lot) => lot.createdAt,
    sequenceMap,
  )
  if (lotCodesChanged) {
    changed = true
  }
  lotesProducao = codedLots

  const nextSequences = Array.from(sequenceMap.entries()).map(([key, currentValue]) => ({
    key,
    currentValue,
  }))
  const sequencesByKey = new Map(sequences.map((entry) => [entry.key, entry.currentValue]))
  const sequencesChanged =
    nextSequences.length !== sequences.length ||
    nextSequences.some(
      (entry) => sequencesByKey.get(entry.key) !== entry.currentValue,
    )
  if (sequencesChanged) {
    sequences = nextSequences
    changed = true
  }

  const normalized = {
    ...data,
    produtos,
    clientes,
    fornecedores,
    materiais,
    moldes,
    ordensProducao: normalizedProducao,
    lotesProducao,
    productionEntries,
    refugosProducao,
    ajustesEstoqueProdutos,
    stockItems,
    consumosMateriais,
    orcamentos,
    pedidos,
    recibos,
    comprasHistorico,
    nfceItemAliases,
    entregas,
    fiscalNotas,
    qualidadeChecks,
    manutencoes,
    financeiro,
    caixas,
    physicalCashBalance,
    conferenciasCaixaFisico,
    pdvCaixas,
    pdvMovimentacoes,
    tabelas,
    empresa: { ...DEFAULT_COMPANY, ...empresa },
    integracoes,
    funcionarios,
    cargos,
    niveis,
    apontamentos,
    presencas,
    presenceLogs,
    popPinAttempts,
    pagamentosRH,
    ocorrenciasRH,
    usuarios,
    auditoria,
    sequences,
    meta,
  }

  if (changed) {
    saveAndSync(normalized, { emitEvent: false })
  }

  return normalized
}

export const dataService: DataService = {
  getAll: () => normalizeData(getStorage() ?? createEmptyState()),
  replaceAll: (data, options) => saveAndSync(applyAudit(data, options), options),
  exportJson: () => JSON.stringify(normalizeData(getStorage() ?? createEmptyState()), null, 2),
  importJson: (payload) => {
    const parsed = JSON.parse(payload) as ERPData
    saveAndSync(parsed)
  },
  upsertQuote: (quote, options) => {
    const data = getStorage() ?? createEmptyState()
    data.orcamentos = upsert(data.orcamentos, quote)
    saveAndSync(applyAudit(data, options), options)
  },
  upsertOrder: (order, options) => {
    const data = getStorage() ?? createEmptyState()
    data.pedidos = upsert(data.pedidos, order)
    saveAndSync(applyAudit(data, options), options)
  },
  addReceipt: (receipt, options) => {
    const data = getStorage() ?? createEmptyState()
    data.recibos = [...data.recibos, receipt]
    saveAndSync(applyAudit(data, options), options)
  },
  addFinanceEntry: (entry, options) => {
    const data = getStorage() ?? createEmptyState()
    data.financeiro = [...data.financeiro, entry]
    saveAndSync(applyAudit(data, options), options)
  },
  upsertPdvCashSession: (session, options) => {
    const data = getStorage() ?? createEmptyState()
    data.pdvCaixas = upsert(data.pdvCaixas, session)
    saveAndSync(applyAudit(data, options), options)
  },
  addPdvCashMovement: (movement, options) => {
    const data = getStorage() ?? createEmptyState()
    data.pdvMovimentacoes = [...data.pdvMovimentacoes, movement]
    saveAndSync(applyAudit(data, options), options)
  },
}

export const ensureStorageSeed = () => {
  const current = getStorage()
  if (!current) {
    saveAndSync(createEmptyState())
  }
}

export const setRemoteSync = (handler: RemoteSync | null) => {
  remoteSync = handler
}
