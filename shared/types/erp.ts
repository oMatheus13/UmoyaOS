import type { NfceItemAlias } from './nfce'

export type UUID = string

export type SequenceEntry = {
  key: string
  currentValue: number
}

export type MaterialUnit = 'saco_50kg' | 'm3' | 'unidade'
export type ProductUnit = 'm2' | 'metro_linear' | 'unidade'
export type StockItemUnit = 'un' | 'm'

export type PermissionLevel = 'none' | 'view' | 'edit'
export type PermissionKey =
  | 'dashboard'
  | 'clientes'
  | 'produtos'
  | 'cadastros-materiais'
  | 'fornecedores'
  | 'cadastros-tabelas'
  | 'orcamentos'
  | 'pedidos'
  | 'producao'
  | 'producao-lotes'
  | 'producao-refugo'
  | 'producao-consumo'
  | 'estoque'
  | 'estoque-formas'
  | 'estoque-materiais'
  | 'compras'
  | 'entregas'
  | 'financeiro'
  | 'fiscal'
  | 'funcionarios'
  | 'rh-presenca'
  | 'rh-pagamentos'
  | 'rh-historico'
  | 'rh-ocorrencias'
  | 'qualidade'
  | 'indicadores'
  | 'bi'
  | 'relatorios-historico'
  | 'relatorios-producao'
  | 'relatorios-vendas'
  | 'relatorios-consumo'
  | 'config-usuarios'
  | 'perfil'
  | 'config-empresa'
  | 'configuracoes'
  | 'config-integracoes'
  | 'dados'
  | 'auditoria-log'
  | 'auditoria-historico'
  | 'auditoria-backup'
  | 'auditoria-acesso'

export type RolePermissions = Partial<Record<PermissionKey, PermissionLevel>>
export type MaterialKind =
  | 'areia'
  | 'brita'
  | 'cimento'
  | 'trelica'
  | 'aco'
  | 'aditivo'
  | 'agua'
  | 'outro'

export type MaterialUsageUnit =
  | 'm3'
  | 'balde'
  | 'carrinho_rente'
  | 'carrinho_cheio'
  | 'saco'
  | 'metro'
  | 'unidade'

export type FulfillmentMode = 'producao' | 'estoque'

export type ProductMaterialUsage = {
  id: UUID
  materialId: UUID
  quantity: number
  usageUnit?: MaterialUsageUnit
  unitMode?: 'material' | 'metro'
  source?: 'manual' | 'batch'
}

export type BatchRecipeItem = {
  id: UUID
  materialId: UUID
  quantity: number
  usageUnit: MaterialUsageUnit
}

export type BatchRecipe = {
  id: UUID
  productId: UUID
  variantId?: UUID
  yieldQuantity: number
  items: BatchRecipeItem[]
  updatedAt?: string
}

export type ProductVariant = {
  id: UUID
  productId: UUID
  name: string
  length?: number
  width?: number
  height?: number
  stock: number
  sku?: string
  priceOverride?: number
  costOverride?: number
  active?: boolean
  locked?: boolean
  isCustom?: boolean
  materialUsages?: ProductMaterialUsage[]
  batchRecipe?: BatchRecipe
}

export type Product = {
  id: UUID
  name: string
  price: number
  priceMin?: number
  maxDiscountPercent?: number
  costPrice?: number
  laborCost?: number
  laborBasis?: 'unidade' | 'metro'
  demoldTimeDays?: number
  sku?: string
  stock?: number
  unit?: ProductUnit
  length?: number
  width?: number
  height?: number
  dimensions?: string
  active?: boolean
  producedInternally?: boolean
  hasVariants?: boolean
  variants?: ProductVariant[]
  materialUsages?: ProductMaterialUsage[]
  batchRecipe?: BatchRecipe
}

export type Client = {
  id: UUID
  name: string
  document?: string
  email?: string
  phone?: string
  city?: string
  notes?: string
  active?: boolean
  obras?: ClientObra[]
}

export type ClientObra = {
  id: UUID
  name: string
  address: string
  city?: string
  notes?: string
  active?: boolean
}

export type Supplier = {
  id: UUID
  name: string
  contact?: string
  document?: string
  email?: string
  phone?: string
  city?: string
  notes?: string
  active?: boolean
}

export type Material = {
  id: UUID
  name: string
  unit?: MaterialUnit
  kind?: MaterialKind
  metersPerUnit?: number
  cost?: number
  marketUnitPrice?: number
  marketLotPrice?: number
  lotSize?: number
  stock?: number
  minStock?: number
  notes?: string
  active?: boolean
}

export type Mold = {
  id: UUID
  name: string
  code?: string
  length?: number
  width?: number
  height?: number
  stock?: number
  notes?: string
}

