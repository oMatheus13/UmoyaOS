import { useState } from 'react'
import type { ERPData, Product, ProductVariant } from '@shared/types/erp'
import ConfirmDialog from '../../components/ConfirmDialog'
import QuickNotice from '@shared/components/QuickNotice'
import { Page, PageHeader } from '@ui/components'
import { dataService } from '@shared/services/dataService'
import { createEmptyState } from '@shared/services/storage'
import { useERPData } from '@shared/store/appStore'

type ResetAction = {
  id: string
  title: string
  subtitle: string
  buttonLabel: string
  confirmTitle: string
  confirmDescription: string
  countLabel: string
  count: (data: ERPData) => number
  apply: (data: ERPData) => ERPData
}

const resetProductStock = (product: Product): Product => ({
  ...product,
  stock: 0,
  variants: product.variants?.map(
    (variant): ProductVariant => ({
      ...variant,
      stock: 0,
    }),
  ),
})

const preserveAccess = (current: ERPData, next: ERPData): ERPData => {
  next.usuarios = current.usuarios
  if (current.meta?.workspaceId) {
    next.meta = { ...next.meta, workspaceId: current.meta.workspaceId }
  }
  return next
}

const RESET_ACTIONS: ResetAction[] = [
  {
    id: 'estoque',
    title: 'Estoque',
    subtitle: 'Zera saldos e limpa lotes, ajustes e itens de estoque sem apagar os cadastros.',
    buttonLabel: 'Resetar estoque',
    confirmTitle: 'Resetar estoque?',
    confirmDescription:
      'Os saldos de produtos, variantes, materiais e moldes voltarao para zero. Lotes, ajustes, consumos e itens de estoque tambem serao apagados.',
    countLabel: 'registros em estoque',
    count: (data) =>
      data.stockItems.length +
      data.ajustesEstoqueProdutos.length +
      data.consumosMateriais.length +
      data.lotesProducao.length,
    apply: (current) => ({
      ...current,
      produtos: current.produtos.map(resetProductStock),
      materiais: current.materiais.map((material) => ({ ...material, stock: 0 })),
      moldes: current.moldes.map((mold) => ({ ...mold, stock: 0 })),
      stockItems: [],
      ajustesEstoqueProdutos: [],
      consumosMateriais: [],
      lotesProducao: [],
    }),
  },
  {
    id: 'producao',
    title: 'Ordem de producao',
    subtitle: 'Limpa ordens, apontamentos, refugos e entregas geradas pela operacao.',
    buttonLabel: 'Resetar producao',
    confirmTitle: 'Resetar ordens de producao?',
    confirmDescription:
      'Ordens, entradas de producao, refugos, lotes, consumos e entregas vinculadas serao apagados. Pedidos, clientes e produtos permanecem.',
    countLabel: 'registros de producao',
    count: (data) =>
      data.ordensProducao.length +
      data.productionEntries.length +
      data.refugosProducao.length +
      data.lotesProducao.length +
      data.consumosMateriais.length +
      data.entregas.length,
    apply: (current) => ({
      ...current,
      ordensProducao: [],
      productionEntries: [],
      refugosProducao: [],
      lotesProducao: [],
      consumosMateriais: [],
      entregas: [],
    }),
  },
  {
    id: 'financeiro',
    title: 'Financeiro',
    subtitle: 'Apaga lancamentos, recibos, conferencias e movimentacoes de caixa/PDV.',
    buttonLabel: 'Resetar financeiro',
    confirmTitle: 'Resetar financeiro?',
    confirmDescription:
      'Lancamentos financeiros, recibos, conferencias de caixa e movimentacoes do PDV serao apagados. Caixas cadastrados permanecem.',
    countLabel: 'registros financeiros',
    count: (data) =>
      data.financeiro.length +
      data.recibos.length +
      data.conferenciasCaixaFisico.length +
      data.pdvCaixas.length +
      data.pdvMovimentacoes.length,
    apply: (current) => ({
      ...current,
      financeiro: [],
      recibos: [],
      conferenciasCaixaFisico: [],
      pdvCaixas: [],
      pdvMovimentacoes: [],
    }),
  },
  {
    id: 'compras',
    title: 'Compras',
    subtitle: 'Remove o historico de compras e os aliases importados de NFC-e.',
    buttonLabel: 'Resetar compras',
    confirmTitle: 'Resetar compras?',
    confirmDescription:
      'O historico de compras e os aliases de itens importados via NFC-e serao apagados. Fornecedores, materiais e produtos continuam cadastrados.',
    countLabel: 'registros de compras',
    count: (data) => data.comprasHistorico.length + data.nfceItemAliases.length,
    apply: (current) => ({
      ...current,
      comprasHistorico: [],
      nfceItemAliases: [],
    }),
  },
  {
    id: 'qualidade',
    title: 'Qualidade e manutencao',
    subtitle: 'Apaga checks de qualidade, falhas e manutencoes registradas.',
    buttonLabel: 'Resetar qualidade',
    confirmTitle: 'Resetar qualidade e manutencao?',
    confirmDescription:
      'Checks, falhas e manutencoes serao apagados. Cadastros de produtos e operacao continuam disponiveis.',
    countLabel: 'registros de qualidade',
    count: (data) => data.qualidadeChecks.length + data.manutencoes.length,
    apply: (current) => ({
      ...current,
      qualidadeChecks: [],
      manutencoes: [],
    }),
  },
  {
    id: 'fiscal',
    title: 'Fiscal',
    subtitle: 'Remove notas fiscais registradas sem mexer nos pedidos e clientes.',
    buttonLabel: 'Resetar fiscal',
    confirmTitle: 'Resetar fiscal?',
    confirmDescription:
      'As notas fiscais registradas serao apagadas. Pedidos, financeiro e cadastros base permanecem.',
    countLabel: 'notas fiscais',
    count: (data) => data.fiscalNotas.length,
    apply: (current) => ({
      ...current,
      fiscalNotas: [],
    }),
  },
  {
    id: 'rh',
    title: 'RH operacional',
    subtitle: 'Limpa presencas, logs, pagamentos, ocorrencias e apontamentos de trabalho.',
    buttonLabel: 'Resetar RH',
    confirmTitle: 'Resetar RH operacional?',
    confirmDescription:
      'Presencas, logs, pagamentos, ocorrencias, apontamentos e tentativas de PIN serao apagados. Funcionarios, cargos, niveis e usuarios permanecem.',
    countLabel: 'registros de RH',
    count: (data) =>
      data.presencas.length +
      data.presenceLogs.length +
      data.pagamentosRH.length +
      data.ocorrenciasRH.length +
      data.apontamentos.length +
      data.popPinAttempts.length,
    apply: (current) => ({
      ...current,
      presencas: [],
      presenceLogs: [],
      pagamentosRH: [],
      ocorrenciasRH: [],
      apontamentos: [],
      popPinAttempts: [],
    }),
  },
  {
    id: 'operacional',
    title: 'Operacional (Manter Cadastros)',
    subtitle: 'Apaga todas as movimentacoes, pedidos, producao e zera o estoque, mas mantem seus cadastros.',
    buttonLabel: 'Resetar operacional',
    confirmTitle: 'Resetar dados operacionais?',
    confirmDescription:
      'Isso apagara ordens, pedidos, entregas, financeiro, compras, ponto do RH e zerara o estoque. Porem, clientes, produtos, fornecedores e funcionarios permanecerao intactos.',
    countLabel: 'movimentacoes operacionais',
    count: (data) =>
      data.pedidos.length +
      data.ordensProducao.length +
      data.financeiro.length +
      data.comprasHistorico.length +
      data.fiscalNotas.length,
    apply: (current) => ({
      ...current,
      produtos: current.produtos.map(resetProductStock),
      materiais: current.materiais.map((material) => ({ ...material, stock: 0 })),
      moldes: current.moldes.map((mold) => ({ ...mold, stock: 0 })),
      stockItems: [],
      ajustesEstoqueProdutos: [],
      consumosMateriais: [],
      lotesProducao: [],
      ordensProducao: [],
      productionEntries: [],
      refugosProducao: [],
      entregas: [],
      orcamentos: [],
      pedidos: [],
      recibos: [],
      financeiro: [],
      conferenciasCaixaFisico: [],
      pdvCaixas: [],
      pdvMovimentacoes: [],
      comprasHistorico: [],
      nfceItemAliases: [],
      qualidadeChecks: [],
      manutencoes: [],
      fiscalNotas: [],
      presencas: [],
      presenceLogs: [],
      pagamentosRH: [],
      ocorrenciasRH: [],
      apontamentos: [],
      popPinAttempts: [],
    }),
  },
  {
    id: 'tudo',
    title: 'Tudo',
    subtitle: 'Apaga todos os dados operacionais e cadastros do ERP. Contas de acesso permanecem.',
    buttonLabel: 'Resetar tudo',
    confirmTitle: 'Resetar dados do ERP?',
    confirmDescription:
      'Todos os cadastros e movimentacoes serao apagados. Contas de acesso e o workspace permanecem.',
    countLabel: 'registros totais monitorados',
    count: (data) =>
      data.produtos.length +
      data.clientes.length +
      data.pedidos.length +
      data.financeiro.length +
      data.funcionarios.length +
      data.ordensProducao.length +
      data.comprasHistorico.length,
    apply: (current) => preserveAccess(current, createEmptyState()),
  },
]

