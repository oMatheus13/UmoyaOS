import { createId } from './ids'
import type { Cashbox, FinanceEntry } from '../types/erp'

export type DistributionContext = {
  paymentAmount: number
  orderTotal: number
  orderProductionCost: number
  cashboxes: Cashbox[]
  currentBalances: Map<string, number>
  description: string
  paymentDate: string
}

export function distributeOrderPayment(context: DistributionContext): FinanceEntry[] {
  const {
    paymentAmount,
    orderTotal,
    orderProductionCost,
    cashboxes,
    currentBalances,
    description,
    paymentDate,
  } = context

  if (paymentAmount <= 0) return []
  if (orderTotal <= 0) return [] // Fallback para evitar divisão por zero

  // 1. Calcular a proporção desse pagamento em relação ao pedido
  // Se o pedido custa 1000 e pagou 500, estamos liquidando 50% do pedido.
  const paymentRatio = paymentAmount / orderTotal

  // O valor destinado ao Caixa de Produção é exatamente a proporção do custo de produção total
  const productionAllocation = orderProductionCost * paymentRatio
  
  // O que sobra do pagamento (após tirar a produção) é a nossa Margem Líquida deste pagamento
  const netMargin = Math.max(0, paymentAmount - productionAllocation)

  const entries: FinanceEntry[] = []

  const pushEntry = (amount: number, cashboxId: string, suffix: string) => {
    if (amount <= 0) return
    entries.push({
      id: createId(),
      type: 'entrada',
      description: `${description} (${suffix})`,
      amount,
      createdAt: paymentDate,
      cashboxId,
    })
  }

  // 2. Lançar o Custo de Produção
  pushEntry(productionAllocation, 'caixa_producao', 'Produção')

  if (netMargin <= 0) {
    return entries // Não sobrou margem, acabou aqui.
  }

  // 3. Rateio da Margem Líquida entre os caixas customizados
  // A porcentagem definida no caixa é sobre a Margem Líquida, NÃO sobre o total.
  let remainingMargin = netMargin
  const customBoxes = cashboxes.filter(
    (box) => !box.isProductionBox && !box.isProfitBox && box.id !== 'caixa_producao' && box.id !== 'caixa_lucro'
  )

  for (const box of customBoxes) {
    if (remainingMargin <= 0) break

    const allocPercent = box.allocationPercent ?? 0
    if (allocPercent <= 0) continue

    // O valor teórico que o caixa deveria receber (X% da margem líquida)
    const theoreticalAmount = netMargin * (allocPercent / 100)
    let actualAmountToDeposit = theoreticalAmount

    // Regra do Teto (Transbordo Exato)
    const maxTarget = box.maxTarget ?? 0
    if (maxTarget > 0) {
      // O teto que consideramos aqui é o Ideal (idealPercent)
      const idealPercent = box.idealPercent ?? 85
      const idealTargetValue = (maxTarget * idealPercent) / 100
      
      const currentBalance = currentBalances.get(box.id) ?? 0
      const spaceLeft = Math.max(0, idealTargetValue - currentBalance)

      // Se o que ele precisa pra encher for MENOR que o valor teórico, ele só pega o que falta.
      // O restante fica no 'remainingMargin' para transbordar pro Lucro.
      if (spaceLeft < theoreticalAmount) {
        actualAmountToDeposit = spaceLeft
      }
    }

    // Não podemos depositar mais do que a margem restante disponível
    actualAmountToDeposit = Math.min(actualAmountToDeposit, remainingMargin)

    if (actualAmountToDeposit > 0) {
      pushEntry(actualAmountToDeposit, box.id, box.name)
      remainingMargin -= actualAmountToDeposit
    }
  }

  // 4. Caixa de Lucro (Reservatório Final)
  // Tudo o que sobrou da margem (seja os 80% normais ou o transbordo dos caixas cheios)
  if (remainingMargin > 0) {
    pushEntry(remainingMargin, 'caixa_lucro', 'Lucro')
  }

  return entries
}
