import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Button, Checkbox, DatePicker, Form, FormInstance, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { api, getErrorMessage, PageResult } from '../api/client'
import { BatchDeleteButton } from '../components/BatchDeleteButton'
import { BusinessTable } from '../components/BusinessTable'
import { BusinessVoucherUpload, uploadBusinessVouchers } from '../components/BusinessVoucherUpload'
import { ListFilters } from '../components/ListFilters'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { InventoryLineList } from '../components/InventoryLines'
import { LineTotals } from '../components/LineTotals'
import { PartySelect } from '../components/QuickCreate'
import { ItemSelect } from '../components/QuickCreate'
import { SpecificationSelect, useSpecificationCreator } from '../components/SpecificationSelect'
import { useAuth } from '../utils/AuthContext'
import {
  ITEM_TYPE_LABELS,
  creatorOptions,
  itemOptions,
  masterDataLabelMap,
  masterDataSelectOptions,
  partyOptions,
  UNIT_OPTIONS,
  useCreatorOptions,
  useInventoryStock,
  useItems,
  useMasterDataOptions,
  useParties
} from '../utils/lookups'
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
  sales_mode: SalesMode
  ship_date?: string | null
  tax_rate?: string | null
  total_amount?: string | null
  need_invoice: boolean
  status: OrderStatus
  created_by_name?: string | null
  created_at: string
  notes?: string | null
  party?: { name: string } | null
  items: SalesItem[]
}

type SalesMode = 'inventory' | 'item_spec'

const SALES_MODE_LABELS: Record<SalesMode, string> = {
  inventory: '指定库存销售',
  item_spec: '按物品规格下单'
}

