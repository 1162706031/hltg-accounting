import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useRef, useState } from 'react'
import { api, getErrorMessage, PageResult } from '../api/client'
import { BatchDeleteButton } from '../components/BatchDeleteButton'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { InventoryLineList } from '../components/InventoryLines'
import { PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { partyOptions, useInventoryStock, useParties } from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'
import { replaceCachedPageItem } from '../utils/queryCache'

interface SalesItem {
  id?: number
  line_no: number
  ship_date?: string | null
  inventory_id?: number | null
  item_id?: number | null
  spec?: string | null
  quantity: string
  unit?: string
  unit_price: string
  amount: string
  notes?: string | null
  item?: { id: number; name: string } | null
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
  const canManage = canManageData(user?.role)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [partyId, setPartyId] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [shipDateRange, setShipDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [appliedFilters, setAppliedFilters] = useState({
    status: '',
    partyId: undefined as number | undefined,
    search: '',
    shipDateFrom: '',
    shipDateTo: ''
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [form] = Form.useForm()
  const editRequestSequence = useRef(0)
  const parties = useParties()
  const stock = useInventoryStock()

  const query = useQuery({
    queryKey: ['sales', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<SalesOrder>>('/sales-orders', {
          params: {
            page,
            page_size: pageSize,
            ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
            ...(appliedFilters.partyId ? { party_id: appliedFilters.partyId } : {}),
            ...(appliedFilters.search ? { q: appliedFilters.search } : {}),
            ...(appliedFilters.shipDateFrom ? { ship_date_from: appliedFilters.shipDateFrom } : {}),
            ...(appliedFilters.shipDateTo ? { ship_date_to: appliedFilters.shipDateTo } : {})
          }
        })
      ).data
  })

  const detailQuery = useQuery({
    queryKey: ['sales', 'detail', detailId],
    enabled: detailId !== null,
    queryFn: async () => (await api.get<SalesOrder>(`/sales-orders/${detailId}`)).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sales'] })
  const onError = (error: unknown) => message.error(getErrorMessage(error))

  const save = useMutation({
    mutationFn: async (values: any) => {
      const body = {
        ...values,
        items: (values.items ?? []).map((it: any, idx: number) => ({
          ...it,
          line_no: idx + 1,
          ship_date: it.ship_date?.format('YYYY-MM-DD') ?? null,
          unit_price: it.unit_price ?? 0
        }))
      }
      return (
        editingId
          ? await api.put<SalesOrder>(`/sales-orders/${editingId}`, body)
          : await api.post<SalesOrder>('/sales-orders', body)
      ).data
    },
    onSuccess: (updated: SalesOrder) => {
      message.success('已保存')
      replaceCachedPageItem(queryClient, ['sales'], updated)
      setCreating(false)
      setEditingId(null)
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    editRequestSequence.current += 1
    setCreating(true)
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({ tax_rate: 13, need_invoice: false, items: [{ quantity: 0 }] })
  }

  const openEdit = async (row: SalesOrder) => {
    const requestSequence = ++editRequestSequence.current
    let detail: SalesOrder
    try {
      detail = (await api.get<SalesOrder>(`/sales-orders/${row.id}`)).data
    } catch (error) {
      if (requestSequence === editRequestSequence.current) {
        message.error(getErrorMessage(error, '加载销售单详情失败'))
      }
      return
    }
    if (requestSequence !== editRequestSequence.current) return
    setEditingId(row.id)
    setCreating(false)
    form.resetFields()
    form.setFieldsValue({
      party_id: detail.party_id,
      tax_rate: detail.tax_rate ? Number(detail.tax_rate) : 13,
      need_invoice: detail.need_invoice,
      notes: detail.notes,
      items: detail.items.map((it) => ({
        line_no: it.line_no,
        ship_date: it.ship_date ? dayjs(it.ship_date) : null,
        inventory_id: it.inventory_id,
        item_id: it.item_id,
        spec: it.spec,
        quantity: Number(it.quantity),
        unit: it.unit,
        unit_price: Number(it.unit_price),
        notes: it.notes
      }))
    })
  }

  const applyFilters = () => {
    setAppliedFilters({
      status: statusFilter,
      partyId,
      search: search.trim(),
      shipDateFrom: shipDateRange?.[0].format('YYYY-MM-DD') ?? '',
      shipDateTo: shipDateRange?.[1].format('YYYY-MM-DD') ?? ''
    })
    setPage(1)
  }

  const resetFilters = () => {
    setStatusFilter('')
    setPartyId(undefined)
    setSearch('')
    setShipDateRange(null)
    setAppliedFilters({ status: '', partyId: undefined, search: '', shipDateFrom: '', shipDateTo: '' })
    setPage(1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">销售管理</h1>
      </div>
      <ListFilters>
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
          <span>发货/出库日期：</span>
          <DatePicker.RangePicker
            value={shipDateRange}
            onChange={(dates) => setShipDateRange(dates as [Dayjs, Dayjs] | null)}
          />
        </div>
        <div className="filter-item">
          <span>名称：</span>
          <Input
            allowClear
            value={search}
            placeholder="搜索批次/客户/物品/规格"
            style={{ width: 280 }}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </ListFilters>
      <BusinessTable<SalesOrder>
        tableId="sales"
        toolbarActions={canManage ? <><Button type="primary" onClick={openCreate}>+ 新建销售单</Button><BatchDeleteButton selectedKeys={selectedOrderIds} endpoint="/sales-orders/batch-delete" entityName="销售单" onSuccess={() => { setSelectedOrderIds([]); invalidate() }} /></> : null}
        rowSelection={{ selectedRowKeys: selectedOrderIds, onChange: (keys) => setSelectedOrderIds(keys as number[]) }}
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        scroll={{ x: 1050 }}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '批次号',
            dataIndex: 'batch_no',
            width: 130,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>
          },
          { title: '客户', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          {
            title: '发货日期',
            dataIndex: 'ship_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
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
                  resource="sales-orders"
                  orderId={row.id}
                  status={row.status}
                  role={user?.role}
                  invalidateKey="sales"
                  onEdit={() => openEdit(row)}
                />
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editingId ? '编辑销售单' : '新建销售单'}
        open={creating || editingId !== null}
        width={960}
        onCancel={() => {
          editRequestSequence.current += 1
          setCreating(false)
          setEditingId(null)
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="客户" rules={[{ required: true }]} style={{ flex: 1 }}>
              <PartySelect options={partyOptions(parties.data)} placeholder="选择客户" />
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
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) => prev.need_invoice !== cur.need_invoice}
            >
              {({ getFieldValue }) => (
                <Form.Item name="tax_rate" label="税率(%)" tooltip="不开票时不计税">
                  <InputNumber min={0} max={100} disabled={!getFieldValue('need_invoice')} />
                </Form.Item>
              )}
            </Form.Item>
          </Space>

          <InventoryLineList
            form={form}
            name="items"
            title="销售明细（每行发货日期必填；整单日期自动取最晚日期）"
            stock={stock.data}
            dateField="ship_date"
            dateLabel="发货日期"
            dateRequired
            addLabel="添加销售明细"
            compactTable
          />

          <Form.Item name="notes" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        loading={detailQuery.isLoading}
        title={detailQuery.data ? `销售单 ${detailQuery.data.batch_no}` : '销售单详情'}
        fields={
          detailQuery.data
            ? [
                { label: '批次号', value: detailQuery.data.batch_no },
                { label: '客户', value: detailQuery.data.party?.name },
                { label: '发货日期', value: detailQuery.data.ship_date },
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
                  title: '销售明细',
                  dataSource: detailQuery.data.items ?? [],
                  rowKey: 'line_no',
                  columns: [
                    { title: '物品', render: (_: any, r: SalesItem) => r.item?.name ?? r.spec ?? '—' },
                    { title: '数量', dataIndex: 'quantity', align: 'right' },
                    { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
                    { title: '单价', dataIndex: 'unit_price', align: 'right' },
                    { title: '金额', dataIndex: 'amount', align: 'right' },
                    { title: '备注', dataIndex: 'notes', render: (v: string) => v ?? '—' }
                  ]
                }
              ]
            : []
        }
      />
    </div>
  )
}