export type QuoteItem = {
  productId: UUID
  variantId?: UUID
  quantity: number
  unitPrice: number
  customLength?: number
  customWidth?: number
  customHeight?: number
}

export type Quote = {
  id: UUID
  clientId: UUID
  obraId?: UUID
  items: QuoteItem[]
  total: number
  fulfillment?: FulfillmentMode
  discountType?: 'percent' | 'value'
  discountValue?: number
  discountPercent?: number
  paymentMethod?: string
  validUntil: string
  status: 'rascunho' | 'enviado' | 'aprovado' | 'recusado'
  createdAt: string
  convertedOrderId?: UUID
}

export type OrderItem = {
  productId: UUID
  variantId?: UUID
  quantity: number
  unitPrice: number
  customLength?: number
  customWidth?: number
  customHeight?: number
}

export type OrderPayment = {
  id: UUID
  amount: number
  receivedAt: string
}

export type Order = {
  id: UUID
  code?: string
  seq?: number
  trackingCode?: string
  publicCode?: string
  clientId: UUID
  obraId?: UUID
  items: OrderItem[]
  total: number
  paymentMethod: string
  fulfillment?: FulfillmentMode
  discountType?: 'percent' | 'value'
  discountValue?: number
  discountPercent?: number
  status: 'aguardando_pagamento' | 'pago' | 'em_producao' | 'entregue'
  payments?: OrderPayment[]
  createdAt: string
  sourceQuoteId?: UUID
}

export type Receipt = {
  id: UUID
  orderId: UUID
  amount: number
  paymentMethod: string
  issuedAt: string
}

export type DeliveryItem = {
  productId: UUID
  variantId?: UUID
  customLength?: number
  customWidth?: number
  customHeight?: number
  unitPrice?: number
  quantity: number
}

export type PurchaseItem = {
  id: UUID
  type: 'material' | 'extra'
  materialId?: UUID
  description: string
  quantity?: number
  unitPrice?: number
  pricingMode?: 'unit' | 'lot'
  total: number
}

export type PurchaseRecord = {
  id: UUID
  supplierId?: UUID
  purchaseDate?: string
  notes?: string
  items: PurchaseItem[]
  total: number
  createdAt: string
  source?: 'nfce'
  accessKey?: string
  sourceUrl?: string
  noteNumber?: string
  noteSeries?: string
  issuedAt?: string
  authorizationProtocol?: string
  paymentMethod?: string
  paymentValue?: number
}

export type Delivery = {
  id: UUID
  orderId: UUID
  productionOrderId: UUID
  clientId: UUID
  obraId?: UUID
  address?: string
  status: 'pendente' | 'em_rota' | 'entregue'
  createdAt: string
  scheduledAt?: string
  vehicle?: string
  driver?: string
  isPartial?: boolean
  items?: DeliveryItem[]
  proofType?: 'foto' | 'assinatura'
  proofNote?: string
  occurrence?: string
}

export type ProductionOrder = {
  id: UUID
  code?: string
  seq?: number
  orderId: UUID
  linkedOrderId?: UUID
  productId: UUID
  variantId?: UUID
  quantity: number
  customLength?: number
  plannedQty?: number
  plannedLengthM?: number
  producedQty?: number
  producedLengthM?: number
  moldId?: UUID
  status: 'ABERTA' | 'EM_ANDAMENTO' | 'PARCIAL' | 'CONCLUIDA' | 'CANCELADA'
  originProductionOrderId?: UUID
  createdAt?: string
  plannedAt?: string
  finishedAt?: string
  source?: 'pedido' | 'estoque'
}

export type ProductionLotStatus = 'aguardando' | 'produzindo' | 'curando' | 'pronto'

export type ProductionLot = {
  id: UUID
  code?: string
  seq?: number
  productId: UUID
  variantId?: UUID
  productionOrderId?: UUID
  quantity: number
  customLength?: number
  status: ProductionLotStatus
  moldedAt?: string
  demoldedAt?: string
  curingUntil?: string
  notes?: string
  createdAt: string
}

export type ProductionEntry = {
  id: UUID
  productionOrderId: UUID
  employeeId?: UUID
  date: string
  quantity: number
  lengthM?: number
  scrapQuantity?: number
  scrapLengthM?: number
  notes?: string
  createdAt: string
  createdByEmployeeId?: UUID
  deviceId?: string
}

export type ProductionScrapStatus = 'aberto' | 'resolvido'
export type ProductionScrapType = 'refugo' | 'retrabalho'

