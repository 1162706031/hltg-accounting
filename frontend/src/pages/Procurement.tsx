import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { BatchDeleteButton } from '../components/BatchDeleteButton'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
import { OrderActions } from '../components/OrderActions'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { SpecificationSelect, useSpecificationCreator } from '../components/SpecificationSelect'
import { useAuth } from '../utils/AuthContext'
import {
  ITEM_TYPE_LABELS,
  masterDataLabelMap,
  masterDataSelectOptions,
  UNIT_OPTIONS,
  itemOptions,
  partyOptions,
  useItems,
  useMasterDataOptions,
  useParties
} from '../utils/lookups'
import { OrderStatus, OrderStatusTag, STATUS_FILTER_OPTIONS } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'
import { replaceCachedPageItem } from '../utils/queryCache'

interface ProcurementItem {
  id?: number
  in_date: string
  item_id: number
  item_spec?: string | null
  quantity: string
  unit: string
  unit_price: string
  amount?: string
  owner_id: number
  item?: { id: number; name: string; item_type: string } | null
  owner?: { id: number; name: string } | null
}

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
  items: ProcurementItem[]
}

export function Procurement() {
  const { message, modal } = AntApp.useApp()
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
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [form] = Form.useForm()
  const { openSpecificationCreator, specificationCreatorModal } = useSpecificationCreator(form)
  const parties = useParties()
  const items = useItems()
  const itemTypesQuery = useMasterDataOptions('item_type')
  const itemTypeLabels = { ...ITEM_TYPE_LABELS, ...masterDataLabelMap(itemTypesQuery.data) }
  const specificationsQuery = useMasterDataOptions('specification')
  const specificationOptions = masterDataSelectOptions(specificationsQuery.data)

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
      const body = {
        ...values,
        items: (values.items ?? []).map((line: any, index: number) => ({
          ...line,
          line_no: index + 1,
          in_date: line.in_date.format('YYYY-MM-DD')
        }))
      }
      return (
        editing
          ? await api.put<ProcurementOrder>(`/procurement-orders/${editing.id}`, body)
          : await api.post<ProcurementOrder>('/procurement-orders', body)
      ).data
    },
    onSuccess: (updated: ProcurementOrder) => {
      message.success('已保存')
      replaceCachedPageItem(queryClient, ['procurement'], updated)
      setCreating(false)
      setEditing(null)
      setSelectedRowKeys([])
      form.resetFields()
      invalidate()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    setEditing(null)
    form.resetFields()
    setSelectedRowKeys([])
    form.setFieldsValue({ tax_rate: 13, need_invoice: false, items: [] })
  }

  const openEdit = (row: ProcurementOrder) => {
    setEditing(row)
    setCreating(false)
    setSelectedRowKeys([])
    form.resetFields()
    form.setFieldsValue({
      party_id: row.party_id,
      tax_rate: row.tax_rate ? Number(row.tax_rate) : 13,
      need_invoice: row.need_invoice,
      notes: row.notes,
      items: (row.items ?? []).map((line) => ({
        in_date: dayjs(line.in_date),
        item_id: line.item_id,
        item_spec: line.item_spec,
        quantity: Number(line.quantity),
        unit: line.unit,
        unit_price: Number(line.unit_price),
        owner_id: line.owner_id
      }))
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
      </ListFilters>
      <BusinessTable<ProcurementOrder>
        tableId="procurement"
        toolbarActions={canManage ? <><Button type="primary" onClick={openCreate}>+ 新建采购单</Button><BatchDeleteButton selectedKeys={selectedOrderIds} endpoint="/procurement-orders/batch-delete" entityName="采购单" onSuccess={() => { setSelectedOrderIds([]); invalidate() }} /></> : null}
        rowSelection={{ selectedRowKeys: selectedOrderIds, onChange: (keys) => setSelectedOrderIds(keys as number[]) }}
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
          { title: '物品', width: 200, render: (_, row) => row.items?.map((line) => line.item?.name).filter(Boolean).join('、') || row.item?.name || '—' },
          {
            title: '采购日期',
            dataIndex: 'purchase_date',
            width: 120,
            render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v ?? '—'}</span>
          },
          { title: '明细数', width: 90, align: 'right', render: (_, row) => row.items?.length ?? 1 },
          { title: '数量', width: 150, align: 'right', render: (_, row) => row.items?.map((line) => `${line.quantity}${line.unit}`).join('、') || `${row.quantity}${row.unit}` },
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
        width={1280}
        onCancel={() => {
          setCreating(false)
          setEditing(null)
          setSelectedRowKeys([])
          form.resetFields()
        }}
        onOk={async () => save.mutate(await form.validateFields())}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="party_id" label="供应商" rules={[{ required: true }]}>
            <PartySelect options={partyOptions(parties.data)} placeholder="选择供应商" />
          </Form.Item>
          <Form.List name="items" rules={[{ validator: (_, value) => value?.length ? Promise.resolve() : Promise.reject(new Error('请至少添加一条采购明细')) }]}>
            {(fields, { add, remove }, { errors }) => (
              <div className="compact-line-list procurement-line-list">
                <div className="line-list-toolbar">
                  <div style={{ fontWeight: 600 }}>采购入库明细</div>
                  <Space>
                    <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => add({ in_date: dayjs(), quantity: 0, unit: '吨', unit_price: 0, owner_id: parties.data?.find((party) => party.is_internal)?.id })}>添加物品</Button>
                    <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0} onClick={() => modal.confirm({
                      title: `确认移除选中的 ${selectedRowKeys.length} 条采购明细？`,
                      content: '移除后需保存采购单才会生效。',
                      okButtonProps: { danger: true },
                      onOk: () => {
                        remove(fields.filter((field) => selectedRowKeys.includes(field.key)).map((field) => field.name))
                        setSelectedRowKeys([])
                      }
                    })}>移除所选</Button>
                  </Space>
                </div>
                <div className="line-list-table">
                  <div className="line-list-header procurement-line-grid">
                    <span className="line-select-cell"><Checkbox checked={fields.length > 0 && fields.every((field) => selectedRowKeys.includes(field.key))} indeterminate={fields.some((field) => selectedRowKeys.includes(field.key)) && !fields.every((field) => selectedRowKeys.includes(field.key))} onChange={(event) => setSelectedRowKeys(event.target.checked ? fields.map((field) => field.key) : [])} /></span>
                    <span className="line-index-cell">序号</span>
                    <span>入库日期</span><span>物品</span><span>规格</span><span>数量</span><span>单位</span><span>单价</span><span>归属</span><span>操作</span>
                  </div>
                  {fields.map((field, index) => (
                    <div className="line-editor-row procurement-line-grid" key={field.key}>
                      <span className="line-select-cell"><Checkbox checked={selectedRowKeys.includes(field.key)} onChange={(event) => setSelectedRowKeys((keys) => event.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key))} /></span>
                      <span className="line-index-cell">{index + 1}</span>
                      <Form.Item name={[field.name, 'in_date']} rules={[{ required: true, message: '请选择日期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
                      <Form.Item name={[field.name, 'item_id']} rules={[{ required: true, message: '请选择物品' }]}><ItemSelect options={itemOptions(items.data, itemTypeLabels)} /></Form.Item>
                      <Form.Item name={[field.name, 'item_spec']} rules={[{ required: true, message: '请选择规格' }]}>
                        <SpecificationSelect
                          showSearch
                          optionFilterProp="label"
                          options={specificationOptions}
                          onAddSpecification={() => openSpecificationCreator(['items', field.name, 'item_spec'])}
                          placeholder="选择规格"
                          notFoundContent="暂无规格，请点击下方新增"
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'quantity']} rules={[{ required: true, type: 'number', min: 0.000001, message: '请输入数量' }]}><InputNumber min={0.000001} precision={6} style={{ width: '100%' }} /></Form.Item>
                      <Form.Item name={[field.name, 'unit']} rules={[{ required: true }]}><Select options={UNIT_OPTIONS} /></Form.Item>
                      <Form.Item name={[field.name, 'unit_price']} rules={[{ required: true, message: '请输入单价' }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item>
                      <Form.Item name={[field.name, 'owner_id']} rules={[{ required: true, message: '请选择所属单位' }]}><PartySelect options={partyOptions(parties.data)} placeholder="归属单位" /></Form.Item>
                      <Button type="link" danger size="small" onClick={() => modal.confirm({
                        title: '确认删除这条采购明细？',
                        content: '删除后需保存采购单才会生效。',
                        okButtonProps: { danger: true },
                        onOk: () => {
                          remove(field.name)
                          setSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                        }
                      })}>删除</Button>
                    </div>
                  ))}
                  {fields.length === 0 && <div className="line-list-empty">暂无明细，请点击“添加物品”新增一行</div>}
                </div>
                <Form.ErrorList errors={errors} />
              </div>
            )}
          </Form.List>
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
                { label: '采购日期', value: detail.purchase_date },
                { label: '金额', value: detail.amount },
                { label: '税率', value: detail.tax_rate != null ? `${detail.tax_rate}%` : '—' },
                { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
                { label: '合计', value: detail.total_amount },
                { label: '状态', value: <OrderStatusTag status={detail.status} /> },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
        tables={detail ? [{
          title: '采购入库明细', rowKey: 'id', dataSource: detail.items ?? [],
          columns: [
            { title: '入库日期', dataIndex: 'in_date' },
            { title: '物品', render: (_: any, line: ProcurementItem) => line.item?.name ?? `#${line.item_id}` },
            { title: '规格/品位', dataIndex: 'item_spec', render: (value: string) => value ?? '—' },
            { title: '数量', render: (_: any, line: ProcurementItem) => `${line.quantity} ${line.unit}` },
            { title: '单价', dataIndex: 'unit_price', align: 'right' },
            { title: '金额', dataIndex: 'amount', align: 'right' },
            { title: '归属', render: (_: any, line: ProcurementItem) => line.owner?.name ?? `#${line.owner_id}` }
          ]
        }] : []}
      />
      {specificationCreatorModal}
    </div>
  )
}
