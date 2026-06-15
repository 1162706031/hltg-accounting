import { useQuery } from '@tanstack/react-query'
import { api, PageResult } from '../api/client'

export interface PartyOption {
  id: number
  name: string
  short_name?: string | null
  is_customer: boolean
  is_supplier: boolean
  is_processor: boolean
  is_internal: boolean
}

export interface ItemOption {
  id: number
  name: string
  item_type: string
}

export interface InventoryStockOption {
  id: number
  item_id: number | null
  spec: string | null
  unit: string
  current_quantity: string
  item?: { id: number; name: string; item_type: string } | null
  owner?: { id: number; name: string } | null
}

/** 加载全部往来单位（最多 200），用于下拉选择。 */
export function useParties() {
  return useQuery({
    queryKey: ['parties', 'options'],
    queryFn: async () =>
      (await api.get<PageResult<PartyOption>>('/parties', { params: { page_size: 200 } })).data.items
  })
}

/** 加载全部启用的物品（最多 200），用于业务页下拉选择。停用物品不参与新业务。 */
export function useItems() {
  return useQuery({
    queryKey: ['items', 'options'],
    queryFn: async () =>
      (await api.get<PageResult<ItemOption>>('/items', { params: { page_size: 200, is_active: 1 } })).data.items
  })
}

/** 加载有结余的库存项（最多 200），用于销售明细从现存库存中选择。 */
export function useInventoryStock() {
  return useQuery({
    queryKey: ['inventory', 'stock-options'],
    queryFn: async () =>
      (
        await api.get<PageResult<InventoryStockOption>>('/inventory', {
          params: { page_size: 200, only_positive: true }
        })
      ).data.items
  })
}

/** 库存项下拉选项：展示 物品·规格·归属·结余，便于销售时定位具体批次。 */
export function inventoryStockOptions(rows?: InventoryStockOption[]) {
  return (rows ?? []).map((r) => {
    const parts = [r.item?.name ?? '未知物品']
    if (r.spec) parts.push(r.spec)
    const owner = r.owner?.name ? `（${r.owner.name}）` : ''
    const balance = `结余 ${r.current_quantity}${r.unit}`
    return { value: r.id, label: `${parts.join(' · ')}${owner} ${balance}` }
  })
}

/** 物品类型中文标签，用于下拉选项后缀展示。 */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}

/** 往来单位角色中文标签。 */
const PARTY_ROLE_LABELS: Array<{ key: keyof PartyOption; label: string }> = [
  { key: 'is_internal', label: '本厂' },
  { key: 'is_customer', label: '客户' },
  { key: 'is_supplier', label: '供应商' },
  { key: 'is_processor', label: '外协厂' }
]

/** 单位角色文字，如「客户/供应商」。 */
function partyRoleText(p: PartyOption): string {
  return PARTY_ROLE_LABELS.filter((r) => p[r.key]).map((r) => r.label).join('/')
}

export function partyOptions(parties?: PartyOption[]) {
  return (parties ?? []).map((p) => {
    const name = p.short_name ? `${p.name}（${p.short_name}）` : p.name
    const role = partyRoleText(p)
    return { value: p.id, label: role ? `${name} · ${role}` : name }
  })
}

export function itemOptions(items?: ItemOption[]) {
  return (items ?? []).map((i) => {
    const type = ITEM_TYPE_LABELS[i.item_type] ?? i.item_type
    return { value: i.id, label: type ? `${i.name} · ${type}` : i.name }
  })
}

/** 统一的单位下拉选项（中文）。 */
export const UNIT_OPTIONS = [
  { value: '吨', label: '吨' },
  { value: '千克', label: '千克' },
  { value: '支', label: '支' },
  { value: '个', label: '个' }
]
