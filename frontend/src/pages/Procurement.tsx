import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { UNIT_OPTIONS, itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'

interface ProcurementOrder {
  id: number
  batch_no: string
  party_id: number
  owner_id: number
  purchase_date?: string | null
  item_id?: number | null
  item_spec?: string | null
  quantity: string
  unit: string
  unit_price: string
  amount: string
  tax_rate?: string | null
  total_amount?: string | null
  need_invoice: boolean
  status: OrderStatus
  notes?: string | null
  party?: { name: string } | null
  item?: { id: number; name: string; item_type: string } | null
}

export function Procurement() {
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [partyId, setPartyId] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [purchaseDateRange, setPurchaseDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [appliedFilters, setAppliedFilters] = useState({
    status: '',
    partyId: undefined as number | undefined,
    search: '',
    purchaseDateFrom: '',
    purchaseDateTo: ''
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editing, setEditing] = useState<ProcurementOrder | null>(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<ProcurementOrder | null>(null)
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()

  const query = useQuery({
    queryKey: ['procurement', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<ProcurementOrder>>('/procurement-orders', {
          params: {
            page,
            page_size: pageSize,
            ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
            ...(appliedFilters.partyId ? { party_id: appliedFilters.partyId } : {}),
            ...(appliedFilters.search ? { q: appliedFilters.search } : {}),
            ...(appliedFilters.purchaseDateFrom ? { purchase_date_from: appliedFilters.purchaseDateFrom } : {}),
            ...(appliedFilters.purchaseDateTo ? { purchase_date_to: appliedFilters.purchaseDateTo } : {})
          }
        })
      ).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['procurement'] })
  const onError = (e: any) => message.error(e.response?.data?.detail ?? '操作失败')

  const save = useMutation({
    mutationFn: async (values: any) => {
      const body = { ...values, purchase_date: values.purchase_date?.format('YYYY-MM-DD') ?? null }
      return editing ? api.put(`/procurement-orders/${editing.id}`, body) : api.post('/procurement-orders', body)
    },
    onSuccess: () => {
      message.success('已保存')
      setCreating(false)
      setEditing(null)
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ unit: '吨', tax_rate: 13, quantity: 0, unit_price: 0, need_invoice: false })
  }

  const openEdit = (row: ProcurementOrder) => {
    setEditing(row)
    setCreating(false)
    form.setFieldsValue({
      party_id: row.party_id,
      purchase_date: row.purchase_date ? dayjs(row.purchase_date) : null,
      item_id: row.item_id,
      item_spec: row.item_spec,
      quantity: Number(row.quantity),
      unit: row.unit,
      unit_price: Number(row.unit_price),
      tax_rate: row.tax_rate ? Number(row.tax_rate) : 13,
      need_invoice: row.need_invoice,
      notes: row.notes
    })
  }

  const applyFilters = () => {
    setAppliedFilters({
      status: statusFilter,
      partyId,
      search: search.trim(),
      purchaseDateFrom: purchaseDateRange?.[0].format('YYYY-MM-DD') ?? '',
      purchaseDateTo: purchaseDateRange?.[1].format('YYYY-MM-DD') ?? ''
    })
    setPage(1)
  }

  const resetFilters = () => {
    setStatusFilter('')
    setPartyId(undefined)
    setSearch('')
    setPurchaseDateRange(null)
    setAppliedFilters({ status: '', partyId: undefined, search: '', purchaseDateFrom: '', purchaseDateTo: '' })
    setPage(1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">采购管理</h1>
        {canManage && (
          <Button type="primary" onClick={openCreate}>
            + 新建采购单
          </Button>
        )}
      </div>
      <div className="toolbar">
        <div className="filter-item">
          <span>状态：</span>
          <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
        </div>
        <div className="filter-item">
          <span>往来单位：</span>
          <Select
            allowClear
            showSearch
            placeholder="全部单位"
            value={partyId}
            style={{ width: 220 }}
            optionFilterProp="label"
            options={partyOptions(parties.data)}
            onChange={setPartyId}
          />
        </div>
        <div className="filter-item">
          <span>采购/入库日期：</span>
          <DatePicker.RangePicker
            value={purchaseDateRange}
            onChange={(dates) => setPurchaseDateRange(dates as [Dayjs, Dayjs] | null)}
          />
        </div>
        <div className="filter-item">
          <span>名称：</span>
          <Input
            allowClear
            value={search}
            placeholder="搜索批次/供应商/物品/规格"
            style={{ width: 280 }}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </div>
      <Table<ProcurementOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        scroll={{ x: 1450 }}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '批次号',
            dataIndex: 'batch_no',
            width: 130,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>
          },
          { title: '供应商', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          { title: '物品', dataIndex: ['item', 'name'], render: (v) => v ?? '—' },
          {
            title: '采购日期',
            dataIndex: 'purchase_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          { title: '数量', dataIndex: 'quantity', align: 'right' },
          { title: '单位', dataIndex: 'unit' },
          { title: '单价', dataIndex: 'unit_price', align: 'right' },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            fixed: 'right' as const,
            width: user?.role === 'viewer' ? 80 : user?.role === 'reviewer' ? 180 : 260,
            render: (_, row) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                <OrderActions
                  resource="procurement-orders"
                  orderId={row.id}
                  status={row.status}
                  role={user?.role}
                  invalidateKey="procurement"
                  onEdit={() => openEdit(row)}
                />
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editing ? `编辑采购单 ${editing.batch_no}` : '新建采购单'}
        open={creating || !!editing}
        width={640}
        onCancel={() => {
          setCreating(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="party_id" label="供应商" rules={[{ required: true }]}>
            <PartySelect options={partyOptions(parties.data)} placeholder="选择供应商" />
          </Form.Item>
          <Form.Item name="purchase_date" label="采购日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="item_id" label="物品">
            <ItemSelect options={itemOptions(items.data)} />
          </Form.Item>
          <Form.Item name="item_spec" label="规格/品位">
            <Input placeholder="如 59.6%" />
          </Form.Item>
          <Form.Item name="quantity" label="数量" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Select options={UNIT_OPTIONS} style={{ width: '100%' }} placeholder="选择单位" />
          </Form.Item>
          <Form.Item name="unit_price" label="单价" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="need_invoice" label="是否需要开票">
            <Select
              options={[
                { value: false, label: '否' },
                { value: true, label: '是' }
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.need_invoice !== cur.need_invoice}
          >
            {({ getFieldValue }) => (
              <Form.Item name="tax_rate" label="税率(%)" tooltip="不开票时不计税">
                <InputNumber
                  min={0}
                  max={100}
                  style={{ width: '100%' }}
                  disabled={!getFieldValue('need_invoice')}
                />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `采购单 ${detail.batch_no}` : ''}
        fields={
          detail
            ? [
                { label: '批次号', value: detail.batch_no },
                { label: '供应商', value: detail.party?.name },
                { label: '物品', value: detail.item?.name },
                { label: '规格/品位', value: detail.item_spec },
                { label: '采购日期', value: detail.purchase_date },
                { label: '数量', value: `${detail.quantity} ${detail.unit}` },
                { label: '单价', value: detail.unit_price },
                { label: '金额', value: detail.amount },
                { label: '税率', value: detail.tax_rate != null ? `${detail.tax_rate}%` : '—' },
                { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
                { label: '合计', value: detail.total_amount },
                { label: '状态', value: <OrderStatusTag status={detail.status} /> },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