export type ProductionScrapBase = {
  id: UUID
  productId: UUID
  variantId?: UUID
  productionOrderId?: UUID
  quantity: number
  reason: string
  estimatedCost?: number
  createdAt: string
  notes?: string
}

export type ProductionScrap =
  | (ProductionScrapBase & { type: 'refugo' })
  | (ProductionScrapBase & { type: 'retrabalho'; status: ProductionScrapStatus })

export type ProductStockAdjustmentType = 'entrada' | 'saida'

export type ProductStockAdjustment = {
  id: UUID
  productId: UUID
  variantId?: UUID
  lengthM?: number
  lotId?: UUID
  type: ProductStockAdjustmentType
  quantity: number
  producedAt?: string
  notes?: string
  createdAt: string
}

export type StockItem = {
  id: UUID
  productId: UUID
  lengthM?: number
  unit: StockItemUnit
  quantity: number
  reservedQuantity?: number
  code?: string
  createdAt: string
  updatedAt?: string
}

export type FiscalNoteStatus = 'pendente' | 'autorizada' | 'cancelada'
export type FiscalNoteType = 'nfe' | 'nfse'

export type FiscalNote = {
  id: UUID
  type: FiscalNoteType
  orderId?: UUID
  clientId?: UUID
  number?: string
  series?: string
  issueDate?: string
  status: FiscalNoteStatus
  xmlStored?: boolean
  notes?: string
  createdAt: string
}

export type QualityCheckStatus = 'aberto' | 'resolvido'
export type QualityCheckType = 'checklist' | 'falha'
export type QualitySeverity = 'baixa' | 'media' | 'alta'

export type QualityCheck = {
  id: UUID
  type: QualityCheckType
  productId?: UUID
  productionOrderId?: UUID
  description: string
  severity?: QualitySeverity
  estimatedCost?: number
  status: QualityCheckStatus
  notes?: string
  createdAt: string
}

export type MaintenanceStatus = 'aberta' | 'finalizada'
export type MaintenanceType = 'preventiva' | 'corretiva'

export type MaintenanceLog = {
  id: UUID
  equipment: string
  type: MaintenanceType
  status: MaintenanceStatus
  scheduledAt?: string
  performedAt?: string
  cost?: number
  notes?: string
  createdAt: string
}

export type IntegrationStatus = 'ativo' | 'inativo'

export type IntegrationConfig = {
  id: UUID
  name: string
  provider?: string
  status: IntegrationStatus
  lastSync?: string
  notes?: string
}

export type MaterialConsumption = {
  id: UUID
  productionOrderId: UUID
  materialId: UUID
  expected: number
  actual?: number
}

export type FinanceEntry = {
  id: UUID
  type: 'entrada' | 'saida' | 'transferencia'
  description: string
  amount: number
  category?: string
  createdAt: string
  cashboxId: UUID
  transferToId?: UUID
}

export type Cashbox = {
  id: UUID
  name: string
  description?: string
  allocationPercent?: number
  maxTarget?: number
  minPercent?: number
  idealPercent?: number
  isProfitBox?: boolean
  isProductionBox?: boolean
  isReversalBox?: boolean
  color?: string
  active?: boolean
}

export type CashDailyCheck = {
  id: UUID
  date: string
  opening: number
  cashIn: number
  cashOut: number
  closing: number
  actual: number
  notes?: string
  createdAt: string
}

export type PdvCashSessionStatus = 'aberto' | 'fechado'

export type PdvCashSession = {
  id: UUID
  userId?: UUID
  userName?: string
  openingBalance: number
  closingBalance?: number
  status: PdvCashSessionStatus
  openedAt: string
  closedAt?: string
}

export type PdvCashMovementType = 'entrada' | 'saida'
export type PdvCashMovementSource = 'venda' | 'sangria' | 'reforco' | 'ajuste'

export type PdvCashMovement = {
  id: UUID
  cashSessionId: UUID
  type: PdvCashMovementType
  method: string
  amount: number
  source: PdvCashMovementSource
  createdAt: string
  orderId?: UUID
  description?: string
}

export type TableEntry = {
  id: UUID
  label: string
  active?: boolean
  description?: string
}

export type UnitTableEntry = TableEntry & {
  symbol?: string
}

export type PaymentTableEntry = TableEntry & {
  cashboxId?: UUID
}

export type SystemTables = {
  units: UnitTableEntry[]
  categories: TableEntry[]
  paymentMethods: PaymentTableEntry[]
}

export type AuditCategory = 'acao' | 'alteracao' | 'backup' | 'acesso'

export type AuditEvent = {
  id: UUID
  category: AuditCategory
  title: string
  description?: string
  actorName?: string
  createdAt: string
  metadata?: string
}

