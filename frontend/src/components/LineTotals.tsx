interface NormalizedQuantity {
  quantity: number
  unit: string
}

interface LineTotalsProps<T extends object> {
  lines?: T[] | null
  quantityKey?: PropertyKey
  unitKey?: PropertyKey
  priceKey?: PropertyKey
  quantityLabel?: string
  showAmount?: boolean
  normalizeQuantity?: (line: T) => NormalizedQuantity
  amountQuantity?: (line: T) => number
  resolveUnitPrice?: (line: T) => unknown
}

const quantityFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 })
const moneyFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readField(line: object, key: PropertyKey) {
  return (line as Record<PropertyKey, unknown>)[key]
}

/** 新建/编辑明细表的实时汇总条，支持混合单位分组和已计价金额汇总。 */
export function LineTotals<T extends object>({
  lines,
  quantityKey = 'quantity',
  unitKey = 'unit',
  priceKey = 'unit_price',
  quantityLabel = '数量合计',
  showAmount = true,
  normalizeQuantity,
  amountQuantity,
  resolveUnitPrice
}: LineTotalsProps<T>) {
  const rows = lines ?? []
  const quantities = new Map<string, number>()
  let amount = 0
  let pricedCount = 0

  rows.forEach((line) => {
    const normalized = normalizeQuantity?.(line) ?? {
      quantity: finiteNumber(readField(line, quantityKey)),
      unit: String(readField(line, unitKey) || '未指定单位')
    }
    quantities.set(normalized.unit, (quantities.get(normalized.unit) ?? 0) + normalized.quantity)

    if (!showAmount) return
    const rawPrice = resolveUnitPrice?.(line) ?? readField(line, priceKey)
    if (rawPrice == null || rawPrice === '') return
    const price = Number(rawPrice)
    if (!Number.isFinite(price)) return
    const amountBase = amountQuantity?.(line) ?? finiteNumber(readField(line, quantityKey))
    amount += amountBase * price
    pricedCount += 1
  })

  return (
    <div className="line-totals" aria-live="polite">
      <strong>实时合计</strong>
      <span>明细 {rows.length} 条</span>
      {[...quantities.entries()].map(([unit, quantity]) => (
        <span key={unit}>{quantityLabel}：{quantityFormatter.format(quantity)} {unit}</span>
      ))}
      {showAmount && pricedCount > 0 && (
        <span>{pricedCount === rows.length ? '金额合计' : `已计价金额（${pricedCount}/${rows.length} 条）`}：¥{moneyFormatter.format(amount)}</span>
      )}
    </div>
  )
}
