import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { useAuth } from '../utils/AuthContext'
import { UNIT_OPTIONS, itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'

interface OutsourceOrder {
  id: number
  batch_no: string
  party_id: number
  process_type: 'forging' | 'esr' | 'turning' | 'annealing'
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
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()

  const query = useQuery({
    queryKey: ['outsource', statusFilter, typeFilter],
    queryFn: async () =>
      (
        await api.get<PageResult<OutsourceOrder>>('/outsource-orders', {
          params: {
            page_size: 100,
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(typeFilter ? { process_type: typeFilter } : {})
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
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({ process_type: 'forging', tax_rate: 13, need_invoice: false, outbound_lines: [], inbound_lines: [] })
  }

  const openEdit = async (row: OutsourceOrder) => {
    const d = (await api.get<OutsourceOrder>(`/outsource-orders/${row.id}`)).data
    setEditingId(row.id)
    setCreating(false)
    form.setFieldsValue({
      party_id: d.party_id,
      process_type: d.process_type,
      unit_price: d.unit_price ? Number(d.unit_price) : null,
      tax_rate: d.tax_rate ? Number(d.tax_rate) : 13,
      need_invoice: d.need_invoice,
      notes: d.notes,
      outbound_lines: d.outbound_lines.map((l) => ({
        out_date: l.out_date ? dayjs(l.out_date) : null,
        item_id: l.item_id,
        spec: l.spec,
        quantity: Number(l.quantity),
        unit: l.unit ?? '吨',
        unit_price: l.unit_price ? Number(l.unit_price) : null
      })),
      inbound_lines: d.inbound_lines.map((l) => ({
        in_date: l.in_date ? dayjs(l.in_date) : null,
        item_id: l.item_id,
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" wrap>
              <Form.Item {...field} name={[field.name, dateField]} label="日期">
                <DatePicker />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'item_id']} label="钢种">
                <Select style={{ width: 150 }} showSearch optionFilterProp="label" options={itemOptions(items.data)} />
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
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Button type="dashed" size="small" onClick={() => add({ quantity: 0, unit: '吨' })} icon={<PlusOutlined />}>
            添加行
          </Button>
        </div>
      )}
    </Form.List>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">外协加工</h1>
        <Button type="primary" onClick={openCreate}>
          + 新建外协单
        </Button>
      </div>
      <div className="toolbar">
        <span>工艺：</span>
        <Select value={typeFilter} style={{ width: 130 }} onChange={setTypeFilter} options={[{ value: '', label: '全部' }, ...PROCESS_OPTIONS]} />
        <span>状态：</span>
        <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
      </div>
      <Table<OutsourceOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: '批次号', dataIndex: 'batch_no' },
          { title: '工艺', dataIndex: 'process_type', render: (v) => PROCESS_OPTIONS.find((o) => o.value === v)?.label ?? v },
          { title: '外协厂', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          { title: '成材率', dataIndex: 'yield_rate', render: (v) => (v ? `${(Number(v) * 100).toFixed(2)}%` : '—') },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            width: 340,
            render: (_, row) => (
              <Space size="small">
                <Button size="small" onClick={() => setDetailId(row.id)}>
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
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="外协厂" rules={[{ required: true }]}>
              <Select style={{ width: 200 }} showSearch optionFilterProp="label" options={partyOptions(parties.data)} />
            </Form.Item>
            <Form.Item name="process_type" label="工艺" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={PROCESS_OPTIONS} />
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
            {renderLines('outbound_lines', 'out_date', '发出（审核时扣本厂库存）')}
            {renderLines('inbound_lines', 'in_date', '回厂（完成时入本厂库存）')}
          </div>

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
                  columns: outsourceLineColumns
                },
                {
                  title: '回厂',
                  rowKey: 'id',
                  dataSource: detailQuery.data.inbound_lines ?? [],
                  columns: outsourceLineColumns
                }
              ]
            : []
        }
      />
    </div>
  )
}

const outsourceLineColumns = [
  { title: '钢种', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: any) => v ?? '—' }
]
