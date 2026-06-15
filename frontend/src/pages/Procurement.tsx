import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { UNIT_OPTIONS, itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'

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
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState<ProcurementOrder | null>(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<ProcurementOrder | null>(null)
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()

  const query = useQuery({
    queryKey: ['procurement', statusFilter],
    queryFn: async () =>
      (
        await api.get<PageResult<ProcurementOrder>>('/procurement-orders', {
          params: { page_size: 100, ...(statusFilter ? { status: statusFilter } : {}) }
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

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">采购管理</h1>
        <Button type="primary" onClick={openCreate}>
          + 新建采购单
        </Button>
      </div>
      <div className="toolbar">
        <span>状态：</span>
        <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
      </div>
      <Table<ProcurementOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '批次号', dataIndex: 'batch_no' },
          { title: '供应商', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          { title: '物品', dataIndex: ['item', 'name'], render: (v) => v ?? '—' },
          { title: '采购日期', dataIndex: 'purchase_date', render: (v) => v ?? '—' },
          { title: '数量', dataIndex: 'quantity', align: 'right' },
          { title: '单位', dataIndex: 'unit' },
          { title: '单价', dataIndex: 'unit_price', align: 'right' },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            width: 340,
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
                  deletableUnlessCompleted
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
