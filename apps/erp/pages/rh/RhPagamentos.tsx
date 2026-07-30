import { useMemo, useState, type FormEvent } from 'react'
import ActionMenu from '../../components/ActionMenu'
import ConfirmDialog from '../../components/ConfirmDialog'
import CurrencyInput from '../../components/CurrencyInput'
import Modal from '@shared/components/Modal'
import { Page, PageHeader } from '@ui/components'
import { dataService } from '@shared/services/dataService'
import { useERPData } from '@shared/store/appStore'
import QuickNotice from '@shared/components/QuickNotice'
import type { EmployeePayment, EmployeePaymentStatus } from '@shared/types/erp'
import { formatCurrency, formatDateShort } from '@shared/utils/format'
import { PAYMENT_METHODS } from '@shared/data/paymentMethods'
import { createId } from '@shared/utils/ids'

type PaymentForm = {
  employeeId: string
  periodStart: string
  periodEnd: string
  baseValue: number
  extras: number
  discounts: number
  status: EmployeePaymentStatus
  method: string
  cashboxId: string
  extrasCashboxId: string
  notes: string
}

const statusOptions: { value: EmployeePaymentStatus; label: string }[] = [
  { value: 'aberto', label: 'Em aberto' },
  { value: 'pago', label: 'Pago' },
  { value: 'cancelado', label: 'Cancelado' },
]

const paymentStatusStyles: Record<EmployeePaymentStatus, string> = {
  aberto: 'badge--aberto',
  pago: 'badge--pago',
  cancelado: 'badge--cancelada',
}

const createEmptyForm = (): PaymentForm => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    employeeId: '',
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    baseValue: 0,
    extras: 0,
    discounts: 0,
    status: 'aberto',
    method: 'a_definir',
    cashboxId: 'caixa_producao',
    extrasCashboxId: 'caixa_lucro',
    notes: '',
  }
}

