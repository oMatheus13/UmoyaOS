import { useMemo, useState, useEffect, type FormEvent } from 'react'
import ActionMenu from '../../components/ActionMenu'
import ConfirmDialog from '../../components/ConfirmDialog'
import CurrencyInput from '../../components/CurrencyInput'
import Modal from '@shared/components/Modal'
import QuickNotice from '@shared/components/QuickNotice'
import { Page, PageHeader } from '@ui/components'
import { dataService } from '@shared/services/dataService'
import { useERPData } from '@shared/store/appStore'
import type { Cashbox, FinanceEntry } from '@shared/types/erp'
import { formatCurrency, formatDateShort } from '@shared/utils/format'
import { distributeOrderPayment } from '@shared/utils/financeDistribution'
import { createId } from '@shared/utils/ids'

type CashboxForm = {
  name: string
  description: string
  allocationPercent: number
  maxTarget: number
  minPercent: number
  idealPercent: number
  isReversalBox: boolean
  active: boolean
}

const DEFAULT_CASHBOX_FORM: CashboxForm = {
  name: '',
  description: '',
  allocationPercent: 0,
  maxTarget: 0,
  minPercent: 65,
  idealPercent: 85,
  isReversalBox: false,
  active: true,
}


type EntryForm = {
  type: FinanceEntry['type']
  description: string
  amount: number
  category: string
  cashboxId: string
  transferToId?: string
  applyAutoDistribution?: boolean
}

const DEFAULT_ENTRY_FORM: EntryForm = {
  type: 'entrada',
  description: '',
  amount: 0,
  category: '',
  cashboxId: '',
}

