import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { DetailModal } from '../components/DetailModal'
import { ListFilters } from '../components/ListFilters'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'

const { RangePicker } = DatePicker

interface OperationLog {
  id: number
  user_id: number
  action: string
  target_type: string
  target_id?: number | null
  summary: string
  detail?: Record<string, unknown> | null
  ip_address?: string | null
  created_at: string
  user?: { id: number; username: string; real_name?: string | null } | null
}

interface UserOption {
  id: number
  username: string
  real_name?: string | null
}

const actionMeta: Record<string, { label: string; color: string }> = {
  CREATE: { label: '创建', color: 'green' },
  UPDATE: { label: '更新', color: 'blue' },
  DELETE: { label: '删除', color: 'red' },
  SUBMIT: { label: '提交审核', color: 'orange' },
  APPROVE: { label: '审核通过', color: 'cyan' },
  REJECT: { label: '驳回', color: 'volcano' },
  COMPLETE: { label: '完成', color: 'purple' },
  UNAUDIT: { label: '反审核', color: 'magenta' },
  LOGIN: { label: '登录', color: 'default' },
  EXPORT: { label: '导出', color: 'gold' }
}

const targetLabels: Record<string, string> = {
  item: '物品',
  master_data: '基础资料配置',
  party: '往来单位',
  user: '用户',
  inventory: '库存',
  payment: '收付款',
  invoice: '开票',
  reconciliation: '用户对账',
  smelting_order: '冶炼单',
  outsource_order: '外协单',
  procurement_order: '采购单',
  sales_order: '销售单'
}

const actionOptions = Object.entries(actionMeta).map(([value, meta]) => ({ value, label: meta.label }))
const targetOptions = Object.entries(targetLabels).map(([value, label]) => ({ value, label }))

function formatTime(value: string) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—'
}

export function OperationLogs() {
  const [action, setAction] = useState<string | undefined>()
  const [targetType, setTargetType] = useState<string | undefined>()
  const [userId, setUserId] = useState<number | undefined>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [search, setSearch] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ action: undefined as string | undefined, targetType: undefined as string | undefined, userId: undefined as number | undefined, dateFrom: '', dateTo: '', search: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [detail, setDetail] = useState<OperationLog | null>(null)

  const logs = useQuery({
    queryKey: ['operation-logs', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<OperationLog>>('/operation-logs', {
          params: {
            page,
            page_size: pageSize,
            action: appliedFilters.action,
            target_type: appliedFilters.targetType,
            user_id: appliedFilters.userId,
            date_from: appliedFilters.dateFrom || undefined,
            date_to: appliedFilters.dateTo || undefined,
            q: appliedFilters.search || undefined
          }
        })
      ).data
  })

  const users = useQuery({
    queryKey: ['users', 'operation-log-options'],
    queryFn: async () => (await api.get<PageResult<UserOption>>('/users', { params: { page_size: 200 } })).data.items
  })

  const userOptions = (users.data ?? []).map((user) => ({
    value: user.id,
    label: user.real_name ? `${user.real_name}（${user.username}）` : user.username
  }))

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">操作日志</h1>
      </div>

      <ListFilters>
        <div className="filter-item"><span>操作类型：</span>
        <Select
          allowClear
          placeholder="操作类型"
          style={{ width: 140 }}
          value={action}
          onChange={setAction}
          options={actionOptions}
        /></div>
        <div className="filter-item"><span>对象类型：</span>
        <Select
          allowClear
          placeholder="对象类型"
          style={{ width: 150 }}
          value={targetType}
          onChange={setTargetType}
          options={targetOptions}
        /></div>
        <div className="filter-item"><span>操作人：</span>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="操作人"
          style={{ width: 200 }}
          value={userId}
          onChange={setUserId}
          options={userOptions}
        /></div>
        <div className="filter-item"><span>日期：</span>
        <RangePicker
          value={range}
          onChange={setRange}
        /></div>
        <div className="filter-item"><span>关键词：</span>
        <Input
          allowClear
          value={search}
          placeholder="搜索摘要/对象"
          style={{ width: 240 }}
          onChange={(event) => setSearch(event.target.value)}
        /></div>
        <div className="filter-actions"><Button type="primary" onClick={() => {
          setAppliedFilters({ action, targetType, userId, dateFrom: range?.[0]?.format('YYYY-MM-DD') ?? '', dateTo: range?.[1]?.format('YYYY-MM-DD') ?? '', search: search.trim() }); setPage(1)
        }}>查询</Button>
        <Button onClick={() => {
          setAction(undefined); setTargetType(undefined); setUserId(undefined); setRange(null); setSearch('')
          setAppliedFilters({ action: undefined, targetType: undefined, userId: undefined, dateFrom: '', dateTo: '', search: '' }); setPage(1)
        }}>重置</Button></div>
      </ListFilters>

      <BusinessTable<OperationLog>
        tableId="operation-logs"
        rowKey="id"
        loading={logs.isLoading}
        dataSource={logs.data?.items}
        pagination={tablePagination(logs.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 170, render: formatTime },
          {
            title: '操作',
            dataIndex: 'action',
            width: 110,
            render: (value: string) => {
              const meta = actionMeta[value] ?? { label: value, color: 'default' }
              return <Tag color={meta.color}>{meta.label}</Tag>
            }
          },
          {
            title: '对象',
            width: 160,
            render: (_, row) => `${targetLabels[row.target_type] ?? row.target_type}${row.target_id ? ` #${row.target_id}` : ''}`
          },
          { title: '摘要', dataIndex: 'summary', ellipsis: true },
          { title: '操作人', width: 150, render: (_, row) => row.user?.real_name || row.user?.username || `#${row.user_id}` },
          { title: 'IP', dataIndex: 'ip_address', width: 140, render: (value) => value || '—' },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 90,
            render: (_, row) => (
              <Button size="small" onClick={() => setDetail(row)}>
                查看
              </Button>
            )
          }
        ]}
      />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="操作详情"
        width={760}
        fields={detail ? [
          { label: '操作时间', value: formatTime(detail.created_at) },
          { label: '操作人', value: detail.user?.real_name || detail.user?.username || `#${detail.user_id}` },
          { label: '操作类型', value: actionMeta[detail.action]?.label ?? detail.action },
          { label: '对象', value: `${targetLabels[detail.target_type] ?? detail.target_type}${detail.target_id ? ` #${detail.target_id}` : ''}` },
          { label: 'IP', value: detail.ip_address || '—' },
          { label: '摘要', value: detail.summary, span: 2 },
          { label: '数据详情', value: <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(detail.detail ?? {}, null, 2)}</pre>, span: 2 }
        ] : []}
      />
    </div>
  )
}
