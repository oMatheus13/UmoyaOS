import type { Cashbox, EmployeeLevel, EmployeeRole, ERPData, SystemTables } from '../types/erp'
import { PAYMENT_METHODS } from '../data/paymentMethods'

const STORAGE_KEY = 'umoya_erp_data'
let memoryState: ERPData | null = null
let didMigrateLegacy = false

export const DEFAULT_ROLES: EmployeeRole[] = [
  { id: 'role-ajudante', name: 'Ajudante de producao' },
  { id: 'role-armador', name: 'Armador' },
  { id: 'role-operador', name: 'Operador de forma' },
  { id: 'role-acabador', name: 'Acabador' },
  { id: 'role-qualidade', name: 'Controle de qualidade' },
  { id: 'role-almoxarife', name: 'Almoxarife' },
  { id: 'role-manutencao', name: 'Manutencao' },
  { id: 'role-supervisor', name: 'Supervisor de producao' },
  { id: 'role-motorista', name: 'Motorista/Entrega' },
  { id: 'role-socio', name: 'Socio' },
  { id: 'role-diretor', name: 'Diretor geral' },
  { id: 'role-administrativo', name: 'Administrativo' },
  { id: 'role-financeiro', name: 'Financeiro' },
  { id: 'role-rh', name: 'Recursos humanos' },
  { id: 'role-comercial', name: 'Comercial' },
  { id: 'role-ti', name: 'TI e suporte' },
]

export const DEFAULT_LEVELS: EmployeeLevel[] = [
  { id: 'level-aprendiz', name: 'Aprendiz' },
  { id: 'level-junior', name: 'Junior' },
  { id: 'level-pleno', name: 'Pleno' },
  { id: 'level-senior', name: 'Senior' },
  { id: 'level-lider', name: 'Lider' },
]

export const DEFAULT_CASHBOXES: Cashbox[] = [
  {
    id: 'caixa_producao',
    name: 'Caixa de Produção',
    description: 'Caixa automático para custo de matérias-primas e produção',
    isProductionBox: true,
    active: true,
  },
]

export const DEFAULT_COMPANY = {
  name: 'Umoya',
}

export const DEFAULT_TABLES: SystemTables = {
  units: [
    { id: 'unit-un', label: 'Unidade', symbol: 'un', active: true },
    { id: 'unit-ml', label: 'Metro linear', symbol: 'm', active: true },
    { id: 'unit-m2', label: 'Metro quadrado', symbol: 'm2', active: true },
    { id: 'unit-m3', label: 'Metro cubico', symbol: 'm3', active: true },
    { id: 'unit-saco', label: 'Saco 50kg', symbol: 'saco', active: true },
  ],
  categories: [
    { id: 'cat-pre', label: 'Pre-moldados', active: true },
    { id: 'cat-mat', label: 'Materia-prima', active: true },
    { id: 'cat-serv', label: 'Servicos', active: true },
    { id: 'cat-outro', label: 'Outros', active: true },
  ],
  paymentMethods: PAYMENT_METHODS.map((method) => ({
    id: method.id,
    label: method.label,
    cashboxId: method.cashboxId,
    active: true,
  })),
}

export const DEFAULT_INTEGRATIONS = [
  { id: 'integracao-nfe', name: 'Nota fiscal (NF-e)', status: 'inativo' as const },
  { id: 'integracao-nfse', name: 'Nota fiscal (NFS-e)', status: 'inativo' as const },
  { id: 'integracao-whatsapp', name: 'WhatsApp', status: 'inativo' as const },
  { id: 'integracao-email', name: 'Email transacional', status: 'inativo' as const },
  { id: 'integracao-drive', name: 'Google Drive', status: 'inativo' as const },
]

export const createEmptyState = (): ERPData => ({
  produtos: [],
  clientes: [],
  fornecedores: [],
  materiais: [],
  moldes: [],
  ordensProducao: [],
  lotesProducao: [],
  productionEntries: [],
  refugosProducao: [],
  ajustesEstoqueProdutos: [],
  stockItems: [],
  consumosMateriais: [],
  orcamentos: [],
  pedidos: [],
  recibos: [],
  comprasHistorico: [],
  nfceItemAliases: [],
  entregas: [],
  fiscalNotas: [],
  qualidadeChecks: [],
  manutencoes: [],
  financeiro: [],
  caixas: DEFAULT_CASHBOXES.map((cashbox) => ({ ...cashbox })),
  conferenciasCaixaFisico: [],
  pdvCaixas: [],
  pdvMovimentacoes: [],
  tabelas: {
    units: DEFAULT_TABLES.units.map((item) => ({ ...item })),
    categories: DEFAULT_TABLES.categories.map((item) => ({ ...item })),
    paymentMethods: DEFAULT_TABLES.paymentMethods.map((item) => ({ ...item })),
  },
  empresa: { ...DEFAULT_COMPANY },
  integracoes: DEFAULT_INTEGRATIONS.map((item) => ({ ...item })),
  funcionarios: [],
  cargos: DEFAULT_ROLES.map((role) => ({ ...role })),
  niveis: DEFAULT_LEVELS.map((level) => ({ ...level })),
  apontamentos: [],
  presencas: [],
  presenceLogs: [],
  popPinAttempts: [],
  pagamentosRH: [],
  ocorrenciasRH: [],
  usuarios: [],
  auditoria: [],
  sequences: [],
  meta: {
    updatedAt: new Date().toISOString(),
  },
})

const loadLegacyStorage = (): ERPData | null => {
  if (didMigrateLegacy) {
    return null
  }
  didMigrateLegacy = true
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as ERPData
    window.localStorage.removeItem(STORAGE_KEY)
    return parsed
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    return null
  }
}

export const getStorage = (): ERPData | null => {
  if (memoryState) {
    return memoryState
  }
  const legacy = loadLegacyStorage()
  if (legacy) {
    memoryState = legacy
  }
  return memoryState
}

export const saveStorage = (data: ERPData) => {
  memoryState = data
}

export const clearStorage = () => {
  memoryState = null
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