export type CompanyProfile = {
  name: string
  tradeName?: string
  document?: string
  stateRegistration?: string
  email?: string
  phone?: string
  whatsapp?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
  website?: string
  mapsUrl?: string
  hoursWeekdays?: string
  hoursSunday?: string
  instagram?: string
  facebook?: string
  youtube?: string
  linkedin?: string
  tiktok?: string
  notes?: string
}

export type EmployeeRole = {
  id: UUID
  name: string
  permissions?: RolePermissions
}

export type EmployeeLevel = {
  id: UUID
  name: string
}

export type Employee = {
  id: UUID
  name: string
  roleId?: UUID
  levelId?: UUID
  cpf?: string
  active?: boolean
  isActive?: boolean
  pinHash?: string
  hiredAt?: string
}

export type PresenceStatus = 'presente' | 'meio_periodo' | 'falta' | 'ferias'

export type PresenceEntry = {
  id: UUID
  employeeId: UUID
  date: string
  status: PresenceStatus
  notes?: string
  createdAt: string
}

export type PresenceLogType = 'IN' | 'OUT' | 'BREAK_IN' | 'BREAK_OUT'

export type PresenceLog = {
  id: UUID
  employeeId: UUID
  type: PresenceLogType
  timestamp: string
  deviceId?: string
  notes?: string
  createdAt: string
  createdByEmployeeId?: UUID
}

export type EmployeePaymentStatus = 'aberto' | 'pago' | 'cancelado'

export type EmployeePayment = {
  id: UUID
  employeeId: UUID
  periodStart: string
  periodEnd: string
  baseValue: number
  extras: number
  discounts: number
  total: number
  status: EmployeePaymentStatus
  method?: string
  cashboxId?: UUID
  extrasCashboxId?: UUID
  financeEntryId?: UUID
  extrasFinanceEntryId?: UUID
  createdAt: string
  paidAt?: string
  notes?: string
  autoFromLogs?: boolean
}

export type EmployeeOccurrence = {
  id: UUID
  employeeId: UUID
  date: string
  type: string
  description: string
  createdAt: string
  resolved?: boolean
}

export type WorkLog = {
  id: UUID
  employeeId: UUID
  productId: UUID
  variantId?: UUID
  quantity: number
  workDate: string
  createdAt: string
  unitLaborCost: number
  totalPay: number
}

export type PopPinAttempt = {
  id: UUID
  employeeId?: UUID
  success: boolean
  timestamp: string
  deviceId?: string
  deviceInfo?: string
  createdAt: string
}

export type UserAccount = {
  id: UUID
  employeeId?: UUID
  name: string
  displayName?: string
  email: string
  cpf?: string
  phone?: string
  avatarColor?: string
  avatarUrl?: string
  avatarPath?: string
  passwordHash?: string
  role?: 'admin' | 'funcionario'
  createdAt: string
  lastLoginAt?: string
  active?: boolean
}

export type ERPData = {
  produtos: Product[]
  clientes: Client[]
  fornecedores: Supplier[]
  materiais: Material[]
  moldes: Mold[]
  ordensProducao: ProductionOrder[]
  lotesProducao: ProductionLot[]
  productionEntries: ProductionEntry[]
  refugosProducao: ProductionScrap[]
  ajustesEstoqueProdutos: ProductStockAdjustment[]
  stockItems: StockItem[]
  consumosMateriais: MaterialConsumption[]
  orcamentos: Quote[]
  pedidos: Order[]
  recibos: Receipt[]
  comprasHistorico: PurchaseRecord[]
  nfceItemAliases: NfceItemAlias[]
  entregas: Delivery[]
  fiscalNotas: FiscalNote[]
  qualidadeChecks: QualityCheck[]
  manutencoes: MaintenanceLog[]
  financeiro: FinanceEntry[]
  caixas: Cashbox[]
  physicalCashBalance?: number
  conferenciasCaixaFisico: CashDailyCheck[]
  pdvCaixas: PdvCashSession[]
  pdvMovimentacoes: PdvCashMovement[]
  tabelas: SystemTables
  empresa: CompanyProfile
  integracoes: IntegrationConfig[]
  funcionarios: Employee[]
  cargos: EmployeeRole[]
  niveis: EmployeeLevel[]
  apontamentos: WorkLog[]
  presencas: PresenceEntry[]
  presenceLogs: PresenceLog[]
  popPinAttempts: PopPinAttempt[]
  pagamentosRH: EmployeePayment[]
  ocorrenciasRH: EmployeeOccurrence[]
  usuarios: UserAccount[]
  auditoria: AuditEvent[]
  sequences: SequenceEntry[]
  meta?: {
    updatedAt?: string
    workspaceId?: string
  }
}
