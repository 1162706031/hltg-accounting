import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { InventoryLineList } from '../components/InventoryLines'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import {
  countsForProcessingFee,
  InventoryStockOption,
  UNIT_OPTIONS,
  itemOptions,
  partyOptions,
  useInventoryStock,
  useItems,
  useParties
} from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'

interface OutsourceOrder {
  id: number
  batch_no: string
  party_id: number
  process_type: 'forging' | 'esr' | 'turning' | 'annealing'
  out_date?: string | null
  in_date?: string | null
  yield_rate?: string | null
  unit_price?: string | null
  tax_rate?: string | null
  total_amount?: string | null
  need_invoice: boolean
  status: OrderStatus
  notes?: string | null
  party?: { name: string } | null
  outbound_lines: any[]
  inbound_lines: any[]
}

const PROCESS_OPTIONS = [
  { value: 'forging', label: '锻造' },
  { value: 'esr', label: '电渣' },
  { value: 'turning', label: '车光' },
  { value: 'annealing', label: '退火' }
]

export function Outsource() {
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [partyId, setPartyId] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [outDateRange, setOutDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [inDateRange, setInDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [appliedFilters, setAppliedFilters] = useState({
    status: '',
    type: '',
    partyId: undefined as number | undefined,
    search: '',
    outDateFrom: '',
    outDateTo: '',
    inDateFrom: '',
    inDateTo: ''
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingStatus, setEditingStatus] = useState<OrderStatus | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [inboundSelectedRowKeys, setInboundSelectedRowKeys] = useState<number[]>([])
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()
  const stock = useInventoryStock()
  const internalPartyId = (parties.data ?? []).find((p) => p.is_internal)?.id ?? null

  const query = useQuery({
    queryKey: ['outsource', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<OutsourceOrder>>('/outsource-orders', {
          params: {
            page,
            page_size: pageSize,
            ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
            ...(appliedFilters.type ? { process_type: appliedFilters.type } : {}),
            ...(appliedFilters.partyId ? { party_id: appliedFilters.partyId } : {}),
            ...(appliedFilters.search ? { q: appliedFilters.search } : {}),
            ...(appliedFilters.outDateFrom ? { out_date_from: appliedFilters.outDateFrom } : {}),
            ...(appliedFilters.outDateTo ? { out_date_to: appliedFilters.outDateTo } : {}),
            ...(appliedFilters.inDateFrom ? { in_date_from: appliedFilters.inDateFrom } : {}),
            ...(appliedFilters.inDateTo ? { in_date_to: appliedFilters.inDateTo } : {})
          }
        })
      ).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['outsource'] })
  const onError = (e: any) => message.error(e.response?.data?.detail ?? '操作失败')

  const detailQuery = useQuery({
    queryKey: ['outsource', 'detail', detailId],
    enabled: detailId !== null,
    queryFn: async () => (await api.get<OutsourceOrder>(`/outsource-orders/${detailId}`)).data
  })

  const save = useMutation({
    mutationFn: async (values: any) => {
      const mapOut = (it: any, i: number) => ({ ...it, line_no: i + 1, out_date: it.out_date?.format('YYYY-MM-DD') ?? null })
      const mapIn = (it: any, i: number) => ({ ...it, line_no: i + 1, in_date: it.in_date?.format('YYYY-MM-DD') ?? null })
      const body = {
        ...values,
        outbound_lines: (values.outbound_lines ?? []).map(mapOut),
        inbound_lines: (values.inbound_lines ?? []).map(mapIn)
      }
      return editingId ? api.put(`/outsource-orders/${editingId}`, body) : api.post('/outsource-orders', body)
    },
    onSuccess: () => {
      message.success('已保存')
      setCreating(false)
      setEditingId(null)
      setEditingStatus(null)
      setInboundSelectedRowKeys([])
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    setEditingId(null)
    setEditingStatus(null)
    setInboundSelectedRowKeys([])
    form.resetFields()
    form.setFieldsValue({ process_type: 'forging', tax_rate: 13, need_invoice: false, outbound_lines: [], inbound_lines: [] })
  }

  const openEdit = async (row: OutsourceOrder) => {
    const d = (await api.get<OutsourceOrder>(`/outsource-orders/${row.id}`)).data
    setEditingId(row.id)
    setEditingStatus(d.status)
    setInboundSelectedRowKeys([])
    setCreating(false)
    form.setFieldsValue({
      party_id: d.party_id,
      process_type: d.process_type,
      unit_price: d.unit_price ? Number(d.unit_price) : null,
      tax_rate: d.tax_rate ? Number(d.tax_rate) : 13,
      need_invoice: d.need_invoice,
      notes: d.notes,
      outbound_lines: d.outbound_lines.map((l) => ({
        inventory_id: l.inventory_id,
        out_date: l.out_date ? dayjs(l.out_date) : null,
        item_id: l.item_id,
        spec: l.spec,
        unit: l.unit ?? '吨',
        quantity: Number(l.quantity),
        unit_price: l.unit_price ? Number(l.unit_price) : null
      })),
      inbound_lines: d.inbound_lines.map((l) => ({
        in_date: l.in_date ? dayjs(l.in_date) : null,
        item_id: l.item_id,
        owner_id: l.owner_id,
        spec: l.spec,
        quantity: Number(l.quantity),
        unit: l.unit ?? '吨',
        unit_price: l.unit_price ? Number(l.unit_price) : null
      }))
    })
  }

  const renderLines = (name: string, dateField: string, title: string) => (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div className="compact-line-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {fields.length > 0 && (
            <div className="line-list-header">
              <span className="line-select-cell">
                <Checkbox
                  checked={fields.every((field) => inboundSelectedRowKeys.includes(field.key))}
                  indeterminate={fields.some((field) => inboundSelectedRowKeys.includes(field.key)) && !fields.every((field) => inboundSelectedRowKeys.includes(field.key))}
                  onChange={(e) => setInboundSelectedRowKeys(e.target.checked ? fields.map((field) => field.key) : [])}
                />
              </span>
              <span style={{ width: 140 }}>回厂日期</span>
              <span style={{ width: 150 }}>钢种</span>
              <span style={{ width: 90 }}>规格</span>
              <span style={{ width: 90 }}>数量</span>
              <span style={{ width: 80 }}>单位</span>
              <span style={{ width: 110 }}>单价（可选）</span>
              <span style={{ width: 150 }}>归属</span>
              <span className="line-action-cell">操作</span>
            </div>
          )}
          {fields.map((field) => (
            <Space key={field.key} align="start" wrap={false} className="line-editor-row">
              <span className="line-select-cell">
                <Checkbox
                  checked={inboundSelectedRowKeys.includes(field.key)}
                  onChange={(e) => setInboundSelectedRowKeys((keys) => e.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key))}
                />
              </span>
              <Form.Item
                {...field}
                name={[field.name, dateField]}
                label="日期"
                rules={[{ required: true, message: '请选择日期' }]}
              >
                <DatePicker style={{ width: 140 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'item_id']} label="钢种">
                <ItemSelect options={itemOptions(items.data)} placeholder="钢种" style={{ width: 150 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'spec']} label="规格">
                <Input style={{ width: 90 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'quantity']} label="数量">
                <InputNumber style={{ width: 90 }} min={0} step={0.001} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'unit']} label="单位">
                <Select style={{ width: 80 }} options={UNIT_OPTIONS} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'unit_price']} label="单价(可选)">
                <InputNumber style={{ width: 110 }} min={0} placeholder="可不填" />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'owner_id']} label="归属">
                <PartySelect options={partyOptions(parties.data)} placeholder="归属单位" style={{ width: 150 }} />
              </Form.Item>
              <span className="line-action-cell">
                <MinusCircleOutlined onClick={() => {
                  remove(field.name)
                  setInboundSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                }} />
              </span>
            </Space>
          ))}
          <Space>
            <Button type="dashed" size="middle" onClick={() => add({ quantity: 0, unit: '吨' })} icon={<PlusOutlined />}>
              添加回厂
            </Button>
            <Button
              danger
              size="middle"
              disabled={inboundSelectedRowKeys.length === 0}
              onClick={() => {
                remove(fields.filter((field) => inboundSelectedRowKeys.includes(field.key)).map((field) => field.name))
                setInboundSelectedRowKeys([])
              }}
            >
              移除所选
            </Button>
          </Space>
        </div>
      )}
    </Form.List>
  )

  const stockOutLocked = editingStatus != null && editingStatus !== 'draft' && editingStatus !== 'rejected'

  const applyFilters = () => {
    setAppliedFilters({
      status: statusFilter,
      type: typeFilter,
      partyId,
      search: search.trim(),
      outDateFrom: outDateRange?.[0].format('YYYY-MM-DD') ?? '',
      outDateTo: outDateRange?.[1].format('YYYY-MM-DD') ?? '',
      inDateFrom: inDateRange?.[0].format('YYYY-MM-DD') ?? '',
      inDateTo: inDateRange?.[1].format('YYYY-MM-DD') ?? ''
    })
    setPage(1)
  }

  const resetFilters = () => {
    setStatusFilter('')
    setTypeFilter('')
    setPartyId(undefined)
    setSearch('')
    setOutDateRange(null)
    setInDateRange(null)
    setAppliedFilters({
      status: '', type: '', partyId: undefined, search: '',
      outDateFrom: '', outDateTo: '', inDateFrom: '', inDateTo: ''
    })
    setPage(1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">外协加工</h1>
        {canManage && (
          <Button type="primary" onClick={openCreate}>
            + 新建外协单
          </Button>
        )}
      </div>
      <div className="toolbar">
        <div className="filter-item">
          <span>工艺：</span>
          <Select value={typeFilter} style={{ width: 130 }} onChange={setTypeFilter} options={[{ value: '', label: '全部' }, ...PROCESS_OPTIONS]} />
        </div>
        <div className="filter-item">
          <span>状态：</span>
          <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
        </div>
        <div className="filter-item">
          <span>往来单位：</span>
          <Select
            allowClear showSearch placeholder="全部单位" value={partyId} style={{ width: 220 }}
            optionFilterProp="label" options={partyOptions(parties.data)} onChange={setPartyId}
          />
        </div>
        <div className="filter-item">
          <span>发出/出库日期：</span>
          <DatePicker.RangePicker value={outDateRange} onChange={(dates) => setOutDateRange(dates as [Dayjs, Dayjs] | null)} />
        </div>
        <div className="filter-item">
          <span>回厂/入库日期：</span>
          <DatePicker.RangePicker value={inDateRange} onChange={(dates) => setInDateRange(dates as [Dayjs, Dayjs] | null)} />
        </div>
        <div className="filter-item">
          <span>名称：</span>
          <Input allowClear value={search} placeholder="搜索批次/单位/物品/规格" style={{ width: 280 }} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </div>
      <Table<OutsourceOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        scroll={{ x: 1320 }}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '批次号',
            dataIndex: 'batch_no',
            width: 130,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>
          },
          { title: '工艺', dataIndex: 'process_type', render: (v) => PROCESS_OPTIONS.find((o) => o.value === v)?.label ?? v },
          { title: '外协厂', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          {
            title: '发出日',
            dataIndex: 'out_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          {
            title: '回厂日',
            dataIndex: 'in_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          { title: '成材率', dataIndex: 'yield_rate', render: (v) => (v ? `${(Number(v) * 100).toFixed(2)}%` : '—') },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            fixed: 'right' as const,
            width: user?.role === 'viewer' ? 80 : user?.role === 'reviewer' ? 180 : 260,
            render: (_, row) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => setDetailId(row.id)}>
                  查看
                </Button>
                <OrderActions
                  resource="outsource-orders"
                  orderId={row.id}
                  status={row.status}
                  role={user?.role}
                  invalidateKey="outsource"
                  onEdit={() => openEdit(row)}
                />
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editingId ? '编辑外协单' : '新建外协单'}
        open={creating || editingId !== null}
        width={920}
        onCancel={() => {
          setCreating(false)
          setEditingId(null)
          setEditingStatus(null)
          setInboundSelectedRowKeys([])
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="外协厂" rules={[{ required: true }]}>
              <PartySelect options={partyOptions(parties.data)} placeholder="外协厂" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="process_type" label="工艺" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={PROCESS_OPTIONS} />
            </Form.Item>
          </Space>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {' '}
            <InventoryLineList
              form={form}
              name="outbound_lines"
              title="发出（从本厂现存库存中选择，开始时扣减）"
              stock={stock.data}
              dateField="out_date"
              dateLabel="发出日期"
              dateRequired
              filter={(r: InventoryStockOption) =>
                internalPartyId != null && r.owner?.id === internalPartyId
              }
              addLabel="添加发出行"
              disabled={stockOutLocked}
              disabledReason="已扣库，禁止修改"
              allowFillAllQuantity
              compactTable
            />
            {renderLines('inbound_lines', 'in_date', '回厂（完成时按归属入库，归属留空入本厂）')}
          </div>

          <Space size="large" wrap style={{ display: 'flex', marginTop: 14 }}>
            <Form.Item name="unit_price" label="加工单价(元/吨)">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="tax_rate" label="税率(%)">
              <InputNumber min={0} max={100} />
            </Form.Item>
            <Form.Item name="need_invoice" label="需开票">
              <Select
                style={{ width: 80 }}
                options={[
                  { value: false, label: '否' },
                  { value: true, label: '是' }
                ]}
              />
            </Form.Item>
            <Form.Item label="预计合计" tooltip="发出/回厂金额 + 加工费(有效回厂量×加工单价) + 税额(仅需开票时计税)，便于核对">
              <Form.Item noStyle shouldUpdate>
                {({ getFieldsValue }) => {
                  const v = getFieldsValue()
                  const sumAmount = (lines: any[]) =>
                    (lines ?? []).reduce(
                      (s, l) => s + (l?.unit_price != null ? Number(l.quantity || 0) * Number(l.unit_price) : 0),
                      0
                    )
                  const processingQty = (v.inbound_lines ?? []).reduce(
                    (s: number, l: any) =>
                      s + (countsForProcessingFee(l?.item_id, items.data) ? Number(l?.quantity || 0) : 0),
                    0
                  )
                  const processing = v.unit_price != null ? processingQty * Number(v.unit_price) : 0
                  const subtotal = sumAmount(v.outbound_lines) + sumAmount(v.inbound_lines) + processing
                  const rate = v.need_invoice && v.tax_rate != null ? Number(v.tax_rate) : 0
                  const total = subtotal + (subtotal * rate) / 100
                  return <span style={{ fontWeight: 600, fontSize: 16 }}>¥{total.toFixed(2)}</span>
                }}
              </Form.Item>
            </Form.Item>
          </Space>

          <Form.Item name="notes" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        loading={detailQuery.isLoading}
        title={detailQuery.data ? `外协单 ${detailQuery.data.batch_no}` : '外协单详情'}
        width={860}
        fields={
          detailQuery.data
            ? [
                { label: '批次号', value: detailQuery.data.batch_no },
                {
                  label: '工艺',
                  value: PROCESS_OPTIONS.find((o) => o.value === detailQuery.data!.process_type)?.label
                },
                { label: '外协厂', value: detailQuery.data.party?.name },
                { label: '发出日期', value: detailQuery.data.out_date },
                { label: '回厂日期', value: detailQuery.data.in_date },
                {
                  label: '成材率',
                  value:
                    detailQuery.data.yield_rate != null
                      ? `${(Number(detailQuery.data.yield_rate) * 100).toFixed(2)}%`
                      : '—'
                },
                { label: '加工单价', value: detailQuery.data.unit_price },
                { label: '税率', value: detailQuery.data.tax_rate != null ? `${detailQuery.data.tax_rate}%` : '—' },
                { label: '是否开票', value: detailQuery.data.need_invoice ? '是' : '否' },
                { label: '合计', value: detailQuery.data.total_amount },
                { label: '状态', value: <OrderStatusTag status={detailQuery.data.status} /> },
                { label: '备注', value: detailQuery.data.notes, span: 2 }
              ]
            : []
        }
        tables={
          detailQuery.data
            ? [
                {
                  title: '发出',
                  rowKey: 'id',
                  dataSource: detailQuery.data.outbound_lines ?? [],
                  columns: outboundLineColumns
                },
                {
                  title: '回厂',
                  rowKey: 'id',
                  dataSource: detailQuery.data.inbound_lines ?? [],
                  columns: inboundLineColumns
                }
              ]
            : []
        }
      />
    </div>
  )
}

const commonOutsourceLineColumns = [
  { title: '钢种', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: any) => v ?? '—' }
]

const outboundLineColumns = [
  { title: '发出日期', dataIndex: 'out_date', render: (v: string) => v ?? '—' },
  ...commonOutsourceLineColumns
]

const inboundLineColumns = [
  { title: '回厂日期', dataIndex: 'in_date', render: (v: string) => v ?? '—' },
  ...commonOutsourceLineColumns
]
