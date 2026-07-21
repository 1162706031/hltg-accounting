import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useRef, useState } from 'react'
import { api, getErrorMessage, PageResult } from '../api/client'
import { BatchDeleteButton } from '../components/BatchDeleteButton'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { InventoryLineList } from '../components/InventoryLines'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { SpecificationSelect, useSpecificationCreator } from '../components/SpecificationSelect'
import { useAuth } from '../utils/AuthContext'
import {
  countsForProcessingFee,
  InventoryStockOption,
  ITEM_TYPE_LABELS,
  masterDataLabelMap,
  masterDataSelectOptions,
  UNIT_OPTIONS,
  itemOptions,
  partyOptions,
  useInventoryStock,
  useItems,
  useMasterDataOptions,
  useParties
} from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'
import { replaceCachedPageItem } from '../utils/queryCache'

interface SmeltingOrder {
  id: number
  batch_no: string
  party_id: number
  order_type: 'ext_smelting' | 'inhouse'
  feed_date?: string | null
  tap_date?: string | null
  yield_pct?: string | null
  unit_price?: string | null
  processing_amount?: string | null
  tax_rate?: string | null
  tax_amount?: string | null
  subtotal?: string | null
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
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [partyId, setPartyId] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [feedDateRange, setFeedDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [tapDateRange, setTapDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [appliedFilters, setAppliedFilters] = useState({
    status: '',
    type: '',
    partyId: undefined as number | undefined,
    search: '',
    feedDateFrom: '',
    feedDateTo: '',
    tapDateFrom: '',
    tapDateTo: ''
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingStatus, setEditingStatus] = useState<OrderStatus | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [tapSelectedRowKeys, setTapSelectedRowKeys] = useState<number[]>([])
  const [form] = Form.useForm()
  const { openSpecificationCreator, specificationCreatorModal } = useSpecificationCreator(form)
  const editRequestSequence = useRef(0)
  const parties = useParties()
  const items = useItems()
  const itemTypesQuery = useMasterDataOptions('item_type')
  const itemTypeLabels = { ...ITEM_TYPE_LABELS, ...masterDataLabelMap(itemTypesQuery.data) }
  const stock = useInventoryStock()
  const specificationsQuery = useMasterDataOptions('specification')
  const specificationOptions = masterDataSelectOptions(specificationsQuery.data)
  const internalPartyId = (parties.data ?? []).find((p) => p.is_internal)?.id ?? null

  const query = useQuery({
    queryKey: ['smelting', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<SmeltingOrder>>('/smelting-orders', {
          params: {
            page,
            page_size: pageSize,
            ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
            ...(appliedFilters.type ? { order_type: appliedFilters.type } : {}),
            ...(appliedFilters.partyId ? { party_id: appliedFilters.partyId } : {}),
            ...(appliedFilters.search ? { q: appliedFilters.search } : {}),
            ...(appliedFilters.feedDateFrom ? { feed_date_from: appliedFilters.feedDateFrom } : {}),
            ...(appliedFilters.feedDateTo ? { feed_date_to: appliedFilters.feedDateTo } : {}),
            ...(appliedFilters.tapDateFrom ? { tap_date_from: appliedFilters.tapDateFrom } : {}),
            ...(appliedFilters.tapDateTo ? { tap_date_to: appliedFilters.tapDateTo } : {})
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
  const onError = (error: unknown) => message.error(getErrorMessage(error))

  const save = useMutation({
    mutationFn: async (values: any) => {
      const feedTotal = (values.feed_lines ?? []).reduce(
        (sum: number, line: any) => sum + Number(line?.quantity || 0),
        0
      )
      const yieldTapTotal = (values.tap_lines ?? []).reduce(
        (sum: number, line: any) =>
          sum + (countsForProcessingFee(line?.item_id, items.data) ? Number(line?.quantity || 0) : 0),
        0
      )
      const yieldPct = feedTotal > 0 ? Math.round((yieldTapTotal / feedTotal) * 10_000) / 100 : null
      if (yieldPct != null && yieldPct > 100) {
        throw new Error(`有效出钢量不能超过投料量，当前成锭率为 ${yieldPct.toFixed(2)}%`)
      }

      const mapLine = (it: any, idx: number, side?: string) => ({
        ...it,
        line_no: idx + 1,
        date: it.date?.format('YYYY-MM-DD') ?? null,
        ...(side ? { side } : {})
      })
      const body = {
        ...values,
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
      return (
        editingId
          ? await api.put<SmeltingOrder>(`/smelting-orders/${editingId}`, body)
          : await api.post<SmeltingOrder>('/smelting-orders', body)
      ).data
    },
    onSuccess: (updated: SmeltingOrder) => {
      message.success('已保存')
      replaceCachedPageItem(queryClient, ['smelting'], updated)
      setCreating(false)
      setEditingId(null)
      setEditingStatus(null)
      setTapSelectedRowKeys([])
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    editRequestSequence.current += 1
    setCreating(true)
    setEditingId(null)
    setEditingStatus(null)
    setTapSelectedRowKeys([])
    form.resetFields()
    form.setFieldsValue({ order_type: 'ext_smelting', tax_rate: 13, need_invoice: false, feed_lines: [], tap_lines: [], alloy_lines: [] })
  }

  const openEdit = async (row: SmeltingOrder) => {
    const requestSequence = ++editRequestSequence.current
    let d: SmeltingOrder
    try {
      d = (await api.get<SmeltingOrder>(`/smelting-orders/${row.id}`)).data
    } catch (error) {
      if (requestSequence === editRequestSequence.current) {
        message.error(getErrorMessage(error, '加载冶炼单详情失败'))
      }
      return
    }
    if (requestSequence !== editRequestSequence.current) return
    setEditingId(row.id)
    setEditingStatus(d.status)
    setTapSelectedRowKeys([])
    setCreating(false)
    form.resetFields()
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
        <div className="compact-line-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="line-list-toolbar">
            <div style={{ fontWeight: 600 }}>出钢 / 出料（归属决定入库单位）</div>
            <Space>
              <Button type="primary" ghost size="middle" onClick={() => add({ quantity: 0, unit: '吨' })} icon={<PlusOutlined />}>
                添加出钢
              </Button>
              <Button
                danger
                size="middle"
                disabled={tapSelectedRowKeys.length === 0}
                onClick={() => modal.confirm({
                  title: `确认移除选中的 ${tapSelectedRowKeys.length} 条出钢明细？`,
                  content: '移除后需保存冶炼单才会生效。',
                  okButtonProps: { danger: true },
                  onOk: () => {
                    remove(fields.filter((field) => tapSelectedRowKeys.includes(field.key)).map((field) => field.name))
                    setTapSelectedRowKeys([])
                  }
                })}
              >
                移除所选
              </Button>
            </Space>
          </div>
          <div className="line-list-table">
          {fields.length > 0 && (
            <div className="line-list-header">
              <span className="line-select-cell">
                <Checkbox
                  checked={fields.every((field) => tapSelectedRowKeys.includes(field.key))}
                  indeterminate={fields.some((field) => tapSelectedRowKeys.includes(field.key)) && !fields.every((field) => tapSelectedRowKeys.includes(field.key))}
                  onChange={(e) => setTapSelectedRowKeys(e.target.checked ? fields.map((field) => field.key) : [])}
                />
              </span>
              <span className="line-index-cell">序号</span>
              <span style={{ width: 140 }}>出钢日期</span>
              <span style={{ width: 150 }}>钢种</span>
              <span style={{ width: 200 }}>规格</span>
              <span style={{ width: 90 }}>数量</span>
              <span style={{ width: 80 }}>单位</span>
              <span style={{ width: 90 }}>炉号</span>
              <span style={{ width: 150 }}>归属</span>
              <span className="line-action-cell">操作</span>
            </div>
          )}
          {fields.map((field, index) => (
            <Space key={field.key} align="start" wrap={false} className="line-editor-row">
              <span className="line-select-cell">
                <Checkbox
                  checked={tapSelectedRowKeys.includes(field.key)}
                  onChange={(e) => setTapSelectedRowKeys((keys) => e.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key))}
                />
              </span>
              <span className="line-index-cell">{index + 1}</span>
              <Form.Item
                {...field}
                name={[field.name, 'date']}
                label="出钢日期"
                rules={[{ required: true, message: '请选择出钢日期' }]}
              >
                <DatePicker style={{ width: 140 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'item_id']} label="钢种" rules={[{ required: true }]}>
                <ItemSelect options={itemOptions(items.data, itemTypeLabels)} placeholder="钢种" style={{ width: 180 }} />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'spec']} label="规格" rules={[{ required: true, message: '请选择规格' }]}>
                <SpecificationSelect
                  showSearch
                  optionFilterProp="label"
                  options={specificationOptions}
                  onAddSpecification={() => openSpecificationCreator(['tap_lines', field.name, 'spec'])}
                  placeholder="选择规格"
                  notFoundContent="暂无规格，请点击下方新增"
                  style={{ width: 200 }}
                />
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
              <Form.Item {...field} name={[field.name, 'owner_id']} label="归属" rules={[{ required: true, message: '请选择所属单位' }]}>
                <PartySelect options={partyOptions(parties.data)} placeholder="归属单位" style={{ width: 150 }} />
              </Form.Item>
              <span className="line-action-cell">
                <MinusCircleOutlined onClick={() => modal.confirm({
                  title: '确认删除这条出钢明细？',
                  content: '删除后需保存冶炼单才会生效。',
                  okButtonProps: { danger: true },
                  onOk: () => {
                    remove(field.name)
                    setTapSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                  }
                })} />
              </span>
            </Space>
          ))}
          {fields.length === 0 && <div className="line-list-empty">暂无明细，请点击“添加出钢”新增一行</div>}
          </div>
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
      feedDateFrom: feedDateRange?.[0].format('YYYY-MM-DD') ?? '',
      feedDateTo: feedDateRange?.[1].format('YYYY-MM-DD') ?? '',
      tapDateFrom: tapDateRange?.[0].format('YYYY-MM-DD') ?? '',
      tapDateTo: tapDateRange?.[1].format('YYYY-MM-DD') ?? ''
    })
    setPage(1)
  }

  const resetFilters = () => {
    setStatusFilter('')
    setTypeFilter('')
    setPartyId(undefined)
    setSearch('')
    setFeedDateRange(null)
    setTapDateRange(null)
    setAppliedFilters({
      status: '', type: '', partyId: undefined, search: '',
      feedDateFrom: '', feedDateTo: '', tapDateFrom: '', tapDateTo: ''
    })
    setPage(1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">冶炼加工</h1>
      </div>
      <ListFilters>
        <div className="filter-item">
          <span>类型：</span>
          <Select value={typeFilter} style={{ width: 130 }} onChange={setTypeFilter} options={[{ value: '', label: '全部' }, ...ORDER_TYPE_OPTIONS]} />
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
          <span>投料/出库日期：</span>
          <DatePicker.RangePicker value={feedDateRange} onChange={(dates) => setFeedDateRange(dates as [Dayjs, Dayjs] | null)} />
        </div>
        <div className="filter-item">
          <span>出钢/入库日期：</span>
          <DatePicker.RangePicker value={tapDateRange} onChange={(dates) => setTapDateRange(dates as [Dayjs, Dayjs] | null)} />
        </div>
        <div className="filter-item">
          <span>名称：</span>
          <Input allowClear value={search} placeholder="搜索批次/单位/物品/规格/炉号" style={{ width: 280 }} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </ListFilters>
      <BusinessTable<SmeltingOrder>
        tableId="smelting"
        toolbarActions={canManage ? <><Button type="primary" onClick={openCreate}>+ 新建冶炼单</Button><BatchDeleteButton selectedKeys={selectedOrderIds} endpoint="/smelting-orders/batch-delete" entityName="冶炼单" onSuccess={() => { setSelectedOrderIds([]); invalidate() }} /></> : null}
        rowSelection={{ selectedRowKeys: selectedOrderIds, onChange: (keys) => setSelectedOrderIds(keys as number[]) }}
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        scroll={{ x: 1280 }}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '批次号',
            dataIndex: 'batch_no',
            width: 130,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>
          },
          {
            title: '类型',
            dataIndex: 'order_type',
            render: (v) => ORDER_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
          },
          { title: '单位', dataIndex: ['party', 'name'], render: (v) => v ?? '—' },
          {
            title: '投料日',
            dataIndex: 'feed_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          {
            title: '出钢日',
            dataIndex: 'tap_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          { title: '成锭率%', dataIndex: 'yield_pct', render: (v) => v ?? '—' },
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
          editRequestSequence.current += 1
          setCreating(false)
          setEditingId(null)
          setEditingStatus(null)
          setTapSelectedRowKeys([])
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="party_id" label="业务单位" rules={[{ required: true }]}>
              <PartySelect options={partyOptions(parties.data)} placeholder="业务单位" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="order_type" label="类型" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={ORDER_TYPE_OPTIONS} />
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
              dateRequired
              addLabel="添加来料"
              disabled={stockOutLocked}
              disabledReason="已扣库，禁止修改"
              allowFillAllQuantity
              compactTable
            />
            {renderTapLines()}
            <InventoryLineList
              form={form}
              name="alloy_lines"
              title="补加合金（从本厂现存合金库存中选择）"
              stock={stock.data}
              dateField="date"
              dateLabel="补加日期"
              dateRequired
              filter={(r: InventoryStockOption) =>
                r.item?.item_type === 'alloy' &&
                internalPartyId != null &&
                r.owner?.id === internalPartyId
              }
              addLabel="添加合金"
              selectWidth={280}
              disabled={stockOutLocked}
              disabledReason="已扣库，禁止修改"
              compactTable
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
            <Form.Item label="预计合计" tooltip="来料/出钢/合金金额 + 加工费(有效出钢量×加工单价) + 税额(仅需开票时计税)，便于核对">
              <Form.Item noStyle shouldUpdate>
                {({ getFieldsValue }) => {
                  const v = getFieldsValue()
                  const sumAmount = (lines: any[]) =>
                    (lines ?? []).reduce(
                      (s, l) => s + (l?.unit_price != null ? Number(l.quantity || 0) * Number(l.unit_price) : 0),
                      0
                    )
                  const processingQty = (v.tap_lines ?? []).reduce(
                    (s: number, l: any) =>
                      s + (countsForProcessingFee(l?.item_id, items.data) ? Number(l?.quantity || 0) : 0),
                    0
                  )
                  const processing = v.unit_price != null ? processingQty * Number(v.unit_price) : 0
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
                { label: '投料日期', value: detailQuery.data.feed_date },
                { label: '出钢日期', value: detailQuery.data.tap_date },
                { label: '成锭率', value: detailQuery.data.yield_pct != null ? `${detailQuery.data.yield_pct}%` : '—' },
                { label: '加工单价', value: detailQuery.data.unit_price },
                { label: '加工费', value: detailQuery.data.processing_amount },
                { label: '小计', value: detailQuery.data.subtotal },
                { label: '税额', value: detailQuery.data.tax_amount },
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
                  columns: feedLineColumns
                },
                {
                  title: '出钢',
                  rowKey: 'id',
                  dataSource: (detailQuery.data.inbound_lines ?? []).filter((l: any) => l.side === 'out'),
                  columns: tapLineColumns
                },
                {
                  title: '补加合金',
                  rowKey: 'id',
                  dataSource: detailQuery.data.alloy_lines ?? [],
                  columns: alloyLineColumns
                }
              ]
            : []
        }
      />
      {specificationCreatorModal}
    </div>
  )
}

const feedLineColumns = [
  { title: '日期', dataIndex: 'date', render: (v: string) => v ?? '—' },
  { title: '库存项', dataIndex: 'inventory_id', render: (v: number) => (v ? `#${v}` : '—') },
  { title: '物品', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '备注', dataIndex: 'notes', render: (v: string) => v ?? '—' }
]

const tapLineColumns = [
  { title: '日期', dataIndex: 'date', render: (v: string) => v ?? '—' },
  { title: '钢种', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '炉号', dataIndex: 'furnace_no', render: (v: string) => v ?? '—' },
  { title: '归属', render: (_: any, r: any) => r.owner?.name ?? (r.owner_id ? `#${r.owner_id}` : '—') },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '备注', dataIndex: 'notes', render: (v: string) => v ?? '—' }
]

const alloyLineColumns = [
  { title: '日期', dataIndex: 'date', render: (v: string) => v ?? '—' },
  { title: '库存项', dataIndex: 'inventory_id', render: (v: number) => (v ? `#${v}` : '—') },
  { title: '合金', render: (_: any, r: any) => r.item?.name ?? r.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (v: string) => v ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit', render: (v: string) => v ?? '—' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (v: any) => v ?? '—' },
  { title: '备注', dataIndex: 'notes', render: (v: string) => v ?? '—' }
]
