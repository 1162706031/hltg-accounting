import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { ItemOption, PartyOption, UNIT_OPTIONS, itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'

interface InventoryRow {
  id: number
  item_id: number | null
  spec: string | null
  unit: string
  owner_id: number
  current_quantity: string
  notes?: string | null
  item?: { id: number; name: string; item_type: string } | null
  owner?: { id: number; name: string } | null
}

const itemTypeLabels: Record<string, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}
const itemTypeColors: Record<string, string> = {
  steel_grade: 'blue',
  raw_material: 'default',
  alloy: 'orange',
  finished_product: 'green',
  semi_finished: 'cyan',
  scrap: 'red'
}

interface InForm {
  item_id: number
  owner_id: number
  spec?: string
  unit: string
  quantity: number
  change_date: Dayjs
  notes?: string
}

export function Inventory() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const [typeFilter, setTypeFilter] = useState<string | undefined>()
  const [ownerFilter, setOwnerFilter] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<number[]>([])
  const [inOpen, setInOpen] = useState(false)
  const [outTarget, setOutTarget] = useState<InventoryRow | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null)
  const [detail, setDetail] = useState<InventoryRow | null>(null)

  const partiesQ = useParties()
  const partyList: PartyOption[] = partiesQ.data ?? []
  const partyOpts = partyOptions(partyList)

  const itemsQ = useItems()
  const itemList: ItemOption[] = itemsQ.data ?? []
  const itemOpts = itemOptions(itemList)

  const list = useQuery({
    queryKey: ['inventory', typeFilter, ownerFilter, search, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<InventoryRow>>('/inventory', {
          params: {
            page,
            page_size: pageSize,
            item_type: typeFilter,
            owner_id: ownerFilter,
            q: search || undefined
          }
        })
      ).data
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory'] })

  const stockInMut = useMutation({
    mutationFn: async (v: InForm) =>
      (
        await api.post('/inventory/in', {
          ...v,
          change_date: v.change_date.format('YYYY-MM-DD')
        })
      ).data,
    onSuccess: () => {
      message.success('入库成功')
      setInOpen(false)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '入库失败')
  })

  const stockOutMut = useMutation({
    mutationFn: async ({ id, ...v }: { id: number; quantity: number; change_date: Dayjs; notes?: string }) =>
      (
        await api.post(`/inventory/${id}/out`, {
          ...v,
          change_date: v.change_date.format('YYYY-MM-DD')
        })
      ).data,
    onSuccess: () => {
      message.success('出库成功')
      setOutTarget(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '出库失败')
  })

  const adjustMut = useMutation({
    mutationFn: async ({ id, ...v }: { id: number; actual_quantity: number; change_date: Dayjs; notes?: string }) =>
      (
        await api.post(`/inventory/${id}/adjust`, {
          ...v,
          change_date: v.change_date.format('YYYY-MM-DD')
        })
      ).data,
    onSuccess: () => {
      message.success('盘点调整成功')
      setAdjustTarget(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '调整失败')
  })

  const batchDeleteMut = useMutation({
    mutationFn: async (ids: number[]) => (await api.post('/inventory/batch-delete', { ids })).data,
    onSuccess: (data: { deleted_count: number; skipped: { id: number; reason: string }[] }) => {
      if (data.skipped?.length) {
        message.warning(`已删除 ${data.deleted_count} 条，跳过 ${data.skipped.length} 条（库存非空）`)
      } else {
        message.success(`已删除 ${data.deleted_count} 条`)
      }
      setSelected([])
      invalidate()
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '批量删除失败')
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">库房管理</h1>
        {canManage && (
          <Space>
            <Button type="primary" onClick={() => setInOpen(true)}>
              + 入库
            </Button>
            <Button danger disabled={!selected.length} onClick={() => batchDeleteMut.mutate(selected)}>
              批量删除
            </Button>
          </Space>
        )}
      </div>
      <div className="toolbar">
        <Select
          allowClear
          placeholder="类型筛选"
          style={{ width: 140 }}
          value={typeFilter}
          onChange={(v) => {
            setTypeFilter(v)
            setPage(1)
          }}
          options={Object.entries(itemTypeLabels).map(([v, l]) => ({ value: v, label: l }))}
        />
        <Select
          allowClear
          placeholder="归属筛选"
          style={{ width: 180 }}
          value={ownerFilter}
          onChange={(v) => {
            setOwnerFilter(v)
            setPage(1)
          }}
          options={partyOpts}
          showSearch
          optionFilterProp="label"
        />
        <Input.Search
          placeholder="搜索物品/规格"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => {
            setSearch(v)
            setPage(1)
          }}
          onChange={(e) => {
            if (!e.target.value) {
              setSearch('')
              setPage(1)
            }
          }}
        />
      </div>
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items}
        pagination={tablePagination(list.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as number[])
              }
            : undefined
        }
        columns={[
          {
            title: '类型',
            width: 90,
            render: (_, row) =>
              row.item ? (
                <Tag color={itemTypeColors[row.item.item_type] ?? 'default'}>
                  {itemTypeLabels[row.item.item_type] ?? row.item.item_type}
                </Tag>
              ) : (
                '-'
              )
          },
          { title: '物品', render: (_, row) => row.item?.name ?? '-' },
          { title: '规格', dataIndex: 'spec' },
          { title: '归属', render: (_, row) => row.owner?.name ?? '-' },
          { title: '数量', dataIndex: 'current_quantity' },
          { title: '单位', dataIndex: 'unit', width: 70 },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            width: 260,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                {canManage && (
                  <>
                    <Button
                      size="small"
                      onClick={() => setOutTarget(row)}
                      disabled={Number(row.current_quantity) === 0}
                    >
                      出库
                    </Button>
                    <Button size="small" onClick={() => setAdjustTarget(row)}>
                      盘点调整
                    </Button>
                  </>
                )}
              </Space>
            )
          }
        ]}
      />

      <Modal
        title="入库"
        open={inOpen}
        onCancel={() => setInOpen(false)}
        okText="确认入库"
        onOk={() => stockInMut.mutateAsync}
        confirmLoading={stockInMut.isPending}
        destroyOnClose
        width={520}
        footer={null}
      >
        <InFormModal
          partyOpts={partyOpts}
          itemOpts={itemOpts}
          onSubmit={(v) => stockInMut.mutate(v)}
          submitting={stockInMut.isPending}
        />
      </Modal>

      <OutAdjustModal
        key={outTarget ? `out-${outTarget.id}` : 'out-empty'}
        target={outTarget}
        kind="out"
        onClose={() => setOutTarget(null)}
        onSubmit={(v) => stockOutMut.mutate({ id: outTarget!.id, ...v })}
        submitting={stockOutMut.isPending}
      />
      <OutAdjustModal
        key={adjustTarget ? `adjust-${adjustTarget.id}` : 'adjust-empty'}
        target={adjustTarget}
        kind="adjust"
        onClose={() => setAdjustTarget(null)}
        onSubmit={(v) =>
          adjustMut.mutate({
            id: adjustTarget!.id,
            actual_quantity: v.actual_quantity as number,
            change_date: v.change_date,
            notes: v.notes
          })
        }
        submitting={adjustMut.isPending}
      />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `库存 ${detail.item?.name ?? ''}` : ''}
        fields={
          detail
            ? [
                {
                  label: '类型',
                  value: detail.item ? itemTypeLabels[detail.item.item_type] ?? detail.item.item_type : '—'
                },
                { label: '物品', value: detail.item?.name },
                { label: '规格', value: detail.spec },
                { label: '归属', value: detail.owner?.name },
                { label: '数量', value: detail.current_quantity },
                { label: '单位', value: detail.unit },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}

function InFormModal({
  partyOpts,
  itemOpts,
  onSubmit,
  submitting
}: {
  partyOpts: { value: number; label: string }[]
  itemOpts: { value: number; label: string }[]
  onSubmit: (v: InForm) => void
  submitting: boolean
}) {
  const [form] = Form.useForm<InForm>()
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ unit: '吨', quantity: 0, change_date: dayjs() }}
      onFinish={(v) => onSubmit(v)}
    >
      <Form.Item name="item_id" label="物品" rules={[{ required: true, message: '请选择物品' }]}>
        <ItemSelect options={itemOpts} />
      </Form.Item>
      <Form.Item name="owner_id" label="归属" rules={[{ required: true }]}>
        <PartySelect options={partyOpts} />
      </Form.Item>
      <Form.Item name="spec" label="规格">
        <Input />
      </Form.Item>
      <Space>
        <Form.Item name="unit" label="单位" rules={[{ required: true }]}>
          <Select options={UNIT_OPTIONS} style={{ width: 120 }} placeholder="选择单位" />
        </Form.Item>
        <Form.Item name="quantity" label="入库数量" rules={[{ required: true }]}>
          <InputNumber min={0} step={0.001} style={{ width: 160 }} />
        </Form.Item>
      </Space>
      <Form.Item name="change_date" label="入库日期" rules={[{ required: true }]}>
        <DatePicker style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="notes" label="备注">
        <Input.TextArea rows={2} />
      </Form.Item>
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button htmlType="submit" type="primary" loading={submitting}>
            确认入库
          </Button>
        </Space>
      </div>
    </Form>
  )
}

