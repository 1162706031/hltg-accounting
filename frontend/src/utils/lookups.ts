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

export interface CreatorOption {
  id: number
  username: string
  real_name?: string | null
  is_active: boolean
}

export const RETIRED_ITEM_TYPE_CODES = new Set(['raw_material', 'finished_product', 'semi_finished'])

export const PROCESSING_FEE_EXCLUDED_ITEM_TYPES = new Set(['raw_material', 'scrap'])

export function countsForProcessingFee(itemId: number | null | undefined, items?: ItemOption[]) {
  const item = (items ?? []).find((it) => it.id === itemId)
  return item == null || !PROCESSING_FEE_EXCLUDED_ITEM_TYPES.has(item.item_type)
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

export type MasterDataCategory = 'process' | 'item_type' | 'item_name' | 'specification'

export interface MasterDataOption {
  id: number
  category: MasterDataCategory
  code: string
  name: string
  is_system: boolean
  created_by?: number | null
  created_at: string
  updated_at: string
}

/** 加载基础资料选项；业务下拉与配置页面共用同一份缓存。 */
export function useMasterDataOptions(category?: MasterDataCategory) {
  return useQuery({
    queryKey: ['master-data-options', category ?? 'all'],
    queryFn: async () => (
      await api.get<MasterDataOption[]>('/master-data/options', {
        params: category ? { category } : undefined
      })
    ).data
  })
}

export function masterDataSelectOptions(options?: MasterDataOption[]) {
  return (options ?? []).map((option) => ({ value: option.code, label: option.name }))
}

export function masterDataLabelMap(options?: MasterDataOption[]) {
  return Object.fromEntries((options ?? []).map((option) => [option.code, option.name])) as Record<string, string>
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
export function inventoryStockOptions(
  rows?: InventoryStockOption[],
  itemTypeLabels: Record<string, string> = ITEM_TYPE_LABELS
) {
  return (rows ?? []).map((r) => {
    const parts = [r.item?.name ?? '未知物品']
    if (r.item?.item_type) parts.push(`类别：${itemTypeLabels[r.item.item_type] ?? r.item.item_type}`)
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

/** 加载创建人筛选选项；包含停用用户，确保历史单据仍可筛选。 */
export function useCreatorOptions() {
  return useQuery({
    queryKey: ['users', 'creator-options'],
    queryFn: async () => (await api.get<CreatorOption[]>('/users/options')).data
  })
}

export function creatorOptions(users?: CreatorOption[]) {
  return (users ?? []).map((user) => ({
    value: user.id,
    label: `${user.real_name ? `${user.real_name}（${user.username}）` : user.username}${user.is_active ? '' : ' · 已停用'}`
  }))
}

export function itemTypeSelectOptions(options?: MasterDataOption[]) {
  const configured = masterDataSelectOptions(options).filter((option) => !RETIRED_ITEM_TYPE_CODES.has(String(option.value)))
  if (configured.length) return configured
  return Object.entries(ITEM_TYPE_LABELS)
    .filter(([value]) => !RETIRED_ITEM_TYPE_CODES.has(value))
    .map(([value, label]) => ({ value, label }))
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

export function itemOptions(items?: ItemOption[], itemTypeLabels: Record<string, string> = ITEM_TYPE_LABELS) {
  return (items ?? []).map((i) => {
    const type = itemTypeLabels[i.item_type] ?? i.item_type
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
