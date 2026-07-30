import type { Material, Order, Product, ProductVariant } from '../types/erp'
import { convertUsageToPurchaseQuantity, getDefaultUsageUnit } from './materialUsage'

type PricingItem = {
  product: Product
  variant?: ProductVariant
  unitPrice: number
  quantity: number
  customLength?: number
  customWidth?: number
}

type PricingContext = {
  materials?: Material[]
  customLength?: number
  customWidth?: number
}

const normalizeNumber = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const resolveLength = (
  product: Product,
  variant?: ProductVariant,
  customLength?: number,
) => {
  const custom = normalizeNumber(customLength)
  if (custom > 0) {
    return custom
  }
  const variantLength = normalizeNumber(variant?.length)
  if (variantLength > 0) {
    return variantLength
  }
  const productLength = normalizeNumber(product.length)
  if (productLength > 0) {
    return productLength
  }
  return 1
}

const resolveWidth = (
  product: Product,
  variant?: ProductVariant,
  customWidth?: number,
) => {
  const custom = normalizeNumber(customWidth)
  if (custom > 0) {
    return custom
  }
  const variantWidth = normalizeNumber(variant?.width)
  if (variantWidth > 0) {
    return variantWidth
  }
  const productWidth = normalizeNumber(product.width)
  if (productWidth > 0) {
    return productWidth
  }
  return 1
}

export const getUnitFactor = (
  product: Product,
  variant?: ProductVariant,
  customLength?: number,
  customWidth?: number,
) => {
  if (product.unit === 'metro_linear') {
    return resolveLength(product, variant, customLength)
  }
  if (product.unit === 'm2') {
    return (
      resolveLength(product, variant, customLength) *
      resolveWidth(product, variant, customWidth)
    )
  }
  return 1
}

const getMaterialUnitPrice = (material: Material) => {
  const unitPrice = normalizeNumber(material.marketUnitPrice) || normalizeNumber(material.cost)
  if (unitPrice > 0) {
    return unitPrice
  }
  const lotPrice = normalizeNumber(material.marketLotPrice)
  const lotSize = normalizeNumber(material.lotSize)
  if (lotPrice > 0 && lotSize > 0) {
    return lotPrice / lotSize
  }
  return 0
}

export const getMaterialUnitCost = (
  product: Product,
  variant?: ProductVariant,
  context?: PricingContext,
) => {
  const materials = context?.materials ?? []
  const usages =
    (variant?.materialUsages && variant.materialUsages.length > 0
      ? variant.materialUsages
      : product.materialUsages) ?? []
  if (materials.length === 0 || usages.length === 0) {
    return 0
  }
  const factor = getUnitFactor(
    product,
    variant,
    context?.customLength,
    context?.customWidth,
  )
  if (!Number.isFinite(factor) || factor <= 0) {
    return 0
  }
  return usages.reduce((acc, usage) => {
    const material = materials.find((item) => item.id === usage.materialId)
    if (!material) {
      return acc
    }
    const usageUnit =
      usage.usageUnit ??
      (usage.unitMode === 'metro' ? 'metro' : getDefaultUsageUnit(material.kind ?? 'outro'))
    const rawQuantity = normalizeNumber(usage.quantity) * factor
    const quantity = convertUsageToPurchaseQuantity(material, usageUnit, rawQuantity)
    const unitPrice = getMaterialUnitPrice(material)
    return acc + quantity * unitPrice
  }, 0)
}

export const getBasePrice = (product: Product, variant?: ProductVariant) =>
  variant?.priceOverride ?? product.price

export const getBaseCost = (
  product: Product,
  variant?: ProductVariant,
  context?: PricingContext,
) => {
  const override = normalizeNumber(variant?.costOverride)
  if (override > 0) {
    return override
  }
  const materialCost = getMaterialUnitCost(product, variant, context)
  if (materialCost > 0) {
    return materialCost
  }
  return normalizeNumber(product.costPrice)
}

export const getLaborUnitCost = (
  product: Product,
  variant?: ProductVariant,
  customLength?: number,
) => {
  const labor = normalizeNumber(product.laborCost)
  if (labor <= 0) {
    return 0
  }
  if (product.laborBasis === 'metro') {
    return labor * resolveLength(product, variant, customLength)
  }
  return labor
}

export const getMinUnitPrice = (
  product: Product,
  variant?: ProductVariant,
  context?: PricingContext,
) => {
  const unitCost =
    getBaseCost(product, variant, context) +
    getLaborUnitCost(product, variant, context?.customLength)
  const minPrice = normalizeNumber(product.priceMin)
  return Math.max(unitCost, minPrice)
}

export const getMaxDiscountPercentForItem = (
  item: PricingItem,
  materials?: Material[],
) => {
  const unitPrice = normalizeNumber(item.unitPrice)
  if (unitPrice <= 0) {
    return 0
  }
  const minUnit = getMinUnitPrice(item.product, item.variant, {
    customLength: item.customLength,
    customWidth: item.customWidth,
    materials,
  })
  if (unitPrice <= minUnit) {
    return 0
  }
  const percent = ((unitPrice - minUnit) / unitPrice) * 100
  const manualCap = normalizeNumber(item.product.maxDiscountPercent)
  if (manualCap > 0) {
    return Math.max(0, Math.min(percent, manualCap))
  }
  return Math.max(0, percent)
}

export const getMaxDiscountSummary = (items: PricingItem[], materials?: Material[]) => {
  let subtotal = 0
  let minSubtotal = 0
  let maxPercent = Number.POSITIVE_INFINITY

  items.forEach((item) => {
    const unitPrice = normalizeNumber(item.unitPrice)
    const quantity = Math.max(0, normalizeNumber(item.quantity))
    subtotal += unitPrice * quantity
    const minUnit = getMinUnitPrice(item.product, item.variant, {
      customLength: item.customLength,
      customWidth: item.customWidth,
      materials,
    })
    minSubtotal += minUnit * quantity
    const percent = getMaxDiscountPercentForItem(item, materials)
    if (percent < maxPercent) {
      maxPercent = percent
    }
  })

  if (!Number.isFinite(maxPercent)) {
    maxPercent = 0
  }
  const safePercent = Math.max(0, maxPercent)
  return {
    subtotal,
    minSubtotal,
    maxDiscountPercent: safePercent,
    maxDiscountValue: subtotal * (safePercent / 100),
  }
}

export const calculateOrderProductionCost = (
  order: Order,
  products: Product[],
  materials: Material[],
) => {
  if (!order || !order.items || order.items.length === 0) {
    return 0
  }
  const productMap = new Map(products.map((p) => [p.id, p]))

  return order.items.reduce((acc, item) => {
    const product = productMap.get(item.productId)
    if (!product) {
      return acc
    }
    const variant = item.variantId
      ? product.variants?.find((v) => v.id === item.variantId)
      : undefined
    const unitCost = getBaseCost(product, variant, {
      materials,
      customLength: item.customLength,
      customWidth: item.customWidth,
    })
    const qty = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1
    return acc + unitCost * qty
  }, 0)
}