const RhPagamentos = () => {
  const { data, refresh } = useERPData()
  const [status, setStatus] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<PaymentForm>(createEmptyForm())
  const paymentFormId = 'pagamento-form'

  const employees = useMemo(
    () => [...data.funcionarios].sort((a, b) => a.name.localeCompare(b.name)),
    [data.funcionarios],
  )
  const pagamentos = useMemo(
    () => [...data.pagamentosRH].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
    [data.pagamentosRH],
  )
  const cashboxes = useMemo(
    () => [...data.caixas].sort((a, b) => a.name.localeCompare(b.name)),
    [data.caixas],
  )

  const totalPago = pagamentos
    .filter((entry) => entry.status === 'pago')
    .reduce((acc, entry) => acc + entry.total, 0)
  const totalAberto = pagamentos
    .filter((entry) => entry.status === 'aberto')
    .reduce((acc, entry) => acc + entry.total, 0)

  const getEmployeeName = (id: string) =>
    employees.find((employee) => employee.id === id)?.name ?? '-'
  const getCashboxName = (id?: string) =>
    cashboxes.find((cashbox) => cashbox.id === id)?.name ?? '-'

  const openModal = () => {
    setStatus(null)
    setEditingId(null)
    setForm(createEmptyForm())
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
  }

  const handleEdit = (entry: EmployeePayment) => {
    setEditingId(entry.id)
    setForm({
      employeeId: entry.employeeId,
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      baseValue: entry.baseValue,
      extras: entry.extras,
      discounts: entry.discounts,
      status: entry.status,
      method: entry.method ?? 'a_definir',
      cashboxId: entry.cashboxId ?? 'caixa_producao',
      extrasCashboxId: entry.extrasCashboxId ?? 'caixa_lucro',
      notes: entry.notes ?? '',
    })
    setIsModalOpen(true)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.employeeId) {
      setStatus('Selecione um funcionario.')
      return
    }
    if (!form.periodStart || !form.periodEnd) {
      setStatus('Informe o periodo.')
      return
    }
    const total = form.baseValue + form.extras - form.discounts
    if (total < 0) {
      setStatus('O total nao pode ser negativo.')
      return
    }

    if (form.status === 'pago' && !form.cashboxId) {
      setStatus('Selecione o caixa para registrar o pagamento.')
      return
    }

    const payload = dataService.getAll()
    const existingPayment = editingId
      ? payload.pagamentosRH.find((entry) => entry.id === editingId)
      : undefined
    let financeEntryId = existingPayment?.financeEntryId
    let paidAt = existingPayment?.paidAt
    const createdAt = existingPayment?.createdAt ?? new Date().toISOString()

    if (form.status === 'pago') {
      paidAt = paidAt ?? new Date().toISOString()
      const employeeName = getEmployeeName(form.employeeId)
      const description = `Pagamento RH: ${employeeName} (${formatDateShort(
        form.periodStart,
      )} - ${formatDateShort(form.periodEnd)})`
      if (financeEntryId) {
        payload.financeiro = payload.financeiro.map((entry) =>
          entry.id === financeEntryId
            ? {
                ...entry,
                amount: total,
                cashboxId: form.cashboxId,
                description,
                createdAt: entry.createdAt ?? paidAt ?? new Date().toISOString(),
              }
            : entry,
        )
      } else {
        financeEntryId = createId()
        payload.financeiro = [
          ...payload.financeiro,
          {
            id: financeEntryId,
            type: 'saida',
            description,
            amount: total,
            category: 'RH',
            createdAt: paidAt ?? new Date().toISOString(),
            cashboxId: form.cashboxId,
          },
        ]
      }
    } else if (existingPayment?.financeEntryId) {
      payload.financeiro = payload.financeiro.filter(
        (entry) => entry.id !== existingPayment.financeEntryId,
      )
      financeEntryId = undefined
      paidAt = undefined
    } else {
      paidAt = undefined
    }

    const next: EmployeePayment = {
      id: editingId ?? createId(),
      employeeId: form.employeeId,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      baseValue: form.baseValue,
      extras: form.extras,
      discounts: form.discounts,
      total,
      status: form.status,
      method: form.method || undefined,
      cashboxId: form.status === 'pago' ? form.cashboxId : undefined,
      financeEntryId,
      createdAt,
      paidAt,
      notes: form.notes.trim() || undefined,
    }

    if (editingId) {
      payload.pagamentosRH = payload.pagamentosRH.map((entry) =>
        entry.id === editingId ? next : entry,
      )
    } else {
      payload.pagamentosRH = [...payload.pagamentosRH, next]
    }
    dataService.replaceAll(payload)
    refresh()
    setStatus(editingId ? 'Pagamento atualizado.' : 'Pagamento registrado.')
    setIsModalOpen(false)
  }

  const handleDelete = () => {
    if (!deleteId) {
      return
    }
    const payload = dataService.getAll()
    const target = payload.pagamentosRH.find((entry) => entry.id === deleteId)
    payload.pagamentosRH = payload.pagamentosRH.filter((entry) => entry.id !== deleteId)
    if (target?.financeEntryId) {
      payload.financeiro = payload.financeiro.filter(
        (entry) => entry.id !== target.financeEntryId,
      )
    }
    dataService.replaceAll(payload)
    refresh()
    setIsModalOpen(false)
    setStatus('Pagamento removido.')
    setDeleteId(null)
  }

  return (
    <Page className="rh-page">
      <PageHeader
        actions={
          <button className="button button--primary" type="button" onClick={openModal}>
            <span className="material-symbols-outlined page-header__action-icon" aria-hidden="true">
              payments
            </span>
            <span className="page-header__action-label">Registrar pagamento</span>
          </button>
        }
      />

      <QuickNotice message={status} onClear={() => setStatus(null)} />

      <div className="summary summary-card">
        <article className="summary__item">
          <span className="summary__label">Pagamentos</span>
          <strong className="summary__value">{pagamentos.length}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Total pago</span>
          <strong className="summary__value">{formatCurrency(totalPago)}</strong>
        </article>
        <article className="summary__item">
          <span className="summary__label">Em aberto</span>
          <strong className="summary__value">{formatCurrency(totalAberto)}</strong>
        </article>
      </div>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Pagamentos registrados</h2>
            <p>Historico de pagamentos por periodo.</p>
          </div>
          <span className="panel__meta">{pagamentos.length} registros</span>
        </div>
        <div className="table-card">
          <table className="table">
            <thead className="table__head table__head--mobile-hide">
              <tr>
                <th>Funcionario</th>
                <th>Periodo</th>
                <th>Total</th>
                <th>Caixa</th>
                <th className="table__actions table__actions--end">Status / Editar</th>
              </tr>
            </thead>
            <tbody>
              {pagamentos.length === 0 && (
                <tr>
                  <td colSpan={5} className="table__empty">
                    Nenhum pagamento registrado ainda.
                  </td>
                </tr>
              )}
              {pagamentos.map((entry) => (
                <tr key={entry.id}>
                  <td className="table__cell--truncate">
                    <div className="table__stack">
                      <strong>{getEmployeeName(entry.employeeId)}</strong>
                      <span className="table__sub table__sub--mobile">
                        {formatCurrency(entry.total)}
                      </span>
                      <span className="table__sub table__sub--mobile">
                        {formatDateShort(entry.periodEnd)}
                      </span>
                    </div>
                  </td>
                  <td className="table__cell--mobile-hide">
                    {formatDateShort(entry.periodStart)} - {formatDateShort(entry.periodEnd)}
                  </td>
                  <td className="table__cell--mobile-hide">{formatCurrency(entry.total)}</td>
                  <td className="table__cell--mobile-hide">
                    {entry.cashboxId ? getCashboxName(entry.cashboxId) : '-'}
                  </td>
                  <td className="table__actions table__actions--end">
                    <div className="table__end">
                      <div className="table__status">
                        <span className={`badge ${paymentStatusStyles[entry.status]}`}>
                          {statusOptions.find((item) => item.value === entry.status)?.label}
                        </span>
                      </div>
                      <ActionMenu
                        items={[
                          { label: 'Editar', onClick: () => handleEdit(entry) },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar pagamento' : 'Registrar pagamento'}
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
            <button className="button button--primary" type="submit" form={paymentFormId}>
              <span className="material-symbols-outlined modal__action-icon" aria-hidden="true">
                save
              </span>
              <span className="modal__action-label">Salvar</span>
            </button>
          </>
        }
      >
        <form id={paymentFormId} className="modal__form" onSubmit={handleSubmit}>
          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-employee">
                Funcionario
              </label>
              <select
                id="pay-employee"
                className="modal__input"
                value={form.employeeId}
                onChange={(event) => setForm((prev) => ({ ...prev, employeeId: event.target.value }))}
              >
                <option value="">Selecione</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-status">
                Status
              </label>
              <select
                id="pay-status"
                className="modal__input"
                value={form.status}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    status: event.target.value as EmployeePaymentStatus,
                  }))
                }
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.status === 'pago' && (
            <div className="modal__row">
              <div className="modal__group">
                <label className="modal__label" htmlFor="pay-cashbox">
                  Caixa Base (Salario)
                </label>
                <select
                  id="pay-cashbox"
                  className="modal__input"
                  value={form.cashboxId}
                  onChange={(event) => setForm((prev) => ({ ...prev, cashboxId: event.target.value }))}
                >
                  <option value="caixa_producao">Caixa de Producao</option>
                  <option value="caixa_lucro">Caixa de Lucro</option>
                  {cashboxes.filter(c => !c.isProductionBox && !c.isProfitBox).map((cashbox) => (
                    <option key={cashbox.id} value={cashbox.id}>{cashbox.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal__group">
                <label className="modal__label" htmlFor="pay-extras-cashbox">
                  Caixa de Extras (Bonus)
                </label>
                <select
                  id="pay-extras-cashbox"
                  className="modal__input"
                  value={form.extrasCashboxId}
                  onChange={(event) => setForm((prev) => ({ ...prev, extrasCashboxId: event.target.value }))}
                >
                  <option value="caixa_lucro">Caixa de Lucro</option>
                  <option value="caixa_producao">Caixa de Producao</option>
                  {cashboxes.filter(c => !c.isProductionBox && !c.isProfitBox).map((cashbox) => (
                    <option key={cashbox.id} value={cashbox.id}>{cashbox.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-start">
                Inicio
              </label>
              <input
                id="pay-start"
                className="modal__input"
                type="date"
                value={form.periodStart}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, periodStart: event.target.value }))
                }
              />
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-end">
                Fim
              </label>
              <input
                id="pay-end"
                className="modal__input"
                type="date"
                value={form.periodEnd}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, periodEnd: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-base">
                Base (R$)
              </label>
              <CurrencyInput
                id="pay-base"
                className="modal__input"
                value={form.baseValue}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, baseValue: value ?? 0 }))
                }
              />
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-extras">
                Extras (R$)
              </label>
              <CurrencyInput
                id="pay-extras"
                className="modal__input"
                value={form.extras}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, extras: value ?? 0 }))
                }
              />
            </div>
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-discounts">
                Descontos (R$)
              </label>
              <CurrencyInput
                id="pay-discounts"
                className="modal__input"
                value={form.discounts}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, discounts: value ?? 0 }))
                }
              />
            </div>
          </div>

          <div className="modal__row">
            <div className="modal__group">
              <label className="modal__label" htmlFor="pay-method">
                Metodo
              </label>
              <select
                id="pay-method"
                className="modal__input"
                value={form.method}
                onChange={(event) => setForm((prev) => ({ ...prev, method: event.target.value }))}
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.id} value={pm.id}>{pm.label}</option>
                ))}
              </select>
            </div>
            <div className="modal__group">
              <label className="modal__label">Total</label>
              <input
                className="modal__input"
                type="text"
                value={formatCurrency(form.baseValue + form.extras - form.discounts)}
                disabled
              />
            </div>
          </div>

          <div className="modal__group">
            <label className="modal__label" htmlFor="pay-notes">
              Observacoes
            </label>
            <textarea
              id="pay-notes"
              className="modal__textarea"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Notas do pagamento"
            />
          </div>

        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Excluir pagamento?"
        description="Este registro sera removido."
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </Page>
  )
}

export default RhPagamentos
