import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import { api, PageResult } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
import { DetailModal } from '../components/DetailModal'
import { PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import {
  firstLinkedOrder,
  formatLinkedOrders,
  linkedOrderKeysFromRecord,
  linkedOrdersFromKeys,
  orderKey,
  OrderRefType,
  ReconciliationOrderRow,
  refTypeOptions
} from '../utils/linkedOrders'
import { partyOptions, useParties } from '../utils/lookups'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { replaceCachedPageItem } from '../utils/queryCache'
import { canManageData } from '../utils/permissions'

const { RangePicker } = DatePicker

type InvoiceDirection = 'issue' | 'receive'

interface PartyLite {
  id: number
  name: string
  short_name?: string | null
}

interface Invoice {
  id: number
  party_id: number
  party?: PartyLite | null
  direction: InvoiceDirection
  invoice_date?: string | null
  invoice_no?: string | null
  amount: string
  ref_type?: OrderRefType | string | null
  ref_id?: number | null
  linked_orders?: Array<{ ref_type: string; ref_id: number; batch_no?: string | null }> | null
  notes?: string | null
}

interface InvoiceFormValues {
  party_id: number
  direction: InvoiceDirection
  invoice_date?: Dayjs | null
  invoice_no?: string | null
  amount: number
  ref_type?: OrderRefType | null
  ref_id?: number | null
  linked_order_keys?: string[]
  notes?: string | null
}

const directionMap: Record<InvoiceDirection, { label: string; color: string }> = {
  issue: { label: '往来单位已收发票', color: 'purple' },
  receive: { label: '往来单位已开发票', color: 'cyan' }
}

const moneyFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function money(value?: string | number | null) {
  const n = Number(value ?? 0)
  return moneyFormatter.format(Number.isFinite(n) ? n : 0)
}

function buildPayload(values: InvoiceFormValues, reconciliationRows: ReconciliationOrderRow[]) {
  const rowsByKey = new Map(reconciliationRows.map((row) => [orderKey(row.ref_type, row.ref_id), row]))
  const linkedOrders = linkedOrdersFromKeys(values.linked_order_keys, rowsByKey)
  const firstOrder = firstLinkedOrder(values.linked_order_keys)
  return {
    party_id: values.party_id,
    direction: values.direction,
    invoice_date: values.invoice_date ? values.invoice_date.format('YYYY-MM-DD') : null,
    invoice_no: values.invoice_no || null,
    amount: values.amount ?? 0,
    ref_type: firstOrder?.ref_type || values.ref_type || null,
    ref_id: firstOrder?.ref_id || values.ref_id || null,
    linked_orders: linkedOrders.length ? linkedOrders : null,
    notes: values.notes || null
  }
}

function rowToForm(row: Invoice): InvoiceFormValues {
  return {
    party_id: row.party_id,
    direction: row.direction,
    invoice_date: row.invoice_date ? dayjs(row.invoice_date) : null,
    invoice_no: row.invoice_no ?? '',
    amount: Number(row.amount ?? 0),
    ref_type: (row.ref_type as OrderRefType | null) ?? null,
    ref_id: row.ref_id ?? null,
    linked_order_keys: linkedOrderKeysFromRecord(row),
    notes: row.notes ?? ''
  }
}

export function Invoices() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const [partyFilter, setPartyFilter] = useState<number | undefined>()
  const [directionFilter, setDirectionFilter] = useState<InvoiceDirection | undefined>()
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [search, setSearch] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ party: undefined as number | undefined, direction: undefined as InvoiceDirection | undefined, dateFrom: '', dateTo: '', search: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [form] = Form.useForm<InvoiceFormValues>()
  const selectedPartyId = Form.useWatch('party_id', form)

  const parties = useParties()
  const partyOpts = partyOptions(parties.data)

  const query = useQuery({
    queryKey: ['invoices', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<Invoice>>('/invoices', {
          params: {
            page,
            page_size: pageSize,
            party_id: appliedFilters.party,
            direction: appliedFilters.direction,
            date_from: appliedFilters.dateFrom || undefined,
            date_to: appliedFilters.dateTo || undefined,
            q: appliedFilters.search || undefined
          }
        })
      ).data
  })

  const reconciliationQuery = useQuery({
    queryKey: ['reconciliations', 'invoice-linked-orders', selectedPartyId],
    enabled: open && Boolean(selectedPartyId),
    queryFn: async () =>
      (
        await api.get<PageResult<ReconciliationOrderRow>>('/reconciliations', {
          params: { page: 1, page_size: 200, party_id: selectedPartyId }
        })
      ).data
  })

  const reconciliationRows = useMemo(
    () =>
      (reconciliationQuery.data?.items ?? []).filter(
        (row) => row.ref_type && row.ref_id && row.recon_status !== 'disabled'
      ),
    [reconciliationQuery.data?.items]
  )

  const reconciliationOptions = useMemo(
    () =>
      reconciliationRows.map((row) => {
        const invoiceAmount = Number(row.invoice_amount ?? 0)
        const debit = Number(row.debit ?? 0)
        const credit = Number(row.credit ?? 0)
        const amount = invoiceAmount || Math.max(Number.isFinite(debit) ? debit : 0, Number.isFinite(credit) ? credit : 0)
        return {
          value: orderKey(row.ref_type, row.ref_id),
          label: `${row.biz_date ?? '未定日期'}｜${row.biz_desc ?? '对账记录'}｜¥${money(amount)}`
        }
      }),
    [reconciliationRows]
  )

  const rows = query.data?.items ?? []
  const totalIssue = rows.filter((r) => r.direction === 'issue').reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const totalReceive = rows.filter((r) => r.direction === 'receive').reduce((sum, r) => sum + Number(r.amount || 0), 0)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['party'] })
    qc.invalidateQueries({ queryKey: ['reconciliations'] })
  }

  const createMut = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) => api.post('/invoices', payload).then((r) => r.data),
    onSuccess: () => {
      message.success('开票记录已创建')
      invalidateAll()
      setOpen(false)
      form.resetFields()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '创建失败')
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ReturnType<typeof buildPayload> }) =>
      api.put(`/invoices/${id}`, payload).then((r) => r.data),
    onSuccess: (updated: Invoice) => {
      message.success('开票记录已保存')
      replaceCachedPageItem(qc, ['invoices'], updated)
      invalidateAll()
      setOpen(false)
      setEditing(null)
      form.resetFields()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '保存失败')
  })

  const singleDeleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/invoices/${id}`).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      invalidateAll()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '删除失败')
  })

  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.post('/invoices/batch-delete', { ids }).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      setSelectedIds([])
      invalidateAll()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '批量删除失败')
  })

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (row: Invoice) => {
    setEditing(row)
    form.resetFields()
    form.setFieldsValue(rowToForm(row))
    setOpen(true)
  }

  const submitForm = () => {
    form.validateFields().then((values) => {
      const payload = buildPayload(values, reconciliationRows)
      if (editing) updateMut.mutate({ id: editing.id, payload })
      else createMut.mutate(payload)
    })
  }

  const handleBatchDelete = () => {
    if (!selectedIds.length) return
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 条开票记录？`,
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMut.mutateAsync(selectedIds)
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">开票记录</h1>
      </div>

      <div className="recon-summary-grid">
        <Card size="small">
          <Statistic title="本页已开发票" value={totalIssue} precision={2} prefix="¥" />
        </Card>
        <Card size="small">
          <Statistic title="本页已收发票" value={totalReceive} precision={2} prefix="¥" />
        </Card>
        <Card size="small">
          <Statistic title="本页开收净额" value={totalIssue - totalReceive} precision={2} prefix="¥" />
        </Card>
      </div>

      <ListFilters>
        <div className="filter-item"><span>单位：</span>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="单位筛选"
          style={{ width: 220 }}
          value={partyFilter}
          onChange={setPartyFilter}
          options={partyOpts}
        /></div>
        <div className="filter-item"><span>方向：</span>
        <Select
          allowClear
          placeholder="方向筛选"
          style={{ width: 140 }}
          value={directionFilter}
          onChange={setDirectionFilter}
          options={Object.entries(directionMap).map(([value, config]) => ({ value, label: config.label }))}
        /></div>
        <div className="filter-item"><span>日期：</span>
        <RangePicker
          value={dateRange}
          onChange={setDateRange}
        /></div>
        <div className="filter-item"><span>关键词：</span>
        <Input
          allowClear
          value={search}
          placeholder="搜索单位/发票号/备注"
          style={{ width: 240 }}
          onChange={(e) => setSearch(e.target.value)}
        /></div>
        <div className="filter-actions"><Button type="primary" onClick={() => {
          setAppliedFilters({ party: partyFilter, direction: directionFilter, dateFrom: dateRange?.[0]?.format('YYYY-MM-DD') ?? '', dateTo: dateRange?.[1]?.format('YYYY-MM-DD') ?? '', search: search.trim() }); setPage(1)
        }}>查询</Button>
        <Button onClick={() => {
          setPartyFilter(undefined); setDirectionFilter(undefined); setDateRange(null); setSearch('')
          setAppliedFilters({ party: undefined, direction: undefined, dateFrom: '', dateTo: '', search: '' }); setPage(1)
        }}>重置</Button></div>
      </ListFilters>

      <BusinessTable<Invoice>
        tableId="invoices"
        toolbarActions={canManage ? <><Button type="primary" onClick={openCreate}>+ 新建开票</Button><Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>批量删除</Button></> : null}
        rowKey="id"
        loading={query.isLoading}
        dataSource={rows}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        scroll={{ x: 1180 }}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as number[])
              }
            : undefined
        }
        columns={[
          { title: '日期', dataIndex: 'invoice_date', width: 120, render: (v) => v ?? '—' },
          { title: '往来单位', render: (_, row) => row.party?.short_name || row.party?.name || `#${row.party_id}` },
          {
            title: '方向',
            dataIndex: 'direction',
            width: 110,
            render: (value: InvoiceDirection) => <Tag color={directionMap[value].color}>{directionMap[value].label}</Tag>
          },
          { title: '发票号', dataIndex: 'invoice_no', width: 160, render: (v) => v || '—' },
          { title: '金额', dataIndex: 'amount', width: 130, align: 'right', render: (v) => money(v) },
          {
            title: '关联订单',
            width: 220,
            ellipsis: true,
            render: (_, row) => formatLinkedOrders(row)
          },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v || '—' },
          {
            title: '操作',
            fixed: 'right' as const,
            width: canManage ? 190 : 80,
            render: (_, row) => (
              <Space size="small">
                <Button size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                {canManage && (
                  <>
                    <Button size="small" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        modal.confirm({
                          title: '确认删除这条开票记录？',
                          okButtonProps: { danger: true },
                          onOk: () => singleDeleteMut.mutateAsync(row.id)
                        })
                      }
                    >
                      删除
                    </Button>
                  </>
                )}
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editing ? '编辑开票' : '新建开票'}
        open={open}
        onCancel={() => {
          setOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={submitForm}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
        width={720}
      >
        <Form
          key={editing ? `edit-${editing.id}` : 'create'}
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editing ? rowToForm(editing) : { direction: 'issue', invoice_date: dayjs(), amount: 0 }}
        >
          <div className="modal-form-grid">
            <Form.Item name="party_id" label="往来单位" rules={[{ required: true, message: '请选择往来单位' }]}>
              <PartySelect options={partyOpts} placeholder="选择开票对象" />
            </Form.Item>
            <Form.Item name="direction" label="方向（按往来单位)" rules={[{ required: true }]}>
              <Select options={Object.entries(directionMap).map(([value, config]) => ({ value, label: config.label }))} />
            </Form.Item>
            <Form.Item name="invoice_date" label="日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="invoice_no" label="发票号">
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="linked_order_keys" label="从用户对账记录导入关联订单" className="grid-span-2">
              <Select
                allowClear
                mode="multiple"
                loading={reconciliationQuery.isFetching}
                disabled={!selectedPartyId}
                placeholder={selectedPartyId ? '选择已导入用户对账记录' : '请先选择往来单位'}
                options={reconciliationOptions}
                onChange={(keys) => {
                  const firstOrder = firstLinkedOrder(keys)
                  if (firstOrder) {
                    form.setFieldsValue({ ref_type: firstOrder.ref_type as OrderRefType, ref_id: firstOrder.ref_id })
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="ref_type" label="手动关联订单类型">
              <Select allowClear options={refTypeOptions} />
            </Form.Item>
            <Form.Item name="ref_id" label="手动关联订单ID">
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="notes" label="备注" className="grid-span-2">
              <Input.TextArea rows={3} maxLength={200} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="开票详情"
        fields={
          detail
            ? [
                { label: '日期', value: detail.invoice_date },
                { label: '往来单位', value: detail.party?.name || `#${detail.party_id}` },
                { label: '方向', value: directionMap[detail.direction].label },
                { label: '发票号', value: detail.invoice_no },
                { label: '金额', value: `¥${money(detail.amount)}` },
                {
                  label: '关联订单',
                  value: formatLinkedOrders(detail)
                },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