const DataTools = () => {
  const { data, refresh } = useERPData()
  const [status, setStatus] = useState<string | null>(null)
  const [pendingReset, setPendingReset] = useState<ResetAction | null>(null)

  const handleReset = () => {
    if (!pendingReset) {
      return
    }
    const current = dataService.getAll()
    const next = pendingReset.apply(current)
    dataService.replaceAll(next)
    refresh()
    setStatus(`${pendingReset.title} resetado com sucesso.`)
    setPendingReset(null)
  }

  return (
    <Page className="data-tools">
      <PageHeader />

      <div className="grid grid--stack">
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Resetar dados</h2>
              <p className="panel__subtitle">
                Use resets parciais para limpar operacoes especificas sem perder cadastros base,
                como clientes, produtos, fornecedores, usuarios e configuracoes.
              </p>
            </div>
          </div>
          <div className="panel__body">
            {RESET_ACTIONS.map((action) => (
              <div className="panel__section" key={action.id}>
                <div className="panel__section-header">
                  <div className="panel__heading">
                    <h3 className="panel__section-title">{action.title}</h3>
                    <p className="panel__subtitle">{action.subtitle}</p>
                  </div>
                  <span className="panel__meta">
                    {action.count(data)} {action.countLabel}
                  </span>
                </div>
                <div className="panel__actions">
                  <button
                    className="button button--danger button--sm"
                    type="button"
                    onClick={() => setPendingReset(action)}
                  >
                    {action.buttonLabel}
                  </button>
                </div>
              </div>
            ))}
            <div className="panel__section">
              <p className="panel__subtitle">
                Contas de acesso permanecem ativas em todos os resets. No reset de estoque, os
                cadastros continuam, mas os saldos voltam para zero.
              </p>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Resumo atual</h2>
            </div>
          </div>
          <div className="panel__items">
            <div className="panel__item">
              <span className="panel__item-label">Produtos</span>
              <strong className="panel__item-value">{data.produtos.length}</strong>
            </div>
            <div className="panel__item">
              <span className="panel__item-label">Clientes</span>
              <strong className="panel__item-value">{data.clientes.length}</strong>
            </div>
            <div className="panel__item">
              <span className="panel__item-label">Pedidos</span>
              <strong className="panel__item-value">{data.pedidos.length}</strong>
            </div>
            <div className="panel__item">
              <span className="panel__item-label">Financeiro</span>
              <strong className="panel__item-value">{data.financeiro.length}</strong>
            </div>
            <div className="panel__item">
              <span className="panel__item-label">Funcionarios</span>
              <strong className="panel__item-value">{data.funcionarios.length}</strong>
            </div>
            <div className="panel__item">
              <span className="panel__item-label">Usuarios</span>
              <strong className="panel__item-value">{data.usuarios.length}</strong>
            </div>
          </div>
          <QuickNotice message={status} onClear={() => setStatus(null)} />
        </section>
      </div>
      <ConfirmDialog
        open={pendingReset !== null}
        title={pendingReset?.confirmTitle ?? 'Resetar dados?'}
        description={pendingReset?.confirmDescription}
        confirmLabel={pendingReset?.buttonLabel ?? 'Resetar'}
        onClose={() => setPendingReset(null)}
        onConfirm={handleReset}
      />
    </Page>
  )
}

export default DataTools
