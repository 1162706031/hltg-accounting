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

/** 加载全部往来单位（最多 200），用于下拉选择。 */
export function useParties() {
  return useQuery({
    queryKey: ['parties', 'options'],
    queryFn: async () =>
      (await api.get<PageResult<PartyOption>>('/parties', { params: { page_size: 200 } })).data.items
  })
}

/** 加载全部物品（最多 200），用于下拉选择。 */
export function useItems() {
  return useQuery({
    queryKey: ['items', 'options'],
    queryFn: async () =>
      (await api.get<PageResult<ItemOption>>('/items', { params: { page_size: 200 } })).data.items
  })
}

export function partyOptions(parties?: PartyOption[]) {
  return (parties ?? []).map((p) => ({ value: p.id, label: p.short_name ? `${p.name}（${p.short_name}）` : p.name }))
}

export function itemOptions(items?: ItemOption[]) {
  return (items ?? []).map((i) => ({ value: i.id, label: i.name }))
}

/** 统一的单位下拉选项（中文）。 */
export const UNIT_OPTIONS = [
  { value: '吨', label: '吨' },
  { value: '千克', label: '千克' }
]