function OutAdjustModal({
  target,
  kind,
  onClose,
  onSubmit,
  submitting
}: {
  target: InventoryRow | null
  kind: 'out' | 'adjust'
  onClose: () => void
  onSubmit: (v: any) => void
  submitting: boolean
}) {
  const [form] = Form.useForm()
  if (!target) return null
  const isAdjust = kind === 'adjust'
  return (
    <Modal
      title={isAdjust ? `盘点调整 — ${target.item?.name ?? ''}` : `出库 — ${target.item?.name ?? ''}`}
      open={!!target}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={480}
    >
      <div style={{ background: '#f5f7fb', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
        当前库存：<b>{target.current_quantity}</b> {target.unit} · 归属：
        {target.owner?.name ?? '-'}
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={
          isAdjust
            ? { change_date: dayjs(), actual_quantity: Number(target.current_quantity) }
            : { change_date: dayjs(), quantity: 0 }
        }
        onFinish={onSubmit}
      >
        {isAdjust ? (
          <Form.Item name="actual_quantity" label={`实际数量（${target.unit}）`}>
            <InputNumber min={0} step={0.001} style={{ width: 200 }} />
          </Form.Item>
        ) : (
          <Form.Item name="quantity" label={`出库数量（≤ ${target.current_quantity} ${target.unit}）`}>
            <InputNumber min={0} max={Number(target.current_quantity)} step={0.001} style={{ width: 240 }} />
          </Form.Item>
        )}
        <Form.Item name="change_date" label={isAdjust ? '盘点日期' : '出库日期'} rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {isAdjust ? '确认调整' : '确认出库'}
            </Button>
          </Space>
        </div>
      </Form>
    </Modal>
  )
}