function ItemSpecSalesLines({
  form,
  itemSelectOptions,
  specificationOptions,
  onAddSpecification
}: {
  form: FormInstance
  itemSelectOptions: Array<{ value: number; label: string }>
  specificationOptions: Array<{ value: string; label: string }>
  onAddSpecification: (field: Array<string | number>) => void
}) {
  const { modal } = AntApp.useApp()
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const watchedItems = Form.useWatch('items', form)

  useEffect(() => {
    if (!watchedItems?.length) setSelectedRowKeys([])
  }, [watchedItems?.length])

  return (
    <Form.List name="items" rules={[{ validator: (_, value) => value?.length ? Promise.resolve() : Promise.reject(new Error('请至少添加一条销售明细')) }]}>
      {(fields, { add, remove }, { errors }) => (
        <div className="compact-line-list sales-spec-line-list">
          <div className="line-list-toolbar">
            <div style={{ fontWeight: 600 }}>按物品与规格下单</div>
            <Space>
              <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => add({ quantity: 0, unit: '吨', unit_price: 0 })}>添加销售明细</Button>
              <Button
                danger
                disabled={selectedRowKeys.length === 0}
                onClick={() => modal.confirm({
                  title: `确认移除选中的 ${selectedRowKeys.length} 条销售明细？`,
                  content: '移除后需保存销售单才会生效。',
                  okButtonProps: { danger: true },
                  onOk: () => {
                    remove(fields.filter((field) => selectedRowKeys.includes(field.key)).map((field) => field.name))
                    setSelectedRowKeys([])
                  }
                })}
              >移除所选</Button>
            </Space>
          </div>
          <div className="line-list-table">
            {fields.length > 0 && (
              <div className="line-list-header sales-spec-line-grid">
                <span className="line-select-cell"><Checkbox checked={fields.every((field) => selectedRowKeys.includes(field.key))} indeterminate={fields.some((field) => selectedRowKeys.includes(field.key)) && !fields.every((field) => selectedRowKeys.includes(field.key))} onChange={(event) => setSelectedRowKeys(event.target.checked ? fields.map((field) => field.key) : [])} /></span>
                <span className="line-index-cell">序号</span>
                <span>发货日期</span><span>物品</span><span>规格</span><span>数量</span><span>单位</span><span>单价</span><span>操作</span>
              </div>
            )}
            {fields.map((field, index) => (
              <div className="line-editor-row sales-spec-line-grid" key={field.key}>
                <span className="line-select-cell"><Checkbox checked={selectedRowKeys.includes(field.key)} onChange={(event) => setSelectedRowKeys((keys) => event.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key))} /></span>
                <span className="line-index-cell">{index + 1}</span>
                <Form.Item name={[field.name, 'ship_date']} label="发货日期" rules={[{ required: true, message: '请选择发货日期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
                <Form.Item name={[field.name, 'item_id']} label="物品" rules={[{ required: true, message: '请选择物品' }]}><ItemSelect options={itemSelectOptions} /></Form.Item>
                <Form.Item name={[field.name, 'spec']} label="规格" rules={[{ required: true, whitespace: true, message: '请选择规格' }]}>
                  <SpecificationSelect
                    showSearch
                    optionFilterProp="label"
                    options={specificationOptions}
                    onAddSpecification={() => onAddSpecification(['items', field.name, 'spec'])}
                    placeholder="选择规格"
                    notFoundContent="暂无规格，请点击下方新增"
                  />
                </Form.Item>
                <Form.Item name={[field.name, 'quantity']} label="数量" rules={[{ required: true, type: 'number', min: 0.001, message: '请输入大于 0 的数量' }]}><InputNumber min={0.001} precision={3} style={{ width: '100%' }} /></Form.Item>
                <Form.Item name={[field.name, 'unit']} label="单位" rules={[{ required: true }]}><Select options={UNIT_OPTIONS} /></Form.Item>
                <Form.Item name={[field.name, 'unit_price']} label="单价" rules={[{ required: true, message: '请输入单价' }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item>
                <span className="line-action-cell">
                  <MinusCircleOutlined onClick={() => modal.confirm({
                    title: '确认删除这条销售明细？',
                    content: '删除后需保存销售单才会生效。',
                    okButtonProps: { danger: true },
                    onOk: () => {
                      remove(field.name)
                      setSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                    }
                  })} />
                </span>
              </div>
            ))}
            {fields.length === 0 && <div className="line-list-empty">暂无明细，请点击“添加销售明细”新增一行</div>}
          </div>
          <Form.ErrorList errors={errors} />
          <LineTotals lines={watchedItems} />
        </div>
      )}
    </Form.List>
  )
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
  const [creatorId, setCreatorId] = useState<number | undefined>()
  const [createdAtRange, setCreatedAtRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [appliedFilters, setAppliedFilters] = useState({
    status: '',
    partyId: undefined as number | undefined,
    search: '',
    shipDateFrom: '',
    shipDateTo: '',
    creatorId: undefined as number | undefined,
    createdAtFrom: '',
    createdAtTo: ''
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [voucherFiles, setVoucherFiles] = useState<File[]>([])
  const [form] = Form.useForm()
  const salesMode = (Form.useWatch('sales_mode', form) as SalesMode | undefined) ?? 'inventory'
  const { openSpecificationCreator, specificationCreatorModal } = useSpecificationCreator(form)
  const editRequestSequence = useRef(0)
  const parties = useParties()
  const creators = useCreatorOptions()
  const stock = useInventoryStock()
  const items = useItems()
  const itemTypesQuery = useMasterDataOptions('item_type')
  const itemTypeLabels = { ...ITEM_TYPE_LABELS, ...masterDataLabelMap(itemTypesQuery.data) }
  const specificationsQuery = useMasterDataOptions('specification')
  const specificationOptions = masterDataSelectOptions(specificationsQuery.data)

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
            ...(appliedFilters.shipDateTo ? { ship_date_to: appliedFilters.shipDateTo } : {}),
            ...(appliedFilters.creatorId ? { created_by: appliedFilters.creatorId } : {}),
            ...(appliedFilters.createdAtFrom ? { created_at_from: appliedFilters.createdAtFrom } : {}),
            ...(appliedFilters.createdAtTo ? { created_at_to: appliedFilters.createdAtTo } : {})
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
    onSuccess: async (updated: SalesOrder) => {
      const uploadResult = await uploadBusinessVouchers('sales_order', updated.id, voucherFiles)
      if (uploadResult.failures.length) {
        message.warning(`销售单已保存；${uploadResult.failures.join('；')}`)
      } else {
        message.success(uploadResult.uploaded ? `已保存并上传 ${uploadResult.uploaded} 张凭证` : '已保存')
      }
      replaceCachedPageItem(queryClient, ['sales'], updated)
      setVoucherFiles([])
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
    setVoucherFiles([])
    form.resetFields()
    form.setFieldsValue({ sales_mode: 'inventory', tax_rate: 13, need_invoice: false, items: [{ quantity: 0 }] })
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
    setVoucherFiles([])
    form.resetFields()
    form.setFieldsValue({
      party_id: detail.party_id,
      sales_mode: detail.sales_mode ?? 'inventory',
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
      shipDateTo: shipDateRange?.[1].format('YYYY-MM-DD') ?? '',
      creatorId,
      createdAtFrom: createdAtRange?.[0].format('YYYY-MM-DD') ?? '',
      createdAtTo: createdAtRange?.[1].format('YYYY-MM-DD') ?? ''
    })
    setPage(1)
  }

  const resetFilters = () => {
    setStatusFilter('')
    setPartyId(undefined)
    setSearch('')
    setShipDateRange(null)
    setCreatorId(undefined)
    setCreatedAtRange(null)
    setAppliedFilters({ status: '', partyId: undefined, search: '', shipDateFrom: '', shipDateTo: '', creatorId: undefined, createdAtFrom: '', createdAtTo: '' })
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
        <div className="filter-item">
          <span>创建人：</span>
          <Select allowClear showSearch value={creatorId} placeholder="全部创建人" style={{ width: 220 }} optionFilterProp="label" options={creatorOptions(creators.data)} onChange={setCreatorId} />
        </div>
        <div className="filter-item">
          <span>创建时间：</span>
          <DatePicker.RangePicker value={createdAtRange} onChange={(dates) => setCreatedAtRange(dates as [Dayjs, Dayjs] | null)} />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </ListFilters>
      <BusinessTable<SalesOrder>
        tableId="sales"
        defaultHiddenColumnIds={['created_by_name', 'created_at']}
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
          { title: '销售模式', dataIndex: 'sales_mode', width: 140, render: (v: SalesMode) => SALES_MODE_LABELS[v] ?? v },
          { title: '合计', dataIndex: 'total_amount', align: 'right', render: (v) => v ?? '—' },
          { title: '状态', dataIndex: 'status', render: (s: OrderStatus) => <OrderStatusTag status={s} /> },
          { title: '创建人', dataIndex: 'created_by_name', width: 120, render: (v) => v ?? '—' },
          { title: '创建时间', dataIndex: 'created_at', width: 180, render: (v: string) => v ? v.slice(0, 19).replace('T', ' ') : '—' },
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
        width={1280}
        onCancel={() => {
          editRequestSequence.current += 1
          setCreating(false)
          setEditingId(null)
          setVoucherFiles([])
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
            <Form.Item name="sales_mode" label="销售模式" rules={[{ required: true }]} style={{ minWidth: 220 }}>
              <Select
                options={[
                  { value: 'inventory', label: SALES_MODE_LABELS.inventory },
                  { value: 'item_spec', label: SALES_MODE_LABELS.item_spec }
                ]}
              />
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

          <Alert
            type={salesMode === 'item_spec' ? 'warning' : 'info'}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              salesMode === 'item_spec'
                ? '完成订单时，系统按物品、规格和单位自动匹配本厂库存；没有对应库存或数量不足时，整张销售单不会完成，也不会产生部分扣库。'
                : '完成订单时，系统按明细中选定的具体库存项扣减库存。'
            }
          />

          {salesMode === 'item_spec' ? (
            <ItemSpecSalesLines
              form={form}
              itemSelectOptions={itemOptions(items.data, itemTypeLabels)}
              specificationOptions={specificationOptions}
              onAddSpecification={openSpecificationCreator}
            />
          ) : (
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
          )}

          <Form.Item name="notes" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="上传凭证">
            <BusinessVoucherUpload
              entityType="sales_order"
              entityId={editingId}
              pendingFiles={voucherFiles}
              onPendingFilesChange={setVoucherFiles}
              disabled={save.isPending}
            />
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
                { label: '销售模式', value: SALES_MODE_LABELS[detailQuery.data.sales_mode ?? 'inventory'] },
                { label: '发货日期', value: detailQuery.data.ship_date },
                { label: '税率', value: detailQuery.data.tax_rate != null ? `${detailQuery.data.tax_rate}%` : '—' },
                { label: '是否开票', value: detailQuery.data.need_invoice ? '是' : '否' },
                { label: '合计', value: detailQuery.data.total_amount },
                { label: '状态', value: <OrderStatusTag status={detailQuery.data.status} /> },
                { label: '备注', value: detailQuery.data.notes, span: 2 },
                {
                  label: '上传凭证',
                  value: <BusinessVoucherUpload entityType="sales_order" entityId={detailQuery.data.id} readOnly />,
                  span: 2
                }
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
                    { title: '物品', render: (_: any, r: SalesItem) => r.item?.name ?? '—' },
                    { title: '规格', dataIndex: 'spec', render: (v: string) => v || '—' },
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
      {specificationCreatorModal}
    </div>
  )
}
