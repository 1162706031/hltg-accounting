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

interface SalesItem {
  id?: number
  line_no: number
  inventory_id?: number | null
  item_id?: number | null
  spec?: string | null
  weight_ton: string
  pieces?: number | null
  unit_price: string
  amount: string
  notes?: string | null
}

interface SalesOrder {
  id: number
  batch_no: string
  party_id: number
  ship_date?: string | null
  tax_rate?: string | null
  total_amount?: string | null
  need_invoice: boolean
  status: OrderStatus
  notes?: string | null
  party?: { name: string } | null
  items: SalesItem[]
}

export function Sales() {
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()
  const parties = useParties()
  const items = useItems()

  const query = useQuery({
    queryKey: ['sales', statusFilter],
    queryFn: async () =>
      (
        await api.get<PageResult<SalesOrder>>('/sales-orders', {
          params: { page_size: 100, ...(statusFilter ? { status: statusFilter } : {}) }
        })
      ).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sales'] })
  const onError = (e: any) => message.error(e.response?.data?.detail ?? '操作失败')

  const save = useMutation({
    mutationFn: async (values: any) => {
      const body = {
        ...values,
        ship_date: values.ship_date?.format('YYYY-MM-DD') ?? null,
        items: (values.items ?? []).map((it: any, idx: number) => ({ ...it, line_no: idx + 1 }))
      }
      return editingId ? api.put(`/sales-orders/${editingId}`, body) : api.post('/sales-orders', body)
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
    form.setFieldsValue({ tax_rate: 13, need_invoice: false, items: [{ line_no: 1, weight_ton: 0, unit_price: 0 }] })
  }

  const openEdit = async (row: SalesOrder) => {
    const detail = (await api.get<SalesOrder>(`/sales-orders/${row.id}`)).data
    setEditingId(row.id)
    setCreating(false)
    form.setFieldsValue({
      party_id: detail.party_id,
      ship_date: detail.ship_date ? dayjs(detail.ship_date) : null,
      tax_rate: detail.tax_rate ? Number(detail.tax_rate) : 13,
      need_invoice: detail.need_invoice,
      notes: detail.notes,
      items: detail.items.map((it) => ({
        line_no: it.line_no,
        inventory_id: it.inventory_id,
        item_id: it.item_id,
        spec: it.spec,
        weight_ton: Number(it.weight_ton),
        pieces: it.pieces,
        unit_price: Number(it.unit_price),
        notes: it.notes
      }))
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">销售管理</h1>
        <Button type="primary" onClick={openCreate}>
          + 新建销售单
        </Button>
      </div>
      <div className="toolbar">
        <span>状态：</span>
        <Select value={statusFilter} style={{ width: 140 }} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
      </div>
      <Table<SalesOrder>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '批次号', dataIndex: 'batch_no' },
          { title: '客户', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          { title: '发货日期', dataIndex: 'ship_date', render: (v) => v ?? '—' },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          {
            title: '操作',
            width: 280,
            render: (_, row) => (
              <OrderActions
                resource="sales-orders"
                orderId={row.id}
                status={row.status}
                role={user?.role}
                invalidateKey="sales"
                onEdit={() => openEdit(row)}
              />
            )
          }
        ]}
      />

      <Modal
        title={editingId ? '编辑销售单' : '新建销售单'}
        open={creating || editingId !== null}
        width={860}
        onCancel={() => {
          setCreating(false)
          setEditingId(null)
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="客户" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select showSearch optionFilterProp="label" options={partyOptions(parties.data)} loading={parties.isLoading} />
            </Form.Item>
            <Form.Item name="ship_date" label="发货日期">
              <DatePicker />
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

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>销售明细（完成时按库存项扣库）</div>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item {...field} name={[field.name, 'item_id']} label="物品" rules={[{ required: true }]}>
                      <Select
                        style={{ width: 180 }}
                        showSearch
                        optionFilterProp="label"
                        options={itemOptions(items.data)}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'inventory_id']} label="库存ID" tooltip="完成出库时按此库存项扣减">
                      <InputNumber style={{ width: 90 }} min={1} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'spec']} label="规格">
                      <Input style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'weight_ton']} label="重量(吨)" rules={[{ required: true }]}>
                      <InputNumber style={{ width: 100 }} min={0} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'pieces']} label="支数">
                      <InputNumber style={{ width: 80 }} min={0} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'unit_price']} label="单价" rules={[{ required: true }]}>
                      <InputNumber style={{ width: 100 }} min={0} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ weight_ton: 0, unit_price: 0 })} icon={<PlusOutlined />}>
                  添加明细
                </Button>
              </div>
            )}
          </Form.List>

          <Form.Item name="notes" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
