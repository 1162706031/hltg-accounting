import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { InventoryLineList } from '../components/InventoryLines'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import {
  InventoryStockOption,
  UNIT_OPTIONS,
  itemOptions,
  partyOptions,
  useInventoryStock,
  useItems,
  useParties
} from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'

interface SmeltingOrder {
  id: number
  batch_no: string
  party_id: number
  order_type: 'ext_smelting' | 'inhouse'
  feed_date?: string | null
  tap_date?: string | null
  yield_pct?: string | null
  unit_price?: string | null
  tax_rate?: string | null
  total_amount?: string | null
  need_invoice: boolean
  status: OrderStatus
  notes?: string | null
  party?: { name: string } | null
  inbound_lines: any[]
  alloy_lines: any[]
}

const ORDER_TYPE_OPTIONS = [
  { value: 'ext_smelting', label: '外来冶炼' },
  { value: 'inhouse', label: '本厂冶炼' }
]

export function Smelting() {
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()
  const stock = useInventoryStock()
  const internalPartyId = (parties.data ?? []).find((p) => p.is_internal)?.id ?? null

  const query = useQuery({
    queryKey: ['smelting', statusFilter, typeFilter],
    queryFn: async () =>
      (
        await api.get<PageResult<SmeltingOrder>>('/smelting-orders', {
          params: {
            page_size: 100,
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(typeFilter ? { order_type: typeFilter } : {})
          }
        })
      ).data
  })

  const detailQuery = useQuery({
    queryKey: ['smelting', 'detail', detailId],
    enabled: detailId !== null,
    queryFn: async () => (await api.get<SmeltingOrder>(`/smelting-orders/${detailId}`)).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['smelting'] })
  const onError = (e: any) => message.error(e.response?.data?.detail ?? '操作失败')

  const save = useMutation({
    mutationFn: async (values: any) => {
      const mapLine = (it: any, idx: number, side?: string) => ({
        ...it,
        line_no: idx + 1,
        date: it.date?.format('YYYY-MM-DD') ?? null,
        ...(side ? { side } : {})
      })
      const body = {
        ...values,
        feed_date: values.feed_date?.format('YYYY-MM-DD') ?? null,
        tap_date: values.tap_date?.format('YYYY-MM-DD') ?? null,
        inbound_lines: [
          ...(values.feed_lines ?? []).map((it: any, i: number) => mapLine(it, i, 'in')),
          ...(values.tap_lines ?? []).map((it: any, i: number) => mapLine(it, i, 'out'))
        ],
        alloy_lines: (values.alloy_lines ?? []).map((it: any) => ({
          ...it,
          date: it.date?.format('YYYY-MM-DD') ?? null
        }))
      }
      delete body.feed_lines
      delete body.tap_lines
      return editingId ? api.put(`/smelting-orders/${editingId}`, body) : api.post('/smelting-orders', body)
    },
    onSuccess: () => {
      message.success('已保存')
      setCreating(false)
      setEditingId(null)
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({ order_type: 'ext_smelting', tax_rate: 13, need_invoice: false, feed_lines: [], tap_lines: [], alloy_lines: [] })
  }

  const openEdit = async (row: SmeltingOrder) => {
    const d = (await api.get<SmeltingOrder>(`/smelting-orders/${row.id}`)).data
    setEditingId(row.id)
    setCreating(false)
    const toTapLine = (it: any) => ({
      date: it.date ? dayjs(it.date) : null,
      item_id: it.item_id,
      quantity: Number(it.quantity),
      unit: it.unit ?? '吨',
      spec: it.spec,
      furnace_no: it.furnace_no,
      owner_id: it.owner_id,
      unit_price: it.unit_price ? Number(it.unit_price) : null
    })
    const toInvLine = (it: any) => ({
      inventory_id: it.inventory_id,
      date: it.date ? dayjs(it.date) : null,
      item_id: it.item_id,
      spec: it.spec,
      unit: it.unit ?? '吨',
      owner_id: it.owner_id,
      quantity: Number(it.quantity),
      unit_price: it.unit_price ? Number(it.unit_price) : null
    })
    form.setFieldsValue({
      party_id: d.party_id,
      order_type: d.order_type,
      feed_date: d.feed_date ? dayjs(d.feed_date) : null,
      tap_date: d.tap_date ? dayjs(d.tap_date) : null,
      unit_price: d.unit_price ? Number(d.unit_price) : null,
      tax_rate: d.tax_rate ? Number(d.tax_rate) : 13,
      need_invoice: d.need_invoice,
      notes: d.notes,
      feed_lines: d.inbound_lines.filter((l) => l.side === 'in').map(toInvLine),
      tap_lines: d.inbound_lines.filter((l) => l.side === 'out').map(toTapLine),
      alloy_lines: d.alloy_lines.map((a) => ({
        inventory_id: a.inventory_id,
        date: a.date ? dayjs(a.date) : null,
        item_id: a.item_id,
        spec: a.spec,
        quantity: Number(a.quantity),
        unit: a.unit ?? '千克',
        unit_price: a.unit_price ? Number(a.unit_price) : null,
        notes: a.notes
      }))
    })
  }

  /** 出钢/出料明细：钢种与归属支持快速新建（QuickCreate）。 */
  const renderTapLines = () => (
    <Form.List name="tap_lines">
      {(fields, { add, remove }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>出钢 / 出料（归属决定入库单位）</div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" wrap>
              <Form.Item {...field} name={[field.name, 'date']} label="出钢日期">
                <DatePicker style={{ width: 140 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'item_id']} label="钢种" rules={[{ required: true }]}>
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
              <Form.Item {...field} name={[field.name, 'furnace_no']} label="炉号">
                <Input style={{ width: 90 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'owner_id']} label="归属">
                <PartySelect options={partyOptions(parties.data)} placeholder="归属单位" style={{ width: 150 }} />
              </Form.Item>
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Button type="dashed" size="small" onClick={() => add({ quantity: 0, unit: '吨', date: form.getFieldValue('tap_date') ?? null })} icon={<PlusOutlined />}>
            添加行
          </Button>
        </div>
      )}
    </Form.List>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">冶炼加工</h1>
        <Button type="primary" onClick={openCreate}>
          + 新建冶炼单
        </Button>
      </div>
      <div className="toolbar">
        <span>类型：</span>
        <Select value={typeFilter} style={{ width: 130 }} onChange={setTypeFilter} options={[{ value: '', label: '全部' }, ...ORDER_TYPE_OPTIONS]} />
        <span>状态：</span>
        <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
      </div>
      <Table<SmeltingOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: '批次号', dataIndex: 'batch_no' },
          {
            title: '类型',
            dataIndex: 'order_type',
            render: (v) => ORDER_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
          },
          { title: '单位', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          { title: '投料日', dataIndex: 'feed_date', render: (v) => v ?? '—' },
          { title: '成锭率%', dataIndex: 'yield_pct', render: (v) => v ?? '—' },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            width: 340,
            render: (_, row) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => setDetailId(row.id)}>
                  查看
                </Button>
                <OrderActions
                  resource="smelting-orders"
                  orderId={row.id}
                  status={row.status}
                  role={user?.role}
                  invalidateKey="smelting"
                  onEdit={() => openEdit(row)}
                />
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editingId ? '编辑冶炼单' : '新建冶炼单'}
        open={creating || editingId !== null}
        width={960}
        onCancel={() => {
          setCreating(false)
          setEditingId(null)
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="业务单位" rules={[{ required: true }]}>
              <Select style={{ width: 200 }} showSearch optionFilterProp="label" options={partyOptions(parties.data)} />
            </Form.Item>
            <Form.Item name="order_type" label="类型" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={ORDER_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="feed_date" label="投料日期">
              <DatePicker />
            </Form.Item>
            <Form.Item name="tap_date" label="出钢日期">
              <DatePicker />
            </Form.Item>
          </Space>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <InventoryLineList
              form={form}
              name="feed_lines"
              title="来料 / 投料（从现存库存中选择）"
              stock={stock.data}
              dateField="date"
              dateLabel="来料日期"
              defaultDateField="feed_date"
              addLabel="添加来料"
            />
            {renderTapLines()}
            <InventoryLineList
              form={form}
              name="alloy_lines"
              title="补加合金（从本厂现存合金库存中选择）"
              stock={stock.data}
              dateField="date"
              dateLabel="补加日期"
              defaultDateField="feed_date"
              filter={(r: InventoryStockOption) =>
                r.item?.item_type === 'alloy' &&
                internalPartyId != null &&
                r.owner?.id === internalPartyId
              }
              addLabel="添加合金"
              selectWidth={280}
            />
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
            <Form.Item label="预计合计" tooltip="来料/出钢/合金金额 + 加工费(出钢量×加工单价) + 税额(仅需开票时计税)，便于核对">
              <Form.Item noStyle shouldUpdate>
                {({ getFieldsValue }) => {
                  const v = getFieldsValue()
                  const sumAmount = (lines: any[]) =>
                    (lines ?? []).reduce(
                      (s, l) => s + (l?.unit_price != null ? Number(l.quantity || 0) * Number(l.unit_price) : 0),
                      0
                    )
                  const tapQty = (v.tap_lines ?? []).reduce((s: number, l: any) => s + Number(l?.quantity || 0), 0)
                  const processing = v.unit_price != null ? tapQty * Number(v.unit_price) : 0
                  const subtotal =
                    sumAmount(v.feed_lines) + sumAmount(v.tap_lines) + sumAmount(v.alloy_lines) + processing
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
        title={detailQuery.data ? `冶炼单 ${detailQuery.data.batch_no}` : '冶炼单详情'}
        width={860}
        fields={
          detailQuery.data
            ? [
                { label: '批次号', value: detailQuery.data.batch_no },
                {
                  label: '类型',
                  value: ORDER_TYPE_OPTIONS.find((o) => o.value === detailQuery.data!.order_type)?.label
                },
                { label: '单位', value: detailQuery.data.party?.name },
                { label: '投料日', value: detailQuery.data.feed_date },
                { label: '出钢日', value: detailQuery.data.tap_date },
                { label: '成锭率', value: detailQuery.data.yield_pct != null ? `${detailQuery.data.yield_pct}%` : '—' },
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
                  title: '投料',
                  rowKey: 'id',
                  dataSource: (detailQuery.data.inbound_lines ?? []).filter((l: any) => l.side === 'in'),
                  columns: steelLineColumns
                },
                {
                  title: '出钢',
                  rowKey: 'id',
                  dataSource: (detailQuery.data.inbound_lines ?? []).filter((l: any) => l.side === 'out'),
                  columns: steelLineColumns
                },
                {
                  title: '补加合金',
                  rowKey: 'id',
                  dataSource: detailQuery.data.alloy_lines ?? [],
                  columns: [
                    { title: '合金', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
                    { title: '数量', dataIndex: 'quantity', align: 'right' },
                    { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
                    { title: '单价', dataIndex: 'unit_price', align: 'right', render: (v: any) => v ?? '—' },
                    { title: '金额', dataIndex: 'amount', align: 'right', render: (v: any) => v ?? '—' }
                  ]
                }
              ]
            : []
        }
      />
    </div>
  )
}

const steelLineColumns = [
  { title: '钢种', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '炉号', dataIndex: 'furnace_no', render: (v: string) => v ?? '—' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' }
]