const Financeiro = () => {
  const { data, refresh } = useERPData()
  const [status, setStatus] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<CashboxForm>(DEFAULT_CASHBOX_FORM)

  
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null)
  const [entryForm, setEntryForm] = useState<EntryForm>(DEFAULT_ENTRY_FORM)
  const financeFormId = 'registro-financeiro-form'

  const cashboxFormId = 'registro-caixa-form'

  const cashboxes = useMemo(() => data.caixas, [data.caixas])
  const entries = useMemo(() => data.financeiro, [data.financeiro])
  const physicalCash = data.physicalCashBalance ?? 0

  // Identificação dos Caixas Fixos
  const productionBox = useMemo(
    () => cashboxes.find((box) => box.isProductionBox || box.id === 'caixa_producao'),
    [cashboxes],
  )
  const profitBox = useMemo(
    () => cashboxes.find((box) => box.isProfitBox || box.id === 'caixa_lucro'),
    [cashboxes],
  )

  // Caixas Personalizados (Tirando Produção e Lucro)
  const customBoxes = useMemo(
    () =>
      cashboxes.filter(
        (box) =>
          !box.isProductionBox &&
          !box.isProfitBox &&
          box.id !== 'caixa_producao' &&
          box.id !== 'caixa_lucro',
      ),
    [cashboxes],
  )

  const cashboxBalances = useMemo(() => {
    const balances = new Map<string, number>()
    // Garantir que caixas fixos tenham saldo inicial mesmo se ausentes da lista
    balances.set('caixa_producao', 0)
    balances.set('caixa_lucro', 0)
    
    cashboxes.forEach((box) => balances.set(box.id, 0))
    entries.forEach((entry) => {
      const current = balances.get(entry.cashboxId) ?? 0
      if (entry.type === 'entrada') {
        balances.set(entry.cashboxId, current + entry.amount)
      } else if (entry.type === 'saida') {
        balances.set(entry.cashboxId, current - entry.amount)
      } else if (entry.type === 'transferencia') {
        balances.set(entry.cashboxId, current - entry.amount)
        if (entry.transferToId) {
          const target = balances.get(entry.transferToId) ?? 0
          balances.set(entry.transferToId, target + entry.amount)
        }
      }
    })
    return balances
  }, [cashboxes, entries])

  const totalBalance = useMemo(() => {
    let total = 0
    cashboxBalances.forEach((val) => {
      total += val
    })
    return total
  }, [cashboxBalances])

  const productionBalance = useMemo(
    () => cashboxBalances.get(productionBox?.id ?? 'caixa_producao') ?? 0,
    [productionBox, cashboxBalances],
  )
  
  const profitBalance = useMemo(
    () => cashboxBalances.get(profitBox?.id ?? 'caixa_lucro') ?? 0,
    [profitBox, cashboxBalances],
  )

  const totalAllocation = useMemo(
    () => customBoxes.reduce((acc, c) => acc + (c.allocationPercent ?? 0), 0),
    [customBoxes],
  )

  // Auto-criação do Caixa de Lucro se não existir no payload de dados
  useEffect(() => {
    if (!profitBox) {
      const payload = dataService.getAll()
      if (!payload.caixas.some(c => c.id === 'caixa_lucro')) {
        payload.caixas.push({
          id: 'caixa_lucro',
          name: 'Caixa de Lucro',
          description: 'Reservatório final para lucros após atingimento de tetos.',
          isProfitBox: true,
          active: true,
        })
        dataService.replaceAll(payload)
        refresh()
      }
    }
  }, [profitBox, refresh])

  const resetForm = () => {
    setForm(DEFAULT_CASHBOX_FORM)
    setEditingId(null)
  }

  const openNewModal = () => {
    resetForm()
    setStatus(null)
    setIsModalOpen(true)
  }

  const handleEdit = (cashbox: Cashbox) => {
    setEditingId(cashbox.id)
    setForm({
      name: cashbox.name,
      description: cashbox.description ?? '',
      allocationPercent: cashbox.allocationPercent ?? 0,
      maxTarget: cashbox.maxTarget ?? 0,
      minPercent: cashbox.minPercent ?? 65,
      idealPercent: cashbox.idealPercent ?? 85,
      isReversalBox: !!cashbox.isReversalBox,
      active: cashbox.active ?? true,
    })
    setStatus(null)
    setIsModalOpen(true)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setStatus('Informe o nome do caixa.')
      return
    }

    const payload = dataService.getAll()
    const nextBox: Cashbox = {
      id: editingId ?? createId(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      allocationPercent: form.allocationPercent,
      maxTarget: form.maxTarget > 0 ? form.maxTarget : undefined,
      minPercent: form.minPercent,
      idealPercent: form.idealPercent,
      isProfitBox: false,
      isProductionBox: false,
      isReversalBox: form.isReversalBox,
      active: form.active,
    }

    if (form.isReversalBox) {
      payload.caixas = payload.caixas.map((c) => ({ ...c, isReversalBox: false }))
    }

    if (editingId) {
      payload.caixas = payload.caixas.map((c) => (c.id === editingId ? nextBox : c))
    } else {
      payload.caixas = [...payload.caixas, nextBox]
    }

    dataService.replaceAll(payload, {
      auditEvent: {
        category: editingId ? 'alteracao' : 'acao',
        title: editingId ? 'Caixa atualizado' : 'Novo caixa registrado',
        description: `${nextBox.name} (${nextBox.allocationPercent ?? 0}%)`,
      },
    })

    refresh()
    setIsModalOpen(false)
    resetForm()
    setStatus(editingId ? 'Caixa atualizado.' : 'Novo caixa registrado.')
  }

  const handleDelete = () => {
    if (!deleteId) return
    const payload = dataService.getAll()
    payload.caixas = payload.caixas.filter((c) => c.id !== deleteId)

    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: 'Caixa removido',
        description: deleteId,
      },
    })

    refresh()
    setDeleteId(null)
    setIsModalOpen(false)
    resetForm()
    setStatus('Caixa removido.')
  }

  const cashboxToDelete = deleteId
    ? cashboxes.find((c) => c.id === deleteId)
    : null

  
  const getCashboxName = (id: string) => {
    return cashboxes.find((c) => c.id === id)?.name ?? id
  }

  const handleEditEntry = (entry: FinanceEntry) => {
    setEntryForm({
      type: entry.type,
      description: entry.description,
      amount: entry.amount,
      category: entry.category ?? '',
      cashboxId: entry.cashboxId,
      transferToId: entry.transferToId,
    })
    setEditingEntryId(entry.id)
    setIsEntryModalOpen(true)
  }

  const handleDeleteEntry = () => {
    if (!deleteEntryId) return
    const payload = dataService.getAll()
    payload.financeiro = payload.financeiro.filter((e) => e.id !== deleteEntryId)
    dataService.replaceAll(payload, {
      auditEvent: { category: 'acao', title: 'Lancamento removido', description: deleteEntryId },
    })
    refresh()
    setDeleteEntryId(null)
    setIsEntryModalOpen(false)
    setStatus('Lancamento removido.')
  }

  const handleEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (entryForm.amount <= 0 || !entryForm.cashboxId) return
    const payload = dataService.getAll()
    const nextEntry: FinanceEntry = {
      id: editingEntryId ?? createId(),
      type: entryForm.type,
      description: entryForm.description,
      amount: entryForm.amount,
      category: entryForm.category || undefined,
      cashboxId: entryForm.cashboxId,
      transferToId: entryForm.type === 'transferencia' ? entryForm.transferToId : undefined,
      createdAt: editingEntryId ? (entries.find(ex => ex.id === editingEntryId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
    }
    if (!editingEntryId && entryForm.type === 'entrada' && entryForm.applyAutoDistribution) {
      const distributed = distributeOrderPayment({
        paymentAmount: entryForm.amount,
        orderTotal: entryForm.amount,
        orderProductionCost: 0,
        cashboxes: payload.caixas,
        currentBalances: cashboxBalances,
        description: entryForm.description,
        paymentDate: nextEntry.createdAt,
      })
      payload.financeiro.push(...distributed)
    } else {
      if (!entryForm.cashboxId) return // required if not auto-distributing
      if (editingEntryId) {
        payload.financeiro = payload.financeiro.map((ex) => (ex.id === editingEntryId ? nextEntry : ex))
      } else {
        payload.financeiro = [...payload.financeiro, nextEntry]
      }
    }
    dataService.replaceAll(payload, {
      auditEvent: {
        category: editingEntryId ? 'alteracao' : 'acao',
        title: editingEntryId ? 'Lancamento atualizado' : 'Novo lancamento',
        description: nextEntry.description,
      }
    })
    refresh()
    setIsEntryModalOpen(false)
    setEditingEntryId(null)
    setEntryForm(DEFAULT_ENTRY_FORM)
    setStatus(editingEntryId ? 'Lancamento atualizado.' : 'Lancamento registrado.')
  }

  const handleDepositCash = () => {
    const payload = dataService.getAll()
    payload.physicalCashBalance = 0
    dataService.replaceAll(payload, {
      auditEvent: {
        category: 'acao',
        title: 'Deposito Realizado',
        description: 'Dinheiro fisico da gaveta depositado e zerado.',
      },
    })
    refresh()
    setStatus('Dinheiro fisico depositado e contador zerado com sucesso.')
  }

  return (
    <Page className="financeiro">
      <PageHeader
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="button button--ghost" type="button" onClick={() => setIsEntryModalOpen(true)}>
              <span className="material-symbols-outlined page-header__action-icon" aria-hidden="true">add</span>
              <span className="page-header__action-label">Novo lançamento</span>
            </button>
            <button className="button button--primary" type="button" onClick={openNewModal}>
              <span className="material-symbols-outlined page-header__action-icon" aria-hidden="true">add</span>
              <span className="page-header__action-label">Novo caixa</span>
            </button>
          </div>
        }
      />

      <QuickNotice message={status} onClear={() => setStatus(null)} />

      <div className="summary summary-card">
        <article className="summary__item">
          <span className="summary__label">Saldo total</span>
          <strong className="summary__value">{formatCurrency(totalBalance)}</strong>
        </article>

        <article className="summary__item">
          <span className="summary__label">Caixas cadastrados</span>
          <strong className="summary__value">{customBoxes.length}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Alocacao da margem</span>
          <strong className="summary__value">{totalAllocation}%</strong>
        </article>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* CAIXA DE PRODUÇÃO */}
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel__header">
            <div>
              <h2>
                Caixa de Producao{' '}
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '1.1rem', color: '#9ca3af', cursor: 'help', verticalAlign: 'middle', marginLeft: '0.25rem' }}
                  title="Caixa fixo e automatico dedicado ao custo de materias-primas e insumos dos pedidos."
                >
                  info
                </span>
              </h2>
              <p>Reservado para o custo de producao.</p>
            </div>
            <span className="badge badge--entrada">Fixo sistemico</span>
          </div>
          <div className="panel__items">
            <div className="panel__item">
              <span className="panel__item-label">Saldo reservado</span>
              <strong className="panel__item-value" style={{ color: '#047857' }}>{formatCurrency(productionBalance)}</strong>
            </div>
          </div>
        </section>

        {/* CAIXA DE LUCRO */}
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel__header">
            <div>
              <h2>
                Caixa de Lucro{' '}
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '1.1rem', color: '#9ca3af', cursor: 'help', verticalAlign: 'middle', marginLeft: '0.25rem' }}
                  title="Reservatorio final. Recebe margem apenas quando os caixas customizados atingirem seus tetos de seguranca."
                >
                  info
                </span>
              </h2>
              <p>Reservatorio de lucros excedentes.</p>
            </div>
            <span className="badge badge--saida">Fixo sistemico</span>
          </div>
          <div className="panel__items">
            <div className="panel__item">
              <span className="panel__item-label">Saldo real (Livres)</span>
              <strong className="panel__item-value" style={{ color: '#0369a1' }}>{formatCurrency(profitBalance)}</strong>
            </div>
          </div>
        </section>

        {/* DINHEIRO EM ESPECIE */}
        <section className="panel" style={{ marginBottom: 0 }}>
          <div className="panel__header">
            <div>
              <h2>
                Gaveta / Balcao{' '}
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: '1.1rem', color: '#9ca3af', cursor: 'help', verticalAlign: 'middle', marginLeft: '0.25rem' }}
                  title="Total de dinheiro fisico recebido em especie."
                >
                  info
                </span>
              </h2>
              <p>Dinheiro fisico acumulado.</p>
            </div>
            <span className="badge badge--alerta">Em Especie</span>
          </div>
          <div className="panel__items" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="panel__item">
              <span className="panel__item-label">Saldo em maos</span>
              <strong className="panel__item-value" style={{ color: '#d97706' }}>{formatCurrency(physicalCash)}</strong>
            </div>
            {physicalCash > 0 && (
              <button className="button button--ghost" type="button" onClick={handleDepositCash}>
                <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>account_balance</span>
                Zerar gaveta
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Caixas customizados</h2>
            <p>Estrutura de caixas para divisao da margem de lucro.</p>
          </div>
          <span className="panel__meta">{customBoxes.length} registros</span>
        </div>
        <div className="table-card">
          <table className="table">
            <thead className="table__head table__head--mobile-hide">
              <tr>
                <th>Nome do caixa</th>
                <th>Finalidade</th>
                <th>Alocacao (%)</th>
                <th>Teto objetivo</th>
                <th>Saldo atual</th>
                <th className="table__actions table__actions--end">Editar</th>
              </tr>
            </thead>
            <tbody>
              {customBoxes.length === 0 && (
                <tr>
                  <td colSpan={6} className="table__empty">
                    Nenhum caixa customizado registrado ainda. Clique em "Novo caixa customizado" para cadastrar.
                  </td>
                </tr>
              )}
              {customBoxes.map((box) => {
                const balance = cashboxBalances.get(box.id) ?? 0
                const maxTarget = box.maxTarget ?? 0
                const minTarget = maxTarget > 0 ? (maxTarget * (box.minPercent ?? 65)) / 100 : 0
                const idealTarget = maxTarget > 0 ? (maxTarget * (box.idealPercent ?? 85)) / 100 : 0

                return (
                  <tr key={box.id}>
                    <td>
                      <div className="table__stack">
                        <strong>
                          {box.name}
                          {box.isReversalBox && (
                            <span className="badge badge--saida" style={{ marginLeft: '0.5rem' }}>
                              Estornos
                            </span>
                          )}
                        </strong>
                      </div>
                    </td>
                    <td className="table__cell--mobile-hide">{box.description ?? '-'}</td>
                    <td>
                      <strong>{box.allocationPercent ?? 0}%</strong>
                    </td>
                    <td className="table__cell--mobile-hide">
                      {maxTarget > 0 ? (
                        <div className="table__stack">
                          <strong>{formatCurrency(maxTarget)}</strong>
                          <span className="table__sub">
                            Min: {formatCurrency(minTarget)} · Ideal: {formatCurrency(idealTarget)}
                          </span>
                        </div>
                      ) : (
                        <span className="table__sub">Sem teto</span>
                      )}
                    </td>
                    <td>
                      <strong>{formatCurrency(balance)}</strong>
                    </td>
                    <td className="table__actions table__actions--end">
                      <ActionMenu
                        items={[
                          { label: 'Editar', onClick: () => handleEdit(box) },
                          { label: 'Excluir', onClick: () => setDeleteId(box.id) },
                        ]}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Editar caixa customizado' : 'Novo caixa customizado'}
        size="lg"
        actions={
          <>
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
            <button className="button button--primary" type="submit" form={cashboxFormId}>
              <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                save
              </span>
              <span className="modal__action-label">Salvar</span>
            </button>
          </>
        }
      >
        <form id={cashboxFormId} className="modal__form" onSubmit={handleSubmit}>
          <div className="modal__group">
            <label className="modal__label" htmlFor="cashbox-name">
              Nome do caixa
            </label>
            <input
              id="cashbox-name"
              className="modal__input"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: Despesas fixas, Reposicao..."
            />
          </div>

          <div className="modal__group">
            <label className="modal__label" htmlFor="cashbox-description">
              Descricao / Finalidade
            </label>
            <input
              id="cashbox-description"
              className="modal__input"
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Ex: Aluguel, contas, manutencao..."
            />
          </div>

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="cashbox-alloc">
                Porcentagem de alocacao (%)
              </label>
              <input
                id="cashbox-alloc"
                className="modal__input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={form.allocationPercent}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, allocationPercent: Number(e.target.value) }))
                }
              />
            </div>

            <div className="modal__group">
              <label className="modal__label" htmlFor="cashbox-max-target">
                Teto objetivo (R$)
              </label>
              <CurrencyInput
                id="cashbox-max-target"
                className="modal__input"
                value={form.maxTarget}
                onValueChange={(val) => setForm((prev) => ({ ...prev, maxTarget: val ?? 0 }))}
              />
            </div>
          </div>

          {form.maxTarget > 0 && (
            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor="cashbox-min-pc">
                  Margem minima (% do teto)
                </label>
                <input
                  id="cashbox-min-pc"
                  className="modal__input"
                  type="number"
                  min="0"
                  max="100"
                  value={form.minPercent}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, minPercent: Number(e.target.value) }))
                  }
                />
                <small style={{ color: '#6b7280', display: 'block', marginTop: '0.25rem' }}>
                  = {formatCurrency((form.maxTarget * form.minPercent) / 100)}
                </small>
              </div>

              <div className="modal__group">
                <label className="modal__label" htmlFor="cashbox-ideal-pc">
                  Margem ideal (% do teto)
                </label>
                <input
                  id="cashbox-ideal-pc"
                  className="modal__input"
                  type="number"
                  min="0"
                  max="100"
                  value={form.idealPercent}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, idealPercent: Number(e.target.value) }))
                  }
                />
                <small style={{ color: '#6b7280', display: 'block', marginTop: '0.25rem' }}>
                  = {formatCurrency((form.maxTarget * form.idealPercent) / 100)}
                </small>
              </div>
            </div>
          )}

          <div className="modal__group" style={{ marginTop: '1rem' }}>
            <label className="toggle modal__checkbox">
              <input
                type="checkbox"
                checked={form.isReversalBox}
                onChange={(e) => setForm((prev) => ({ ...prev, isReversalBox: e.target.checked }))}
              />
              <span className="toggle__track" aria-hidden="true">
                <span className="toggle__thumb" />
              </span>
              <span className="toggle__label" style={{ fontWeight: 600 }}>
                Definir como "Caixa Padrão para Estornos"
              </span>
            </label>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem', marginLeft: '3rem' }}>
              ℹ️ Quando houver um estorno ou devolução de pedido, o valor será subtraído deste caixa. (Apenas 1 caixa pode ser o padrão).
            </p>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Excluir caixa customizado?"
        description={
          cashboxToDelete
            ? `O caixa "${cashboxToDelete.name}" sera removido do sistema.`
            : 'Esta acao nao podera ser desfeita.'
        }
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Ultimos lancamentos</h2>
            <p>Registros por categoria e impacto no saldo.</p>
          </div>
          <span className="panel__meta">{entries.length} registros</span>
        </div>
        <div className="table-card">
          <table className="table">
            <thead className="table__head table__head--mobile-hide">
              <tr>
                <th>Data</th>
                <th>Descricao</th>
                <th>Caixa</th>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th className="table__actions table__actions--end">Editar</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="table__empty">
                    Nenhum lancamento registrado ainda.
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="table__cell--mobile-hide">
                    {formatDateShort(entry.createdAt)}
                  </td>
                  <td className="table__cell--truncate">
                    <div className="table__stack">
                      <strong>{entry.description}</strong>
                      <span className="table__sub table__sub--mobile">
                        {formatDateShort(entry.createdAt)}
                      </span>
                      <span className="table__sub table__sub--mobile">
                        {formatCurrency(entry.amount)}
                      </span>
                    </div>
                  </td>
                  <td className="table__cell--mobile-hide">
                    {entry.type === 'transferencia' && entry.transferToId
                      ? `${getCashboxName(entry.cashboxId)} → ${getCashboxName(entry.transferToId)}`
                      : getCashboxName(entry.cashboxId)}
                  </td>
                  <td className="table__cell--mobile-hide">{entry.category ?? '-'}</td>
                  <td>
                    <span
                      className={`badge ${
                        entry.type === 'entrada'
                          ? 'badge--entrada'
                          : entry.type === 'saida'
                            ? 'badge--saida'
                            : 'badge--transferencia'
                      }`}
                    >
                      {entry.type}
                    </span>
                  </td>
                  <td className="table__cell--mobile-hide">{formatCurrency(entry.amount)}</td>
                  <td className="table__actions table__actions--end">
                    <ActionMenu
                      items={[
                        { label: 'Editar', onClick: () => handleEditEntry(entry) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={isEntryModalOpen}
        onClose={() => setIsEntryModalOpen(false)}
        title={editingEntryId ? 'Editar lancamento' : 'Novo lancamento'}
        size="lg"
        actions={
          <>
            {editingEntryId && (
              <button
                className="button button--danger"
                type="button"
                onClick={() => setDeleteEntryId(editingEntryId)}
              >
                <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                  delete
                </span>
                <span className="modal__action-label">Excluir</span>
              </button>
            )}
            <button className="button button--primary" type="submit" form={financeFormId}>
              <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                save
              </span>
              <span className="modal__action-label">
                {editingEntryId ? 'Salvar' : 'Registrar'}
              </span>
            </button>
          </>
        }
      >
        <form id={financeFormId} className="modal__form" onSubmit={handleEntrySubmit}>
            <div className="modal__group">
              <label className="modal__label" htmlFor="finance-type">
                Tipo
              </label>
              <select
                id="finance-type"
                className="modal__input"
                value={entryForm.type}
                onChange={(event) =>
                  setEntryForm(prev => ({ ...prev, type: event.target.value as FinanceEntry['type'] }))
                }
              >
                <option value="entrada">Entrada</option>
                <option value="saida">Saida</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>

            <div className="modal__group">
              <label className="modal__label" htmlFor="finance-description">
                Descricao
              </label>
              <input
                id="finance-description"
                className="modal__input"
                type="text"
                required
                value={entryForm.description}
                onChange={(event) => setEntryForm(prev => ({ ...prev, description: event.target.value }))}
                placeholder="Ex: Compra de material"
              />
            </div>

            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor="finance-amount">
                  Valor
                </label>
                <CurrencyInput
                  id="finance-amount"
                  className="modal__input"
                  value={entryForm.amount}
                  onValueChange={(value) => setEntryForm(prev => ({ ...prev, amount: value ?? 0 }))}
                />
              </div>
              <div className="modal__group">
                <label className="modal__label" htmlFor="finance-category">
                  Categoria
                </label>
                <input
                  id="finance-category"
                  className="modal__input"
                  type="text"
                  value={entryForm.category}
                  onChange={(event) => setEntryForm(prev => ({ ...prev, category: event.target.value }))}
                  placeholder="Materiais, manutencao..."
                />
              </div>
            </div>

            {!editingEntryId && entryForm.type === 'entrada' && (
              <div className="modal__group" style={{ marginBottom: '1rem' }}>
                <label className="toggle modal__checkbox">
                  <input
                    type="checkbox"
                    checked={!!entryForm.applyAutoDistribution}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, applyAutoDistribution: e.target.checked }))}
                  />
                  <span className="toggle__track" aria-hidden="true">
                    <span className="toggle__thumb" />
                  </span>
                  <span className="toggle__label" style={{ fontWeight: 600, color: '#0369a1' }}>
                    Distribuir automaticamente (Aplicar Rateio)
                  </span>
                </label>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem', marginLeft: '3rem' }}>
                  O valor sera rateado automaticamente entre seus caixas de acordo com as porcentagens.
                </p>
              </div>
            )}

            <div className="modal__row">
              {(!entryForm.applyAutoDistribution || entryForm.type !== 'entrada') && (
                <div className="modal__group">
                  <label className="modal__label" htmlFor="finance-cashbox">
                    Caixa de origem
                  </label>
                  <select
                    id="finance-cashbox"
                    className="modal__input"
                    required={!entryForm.applyAutoDistribution}
                    value={entryForm.cashboxId}
                    onChange={(event) => setEntryForm(prev => ({ ...prev, cashboxId: event.target.value }))}
                  >
                    <option value="">Selecionar caixa</option>
                    <option value="caixa_producao">Caixa de Producao</option>
                    <option value="caixa_lucro">Caixa de Lucro</option>
                    {customBoxes.map((cashbox) => (
                      <option key={cashbox.id} value={cashbox.id}>
                        {cashbox.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {entryForm.type === 'transferencia' && (
                <div className="modal__group">
                  <label className="modal__label" htmlFor="finance-cashbox-dest">
                    Caixa de destino
                  </label>
                  <select
                    id="finance-cashbox-dest"
                    className="modal__input"
                    required
                    value={entryForm.transferToId}
                    onChange={(event) => setEntryForm(prev => ({ ...prev, transferToId: event.target.value }))}
                  >
                    <option value="">Selecionar caixa</option>
                    <option value="caixa_producao">Caixa de Producao</option>
                    <option value="caixa_lucro">Caixa de Lucro</option>
                    {customBoxes.map((cashbox) => (
                      <option key={cashbox.id} value={cashbox.id}>
                        {cashbox.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteEntryId}
        title="Excluir lancamento?"
        description="Este lancamento sera removido do financeiro e os saldos dos caixas serao atualizados. Esta acao nao pode ser desfeita."
        onClose={() => setDeleteEntryId(null)}
        onConfirm={handleDeleteEntry}
      />
    </Page>
  )
}

export default Financeiro
