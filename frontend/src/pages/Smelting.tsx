import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { OrderActions } from '../components/OrderActions'
import { useAuth } from '../utils/AuthContext'
import { itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
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
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()

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
        alloy_lines: (values.alloy_lines ?? []).map((it: any) => ({ ...it }))
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
    const toLine = (it: any) => ({
      date: it.date ? dayjs(it.date) : null,
      item_id: it.item_id,
      weight_ton: Number(it.weight_ton),
      pieces: it.pieces,
      spec: it.spec,
      furnace_no: it.furnace_no,
      owner_id: it.owner_id,
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
      feed_lines: d.inbound_lines.filter((l) => l.side === 'in').map(toLine),
      tap_lines: d.inbound_lines.filter((l) => l.side === 'out').map(toLine),
      alloy_lines: d.alloy_lines.map((a) => ({
        item_id: a.item_id,
        weight_kg: Number(a.weight_kg),
        unit_price: a.unit_price ? Number(a.unit_price) : null,
        notes: a.notes
      }))
    })
  }

  const renderSteelLines = (name: string, title: string, withOwner: boolean) => (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" wrap>
              <Form.Item {...field} name={[field.name, 'item_id']} label="钢种">
                <Select style={{ width: 150 }} showSearch optionFilterProp="label" options={itemOptions(items.data)} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'spec']} label="规格">
                <Input style={{ width: 90 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'weight_ton']} label="重量(吨)">
                <InputNumber style={{ width: 90 }} min={0} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'pieces']} label="支数">
                <InputNumber style={{ width: 70 }} min={0} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'furnace_no']} label="炉号">
                <Input style={{ width: 90 }} />
              </Form.Item>
              {withOwner && (
                <Form.Item {...field} name={[field.name, 'owner_id']} label="归属">
                  <Select style={{ width: 120 }} allowClear showSearch optionFilterProp="label" options={partyOptions(parties.data)} />
                </Form.Item>
              )}
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Button type="dashed" size="small" onClick={() => add({ weight_ton: 0 })} icon={<PlusOutlined />}>
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
          {
            title: '操作',
            width: 280,
            render: (_, row) => (
              <OrderActions
                resource="smelting-orders"
                orderId={row.id}
                status={row.status}
                role={user?.role}
                invalidateKey="smelting"
                onEdit={() => openEdit(row)}
              />
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
          </Space>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {renderSteelLines('feed_lines', '来料 / 投料', false)}
            {renderSteelLines('tap_lines', '出钢 / 出料（归属决定入库单位）', true)}

            <Form.List name="alloy_lines">
              {(fields, { add, remove }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>补加合金</div>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" wrap>
                      <Form.Item {...field} name={[field.name, 'item_id']} label="合金" rules={[{ required: true }]}>
                        <Select style={{ width: 160 }} showSearch optionFilterProp="label" options={itemOptions(items.data)} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'weight_kg']} label="重量(kg)">
                        <InputNumber style={{ width: 100 }} min={0} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'unit_price']} label="单价(元/kg)">
                        <InputNumber style={{ width: 110 }} min={0} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button type="dashed" size="small" onClick={() => add({ weight_kg: 0 })} icon={<PlusOutlined />}>
                    添加合金
                  </Button>
                </div>
              )}
            </Form.List>
          </div>

          <Form.Item name="notes" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
