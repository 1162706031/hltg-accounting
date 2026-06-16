export type OrderRefType = 'smelting_order' | 'outsource_order' | 'procurement_order' | 'sales_order'

export interface LinkedOrder {
  ref_type: string
  ref_id: number
  batch_no?: string | null
}

export interface ReconciliationOrderRow {
  id: number
  ref_type?: string | null
  ref_id?: number | null
  biz_date?: string | null
  biz_desc?: string | null
  debit?: string | number | null
  credit?: string | number | null
  invoice_amount?: string | number | null
  recon_status?: string | null
}

export const refTypeOptions: Array<{ value: OrderRefType; label: string }> = [
  { value: 'smelting_order', label: '冶炼' },
  { value: 'outsource_order', label: '外协' },
  { value: 'procurement_order', label: '采购' },
  { value: 'sales_order', label: '销售' }
]

export const refTypeLabels = Object.fromEntries(refTypeOptions.map((item) => [item.value, item.label]))

export function orderKey(refType?: string | null, refId?: number | null) {
  return refType && refId ? `${refType}:${refId}` : ''
}

export function parseOrderKey(key?: string | null): LinkedOrder | null {
  if (!key) return null
  const [refType, refIdText] = key.split(':')
  const refId = Number(refIdText)
  if (!refType || !Number.isInteger(refId) || refId <= 0) return null
  return { ref_type: refType, ref_id: refId }
}

export function linkedOrderKeysFromRecord(row: {
  linked_orders?: LinkedOrder[] | null
  ref_type?: string | null
  ref_id?: number | null
}) {
  if (row.linked_orders?.length) {
    return row.linked_orders.map((item) => orderKey(item.ref_type, item.ref_id)).filter(Boolean)
  }
  const key = orderKey(row.ref_type, row.ref_id)
  return key ? [key] : []
}

export function linkedOrdersFromKeys(keys: string[] | undefined, rowsByKey: Map<string, ReconciliationOrderRow>) {
  const orders: LinkedOrder[] = []

  for (const key of keys ?? []) {
    const parsed = parseOrderKey(key)
    if (!parsed) continue
    const row = rowsByKey.get(key)
    orders.push({
      ...parsed,
      batch_no: row?.biz_desc ?? null
    })
  }

  return orders
}

export function firstLinkedOrder(keys: string[] | undefined) {
  return parseOrderKey(keys?.[0])
}

export function formatLinkedOrders(row: {
  linked_orders?: LinkedOrder[] | null
  ref_type?: string | null
  ref_id?: number | null
}) {
  const orders = row.linked_orders?.length
    ? row.linked_orders
    : row.ref_type || row.ref_id
      ? [{ ref_type: row.ref_type || '订单', ref_id: row.ref_id || 0 }]
      : []

  if (!orders.length) return '—'

  return orders
    .map((item) => {
      const label = refTypeLabels[item.ref_type] ?? item.ref_type
      const batch = item.batch_no ? ` ${item.batch_no}` : ''
      return `${label} #${item.ref_id || '—'}${batch}`
    })
    .join('；')
}
