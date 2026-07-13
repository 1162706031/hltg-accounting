import { useQuery } from '@tanstack/react-query'
import { Button, DatePicker, Input, Select, Space, Table, Tag } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'

interface InventoryLog {
  id: number
  inventory_id: number
  change_type: 'in' | 'out' | 'adjust' | 'init' | 'delete'
  change_date: string
  unit?: string
  delta_quantity: string
  before_quantity: string
  after_quantity: string
  ref_type?: string | null
  ref_id?: number | null
  notes?: string | null
  created_by?: number | null
  created_at: string
  item_name?: string | null
  item_spec?: string | null
  item_type?: string | null
  owner_name?: string | null
  operator_name?: string | null
  order_type_label?: string | null
  batch_no?: string | null
  business_remark?: string | null
}

const colors: Record<InventoryLog['change_type'], string> = { in: 'green', out: 'red', adjust: 'orange', init: 'default', delete: 'volcano' }
const labels: Record<InventoryLog['change_type'], string> = { in: '入库', out: '出库', adjust: '调整', init: '初始', delete: '删除' }

const itemTypeLabels: Record<string, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}

export function InventoryLogs() {
  const [changeType, setChangeType] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [q, setQ] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ changeType: undefined as string | undefined, dateFrom: '', dateTo: '', q: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const query = useQuery({
    queryKey: ['inventory-logs', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<InventoryLog>>('/inventory/logs', {
          params: {
            page,
            page_size: pageSize,
            change_type: appliedFilters.changeType,
            date_from: appliedFilters.dateFrom || undefined,
            date_to: appliedFilters.dateTo || undefined,
            q: appliedFilters.q || undefined
          }
        })
      ).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">库存变动记录</h1>
      </div>
      <Space wrap>
        <Select
          allowClear
          placeholder="变动类型"
          style={{ width: 140 }}
          value={changeType}
          onChange={setChangeType}
          options={[
            { value: 'in', label: '入库' },
            { value: 'out', label: '出库' },
            { value: 'adjust', label: '调整' },
            { value: 'init', label: '初始' },
            { value: 'delete', label: '删除' }
          ]}
        />
        <DatePicker.RangePicker
          value={range as [Dayjs, Dayjs] | null}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
        />
        <Input
          allowClear
          value={q}
          placeholder="物品 / 规格 / 批次号 / 备注"
          style={{ width: 260 }}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="primary" onClick={() => {
          setAppliedFilters({ changeType, dateFrom: range?.[0].format('YYYY-MM-DD') ?? '', dateTo: range?.[1].format('YYYY-MM-DD') ?? '', q: q.trim() })
          setPage(1)
        }}>查询</Button>
        <Button onClick={() => {
          setChangeType(undefined); setRange(null); setQ('')
          setAppliedFilters({ changeType: undefined, dateFrom: '', dateTo: '', q: '' }); setPage(1)
        }}>重置</Button>
      </Space>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        size="small"
        scroll={{ x: 1480 }}
        columns={[
          { title: '日期', dataIndex: 'change_date', width: 110 },
          {
            title: '类型',
            dataIndex: 'change_type',
            width: 80,
            render: (v: InventoryLog['change_type']) => <Tag color={colors[v]}>{labels[v]}</Tag>
          },
          { title: '物品', dataIndex: 'item_name', width: 140, render: (v) => v ?? '—' },
          { title: '规格', dataIndex: 'item_spec', width: 120, render: (v) => v ?? '—' },
          {
            title: '物品类型',
            dataIndex: 'item_type',
            width: 90,
            render: (v?: string) => (v ? <Tag>{itemTypeLabels[v] ?? v}</Tag> : '—')
          },
          { title: '归属', dataIndex: 'owner_name', width: 120, render: (v) => v ?? '—' },
          {
            title: '订单类型',
            dataIndex: 'order_type_label',
            width: 90,
            render: (v?: string | null) => v ? <Tag color="blue">{v}</Tag> : '—'
          },
          {
            title: '批次号',
            dataIndex: 'batch_no',
            width: 140,
            render: (v?: string | null) => v ? <span style={{ whiteSpace: 'nowrap' }}>{v}</span> : '—'
          },
          {
            title: 'Δ 数量',
            dataIndex: 'delta_quantity',
            width: 110,
            align: 'right',
            render: (v: string) => (Number(v) ? <span style={{ color: Number(v) > 0 ? '#389e0d' : '#cf1322' }}>{Number(v) > 0 ? `+${v}` : v}</span> : '—')
          },
          { title: '单位', dataIndex: 'unit', width: 70, render: (v) => v ?? '—' },
          { title: '前 → 后', key: 'after', width: 150, render: (_, row) => `${row.before_quantity} → ${row.after_quantity}` },
          { title: '操作人', dataIndex: 'operator_name', width: 100, render: (v) => v ?? '—' },
          {
            title: '备注',
            dataIndex: 'business_remark',
            width: 220,
            ellipsis: true,
            render: (v?: string | null) => v ?? '—'
          }
        ]}
      />
    </div>
  )
}
