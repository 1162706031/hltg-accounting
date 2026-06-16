import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Modal, Select, Space, Table, Tag } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [detail, setDetail] = useState<OperationLog | null>(null)

  const logs = useQuery({
    queryKey: ['operation-logs', action, targetType, userId, range?.[0]?.format('YYYY-MM-DD'), range?.[1]?.format('YYYY-MM-DD'), search, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<OperationLog>>('/operation-logs', {
          params: {
            page,
            page_size: pageSize,
            action,
            target_type: targetType,
            user_id: userId,
            date_from: range?.[0]?.format('YYYY-MM-DD'),
            date_to: range?.[1]?.format('YYYY-MM-DD'),
            q: search || undefined
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

      <Space wrap className="toolbar">
        <Select
          allowClear
          placeholder="操作类型"
          style={{ width: 140 }}
          value={action}
          onChange={(value) => {
            setAction(value)
            setPage(1)
          }}
          options={actionOptions}
        />
        <Select
          allowClear
          placeholder="对象类型"
          style={{ width: 150 }}
          value={targetType}
          onChange={(value) => {
            setTargetType(value)
            setPage(1)
          }}
          options={targetOptions}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="操作人"
          style={{ width: 200 }}
          value={userId}
          onChange={(value) => {
            setUserId(value)
            setPage(1)
          }}
          options={userOptions}
        />
        <RangePicker
          value={range}
          onChange={(value) => {
            setRange(value)
            setPage(1)
          }}
        />
        <Input.Search
          allowClear
          placeholder="搜索摘要/对象"
          style={{ width: 240 }}
          onSearch={(value) => {
            setSearch(value)
            setPage(1)
          }}
          onChange={(event) => {
            if (!event.target.value) {
              setSearch('')
              setPage(1)
            }
          }}
        />
      </Space>

      <Table<OperationLog>
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
            title: '详情',
            width: 90,
            render: (_, row) => (
              <Button size="small" onClick={() => setDetail(row)}>
                查看
              </Button>
            )
          }
        ]}
      />

      <Modal
        title="操作详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
        destroyOnClose
      >
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 520, overflow: 'auto' }}>
          {detail ? JSON.stringify(detail.detail ?? {}, null, 2) : ''}
        </pre>
      </Modal>
    </div>
  )
}
