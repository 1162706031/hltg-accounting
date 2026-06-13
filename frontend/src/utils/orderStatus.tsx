import { Tag } from 'antd'

export type OrderStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'rejected'

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending_review: { label: '待审核', color: 'orange' },
  approved: { label: '已审核', color: 'blue' },
  in_progress: { label: '进行中', color: 'cyan' },
  completed: { label: '已完成', color: 'green' },
  rejected: { label: '驳回', color: 'red' }
}

export const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'pending_review', label: '待审核' },
  { value: 'approved', label: '已审核' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'rejected', label: '驳回' }
]

export function OrderStatusTag({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status] ?? { label: status, color: 'default' }
  return <Tag color={meta.color}>{meta.label}</Tag>
}

/** 根据当前状态返回可用的工作流动作（与后端状态机一致）。 */
export function availableActions(status: OrderStatus): {
  submit?: boolean
  approve?: boolean
  reject?: boolean
  start?: boolean
  complete?: boolean
  unaudit?: boolean
  editable?: boolean
  deletable?: boolean
} {
  switch (status) {
    case 'draft':
      return { submit: true, editable: true, deletable: true }
    case 'pending_review':
      return { approve: true, reject: true }
    case 'approved':
      return { start: true, unaudit: true }
    case 'in_progress':
      return { complete: true, unaudit: true }
    case 'completed':
      return { unaudit: true }
    case 'rejected':
      return { submit: true, editable: true, deletable: true }
    default:
      return {}
  }
}
