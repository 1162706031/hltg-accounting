import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag
} from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { api, PageResult } from '../api/client'
import { useAuth } from '../utils/AuthContext'
import { partyOptions, UNIT_OPTIONS, useParties } from '../utils/lookups'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'

type ReconStatus = 'unreconciled' | 'verified' | 'completed' | 'disabled'
type InvoiceDirection = 'issue' | 'receive'
type ImportOrderType = 'smelting_order' | 'outsource_order' | 'procurement_order' | 'sales_order'

interface PartyLite {
  id: number
  name: string
  short_name?: string | null
}

interface ReconciliationRow {
  id: number
  party_id: number
  party?: PartyLite | null
  period: string
  period_start?: string | null
  period_end?: string | null
  ref_type?: ImportOrderType | string | null
  ref_id?: number | null
  line_no: number
  biz_date?: string | null
  biz_desc?: string | null
  steel_grade?: string | null
  quantity: string
  unit: string
  unit_price?: string | null
  debit: string
  credit: string
  invoice_direction?: InvoiceDirection | null
  invoice_amount?: string | null
  recon_status: ReconStatus
  notes?: string | null
}

interface PartyBalance {
  party_id: number
  party_name: string
  total_receivable: string
  total_payable: string
  total_received: string
  total_paid: string
  net_receivable: string
  net_payable: string
  net_to_issue: string
  net_to_receive: string
}

interface ImportCandidate {
  order_type: ImportOrderType
  order_id: number
  type_label: string
  batch_no: string
  party_id: number
  party_name: string
  biz_date?: string | null
  amount: string
  biz_desc: string
  steel_grade?: string | null
  quantity: string
  unit: string
  unit_price?: string | null
  debit: string
  credit: string
  invoice_direction?: InvoiceDirection | null
  invoice_amount?: string | null
  need_invoice: boolean
}

interface ReconciliationFormValues {
  party_id: number
  biz_date?: dayjs.Dayjs | null
  biz_desc?: string | null
  steel_grade?: string | null
  quantity?: number | null
  unit: string
  unit_price?: number | null
  debit?: number | null
  credit?: number | null
  invoice_direction?: InvoiceDirection | null
  invoice_amount?: number | null
  notes?: string | null
}

const statusMap: Record<ReconStatus, { color: string; label: string }> = {
  unreconciled: { color: 'orange', label: '未对账' },
  verified: { color: 'blue', label: '已核对' },
  completed: { color: 'green', label: '已完成/已支付' },
  disabled: { color: 'default', label: '不启用' }
}

const statusOptions = [
  { value: 'unreconciled', label: '未对账' },
  { value: 'verified', label: '已核对' },
  { value: 'completed', label: '已完成/已支付' },
  { value: 'disabled', label: '不启用' }
]

const activeStatusOptions = statusOptions.filter((option) => option.value !== 'disabled')

const importTypeOptions: Array<{ value: ImportOrderType | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'smelting_order', label: '冶炼' },
  { value: 'outsource_order', label: '外协' },
  { value: 'procurement_order', label: '采购' },
  { value: 'sales_order', label: '销售' }
]

const refTypeLabels: Record<string, string> = {
  smelting_order: '冶炼',
  outsource_order: '外协',
  procurement_order: '采购',
  sales_order: '销售'
}

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

function money(value?: string | number | null) {
  const n = Number(value ?? 0)
  return moneyFormatter.format(Number.isFinite(n) ? n : 0)
}

function numeric(value?: string | number | null) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function invoiceLabel(v?: string | null) {
  if (v === 'issue') return '应开发票'
  if (v === 'receive') return '应收发票'
  return '—'
}

function batchLabel(row: ReconciliationRow) {
  const importedBatch = row.notes?.match(/订单\s+(.+?)\s+导入/)?.[1]
  if (importedBatch) return importedBatch
  return row.ref_id ? `#${row.ref_id}` : '手动'
}

function monthPeriod(dateValue?: dayjs.Dayjs | null) {
  const d = dateValue ?? dayjs()
  return {
    period: `${d.year()}年${d.month() + 1}月`,
    period_start: d.startOf('month').format('YYYY-MM-DD'),
    period_end: d.endOf('month').format('YYYY-MM-DD')
  }
}

function buildPayload(values: ReconciliationFormValues) {
  const period = monthPeriod(values.biz_date)
  return {
    ...period,
    party_id: values.party_id,
    line_no: 1,
    biz_date: values.biz_date ? values.biz_date.format('YYYY-MM-DD') : null,
    biz_desc: values.biz_desc || null,
    steel_grade: values.steel_grade || null,
    quantity: values.quantity ?? 0,
    unit: values.unit || '吨',
    unit_price: values.unit_price ?? null,
    debit: values.debit ?? 0,
    credit: values.credit ?? 0,
    invoice_direction: values.invoice_direction || null,
    invoice_amount: values.invoice_amount ?? null,
    notes: values.notes || null
  }
}

function rowToForm(row: ReconciliationRow): ReconciliationFormValues {
  return {
    party_id: row.party_id,
    biz_date: row.biz_date ? dayjs(row.biz_date) : null,
    biz_desc: row.biz_desc ?? '',
    steel_grade: row.steel_grade ?? '',
    quantity: numeric(row.quantity),
    unit: row.unit || '吨',
    unit_price: row.unit_price == null ? null : numeric(row.unit_price),
    debit: numeric(row.debit),
    credit: numeric(row.credit),
    invoice_direction: row.invoice_direction ?? null,
    invoice_amount: row.invoice_amount == null ? null : numeric(row.invoice_amount),
    notes: row.notes ?? ''
  }
}

export function Reconciliation() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const partiesQuery = useParties()

  const [partyId, setPartyId] = useState<number | undefined>()
  const [statusFilter, setStatusFilter] = useState<ReconStatus | undefined>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<ReconciliationRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importType, setImportType] = useState<ImportOrderType | 'all'>('all')
  const [importSearch, setImportSearch] = useState('')
  const [selectedImportKeys, setSelectedImportKeys] = useState<string[]>([])
  const [form] = Form.useForm<ReconciliationFormValues>()

  const query = useQuery({
    queryKey: ['reconciliations', partyId, statusFilter, search, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (partyId) params.party_id = partyId
      if (statusFilter) params.recon_status = statusFilter
      if (search) params.q = search
      return (await api.get<PageResult<ReconciliationRow>>('/reconciliations', { params })).data
    }
  })

  const balanceQuery = useQuery({
    queryKey: ['reconciliations', 'balances'],
    queryFn: async () => (await api.get<PartyBalance[]>('/reconciliations/balances')).data
  })

  const importQuery = useQuery({
    queryKey: ['reconciliations', 'import-candidates', importOpen, importType, partyId, importSearch],
    enabled: importOpen,
    queryFn: async () => {
      const params: Record<string, string | number> = { order_type: importType }
      if (partyId) params.party_id = partyId
      if (importSearch) params.q = importSearch
      return (await api.get<ImportCandidate[]>('/reconciliations/import-candidates', { params })).data
    }
  })

  const rows = query.data?.items ?? []
  const activeRows = rows.filter((row) => ['unreconciled', 'verified'].includes(row.recon_status))
  const selectedPartyName = partyId
    ? partiesQuery.data?.find((p) => p.id === partyId)?.name ?? `#${partyId}`
    : '全部单位'

  const rowSummary = useMemo(
    () => ({
      debit: activeRows.reduce((sum, row) => sum + numeric(row.debit), 0),
      credit: activeRows.reduce((sum, row) => sum + numeric(row.credit), 0),
      issue: activeRows.reduce((sum, row) => sum + (row.invoice_direction === 'issue' ? numeric(row.invoice_amount) : 0), 0),
      receive: activeRows.reduce((sum, row) => sum + (row.invoice_direction === 'receive' ? numeric(row.invoice_amount) : 0), 0)
    }),
    [activeRows]
  )

  const balanceSummary = useMemo(() => {
    const balances = balanceQuery.data ?? []
    if (partyId) {
      return balances.find((b) => b.party_id === partyId)
    }
    return balances.reduce<PartyBalance>(
      (sum, row) => ({
        party_id: 0,
        party_name: '全部单位',
        total_receivable: String(numeric(sum.total_receivable) + numeric(row.total_receivable)),
        total_payable: String(numeric(sum.total_payable) + numeric(row.total_payable)),
        total_received: String(numeric(sum.total_received) + numeric(row.total_received)),
        total_paid: String(numeric(sum.total_paid) + numeric(row.total_paid)),
        net_receivable: String(numeric(sum.net_receivable) + numeric(row.net_receivable)),
        net_payable: String(numeric(sum.net_payable) + numeric(row.net_payable)),
        net_to_issue: String(numeric(sum.net_to_issue) + numeric(row.net_to_issue)),
        net_to_receive: String(numeric(sum.net_to_receive) + numeric(row.net_to_receive))
      }),
      {
        party_id: 0,
        party_name: '全部单位',
        total_receivable: '0',
        total_payable: '0',
        total_received: '0',
        total_paid: '0',
        net_receivable: '0',
        net_payable: '0',
        net_to_issue: '0',
        net_to_receive: '0'
      }
    )
  }, [balanceQuery.data, partyId])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['reconciliations'] })
    qc.invalidateQueries({ queryKey: ['party'] })
  }

  const createMut = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) => api.post('/reconciliations', payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已创建对账明细')
      invalidateAll()
      setFormOpen(false)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '创建失败')
    }
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ReturnType<typeof buildPayload> }) =>
      api.put(`/reconciliations/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已保存对账明细')
      invalidateAll()
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '保存失败')
    }
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/reconciliations/${id}`).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      invalidateAll()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '删除失败')
    }
  })

  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.post('/reconciliations/batch-delete', { ids }).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      invalidateAll()
      setSelectedIds([])
    }
  })

  const updateStatusMut = useMutation({
    mutationFn: ({ id, reconStatus }: { id: number; reconStatus: ReconStatus }) =>
      api.put(`/reconciliations/${id}/status`, { recon_status: reconStatus }).then((r) => r.data),
    onSuccess: () => {
      message.success('状态已更新')
      invalidateAll()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '状态更新失败')
    }
  })

  const importMut = useMutation({
    mutationFn: ({ orderType, orderIds }: { orderType: ImportOrderType; orderIds: number[] }) =>
      api.post('/reconciliations/import', { order_type: orderType, order_ids: orderIds }).then((r) => r.data),
    onSuccess: (res: { imported_count: number; skipped_count: number }) => {
      message.success(`已导入 ${res.imported_count} 条，跳过 ${res.skipped_count} 条`)
      invalidateAll()
      setImportOpen(false)
      setSelectedImportKeys([])
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '导入失败')
    }
  })

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (row: ReconciliationRow) => {
    setEditing(row)
    setFormOpen(true)
  }

  const submitForm = () => {
    form.validateFields().then((values) => {
      const payload = buildPayload(values)
      if (editing) {
        updateMut.mutate({ id: editing.id, payload })
      } else {
        createMut.mutate(payload)
      }
    })
  }

  const handleBatchDelete = () => {
    if (!selectedIds.length) return
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 条对账明细？`,
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMut.mutateAsync(selectedIds)
    })
  }

  const importRows = importQuery.data ?? []
  const importPreview = importRows.filter((row) => selectedImportKeys.includes(`${row.order_type}:${row.order_id}`))
  const importTotals = {
    debit: importPreview.reduce((sum, row) => sum + numeric(row.debit), 0),
    credit: importPreview.reduce((sum, row) => sum + numeric(row.credit), 0),
    issue: importPreview.reduce((sum, row) => sum + (row.invoice_direction === 'issue' ? numeric(row.invoice_amount) : 0), 0),
    receive: importPreview.reduce((sum, row) => sum + (row.invoice_direction === 'receive' ? numeric(row.invoice_amount) : 0), 0)
  }

  const confirmImport = () => {
    if (!selectedImportKeys.length) return
    const selectedTypes = new Set(selectedImportKeys.map((key) => key.split(':')[0] as ImportOrderType))
    if (selectedTypes.size !== 1) {
      message.error('请一次只选择同一种订单类型导入')
      return
    }
    const orderType = [...selectedTypes][0]
    const orderIds = selectedImportKeys.map((key) => Number(key.split(':')[1]))
    importMut.mutate({ orderType, orderIds })
  }

  return (
    <div className="page reconciliation-page">
      <div className="page-header">
        <h1 className="page-title">用户对账</h1>
        {canManage && (
          <Space>
            <Button type="primary" onClick={openCreate}>
              + 新建明细
            </Button>
            <Button onClick={() => setImportOpen(true)}>+ 从订单导入</Button>
            <Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>
              批量删除
            </Button>
          </Space>
        )}
      </div>

      <Card size="small">
        <Space wrap className="toolbar">
          <Select
            allowClear
            showSearch
            placeholder="往来单位"
            style={{ width: 260 }}
            value={partyId}
            onChange={(v) => {
              setPartyId(v)
              setPage(1)
            }}
            optionFilterProp="label"
            options={partyOptions(partiesQuery.data)}
          />
          <Select<ReconStatus>
            allowClear
            placeholder="状态筛选"
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
            options={statusOptions}
          />
          <Input.Search
            allowClear
            placeholder="搜索批次号/摘要/钢种/备注"
            style={{ width: 260 }}
            onSearch={(v) => {
              setSearch(v)
              setPage(1)
            }}
            onChange={(e) => {
              if (!e.target.value) {
                setSearch('')
                setPage(1)
              }
            }}
          />
        </Space>
      </Card>

      <div className="recon-summary-grid">
        <Card size="small" title={`业务合计 - ${selectedPartyName}`}>
          <div className="summary-pair-grid">
            <Statistic title="应收总计" value={money(rowSummary.debit)} prefix="¥" />
            <Statistic title="应付总计" value={money(rowSummary.credit)} prefix="¥" />
            <Statistic title="业务余额" value={money(rowSummary.debit - rowSummary.credit)} prefix="¥" />
            <Statistic title="计入统计明细" value={activeRows.length} suffix="条" />
          </div>
        </Card>
        <Card size="small" title="实际收付/开票">
          <div className="summary-pair-grid">
            <Statistic title="已收款项" value={money(balanceSummary?.total_received)} prefix="¥" />
            <Statistic title="已付款项" value={money(balanceSummary?.total_paid)} prefix="¥" />
            <Statistic title="应开发票合计" value={money(rowSummary.issue)} prefix="¥" />
            <Statistic title="应收发票合计" value={money(rowSummary.receive)} prefix="¥" />
          </div>
        </Card>
        <Card size="small" title="净额">
          <div className="summary-pair-grid">
            <Statistic title="应收未收" value={money(balanceSummary?.net_receivable)} prefix="¥" />
            <Statistic title="应付未付" value={money(balanceSummary?.net_payable)} prefix="¥" />
            <Statistic title="应开未开发票" value={money(balanceSummary?.net_to_issue)} prefix="¥" />
            <Statistic title="应收未收发票" value={money(balanceSummary?.net_to_receive)} prefix="¥" />
          </div>
        </Card>
      </div>

      <Table<ReconciliationRow>
        rowKey="id"
        loading={query.isLoading}
        dataSource={rows}
        size="middle"
        scroll={{ x: 1450 }}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as number[])
              }
            : undefined
        }
        columns={[
          { title: '#', dataIndex: 'id', width: 70 },
          { title: '批次', dataIndex: 'ref_id', width: 110, render: (_, row) => batchLabel(row) },
          { title: '类型', dataIndex: 'ref_type', width: 90, render: (v) => (v ? refTypeLabels[v] ?? v : '手动') },
          { title: '单位', width: 150, render: (_, row) => row.party?.short_name || row.party?.name || `#${row.party_id}` },
          { title: '日期', dataIndex: 'biz_date', width: 120, render: (v) => v ?? '—' },
          { title: '摘要', dataIndex: 'biz_desc', width: 180, ellipsis: true, render: (v) => v ?? '—' },
          { title: '钢种', dataIndex: 'steel_grade', width: 90, render: (v) => v ?? '—' },
          { title: '数量', width: 100, align: 'right', render: (_, row) => `${Number(row.quantity || 0).toLocaleString('zh-CN')}${row.unit || ''}` },
          { title: '单价', dataIndex: 'unit_price', width: 100, align: 'right', render: (v) => (v == null ? '—' : money(v)) },
          { title: '应收', dataIndex: 'debit', width: 110, align: 'right', render: (v) => money(v) },
          { title: '应付', dataIndex: 'credit', width: 110, align: 'right', render: (v) => money(v) },
          { title: '余额', width: 110, align: 'right', render: (_, row) => money(numeric(row.debit) - numeric(row.credit)) },
          { title: '发票类型', dataIndex: 'invoice_direction', width: 110, render: (v) => invoiceLabel(v) },
          { title: '发票金额', dataIndex: 'invoice_amount', width: 110, align: 'right', render: (v) => (v == null ? '—' : money(v)) },
          {
            title: '状态',
            dataIndex: 'recon_status',
            width: 130,
            render: (value: ReconStatus) => <Tag color={statusMap[value].color}>{statusMap[value].label}</Tag>
          },
          { title: '备注', dataIndex: 'notes', width: 160, ellipsis: true, render: (v) => v ?? '—' },
          ...(canManage
            ? [
                {
                  title: '操作',
                  fixed: 'right' as const,
                  width: 310,
                  render: (_: unknown, row: ReconciliationRow) => (
                    <Space size="small" wrap>
                      <Switch
                        size="small"
                        checked={row.recon_status !== 'disabled'}
                        checkedChildren="启用"
                        unCheckedChildren="停用"
                        loading={updateStatusMut.isPending && updateStatusMut.variables?.id === row.id}
                        onChange={(checked) =>
                          updateStatusMut.mutate({
                            id: row.id,
                            reconStatus: checked ? 'unreconciled' : 'disabled'
                          })
                        }
                      />
                      <Select<ReconStatus>
                        size="small"
                        value={row.recon_status === 'disabled' ? undefined : row.recon_status}
                        placeholder="状态"
                        style={{ width: 104 }}
                        disabled={row.recon_status === 'disabled'}
                        loading={updateStatusMut.isPending && updateStatusMut.variables?.id === row.id}
                        onChange={(value) => updateStatusMut.mutate({ id: row.id, reconStatus: value })}
                        options={activeStatusOptions}
                      />
                      <Button size="small" onClick={() => openEdit(row)}>
                        编辑
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          modal.confirm({
                            title: '确认删除这条对账明细？',
                            okButtonProps: { danger: true },
                            onOk: () => deleteMut.mutateAsync(row.id)
                          })
                        }
                      >
                        删除
                      </Button>
                    </Space>
                  )
                }
              ]
            : [])
        ]}
      />

      <Modal
        title={editing ? '编辑对账明细' : '新建对账明细'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={submitForm}
        width={760}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form<ReconciliationFormValues>
          key={editing ? `edit-${editing.id}` : 'create'}
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={
            editing
              ? rowToForm(editing)
              : {
                  party_id: partyId,
                  biz_date: dayjs(),
                  quantity: 0,
                  unit: '吨',
                  debit: 0,
                  credit: 0
                }
          }
        >
          <div className="modal-form-grid">
            <Form.Item name="party_id" label="往来单位" rules={[{ required: true, message: '请选择往来单位' }]}>
              <Select showSearch optionFilterProp="label" options={partyOptions(partiesQuery.data)} />
            </Form.Item>
            <Form.Item name="biz_date" label="业务日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="grid-span-2" name="biz_desc" label="业务摘要" rules={[{ required: true, message: '请输入业务摘要' }]}>
              <Input placeholder="如 冶炼加工费+合金、采购低铬、销售H13" />
            </Form.Item>
            <Form.Item name="steel_grade" label="钢种/物品">
              <Input placeholder="文字快照，可选" />
            </Form.Item>
            <Form.Item name="quantity" label="数量">
              <InputNumber min={0} precision={3} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="unit" label="单位">
              <Select options={UNIT_OPTIONS} />
            </Form.Item>
            <Form.Item name="unit_price" label="单价">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="debit" label="应收款">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="credit" label="应付款">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="invoice_direction" label="发票类型">
              <Select
                allowClear
                options={[
                  { value: 'issue', label: '应开发票' },
                  { value: 'receive', label: '应收发票' }
                ]}
              />
            </Form.Item>
            <Form.Item name="invoice_amount" label="发票金额">
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="grid-span-2" name="notes" label="备注">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <div className="form-hint">收付款和实际开票在独立页面记录；这里的发票金额只是应计提示。</div>
        </Form>
      </Modal>

      <Modal
        title={`从订单导入 - 已选 ${selectedImportKeys.length} 项`}
        open={importOpen}
        onCancel={() => {
          setImportOpen(false)
          setSelectedImportKeys([])
        }}
        onOk={confirmImport}
        okText={`确认导入 (${selectedImportKeys.length}项)`}
        okButtonProps={{ disabled: !selectedImportKeys.length }}
        confirmLoading={importMut.isPending}
        width={980}
        destroyOnClose
      >
        <Space wrap className="toolbar" style={{ marginBottom: 12 }}>
          <Select
            placeholder="类型"
            style={{ width: 150 }}
            value={importType}
            onChange={(v) => {
              setImportType(v)
              setSelectedImportKeys([])
            }}
            options={importTypeOptions}
          />
          <Select
            allowClear
            showSearch
            placeholder="往来单位"
            style={{ width: 240 }}
            value={partyId}
            onChange={(v) => setPartyId(v)}
            optionFilterProp="label"
            options={partyOptions(partiesQuery.data)}
          />
          <Input.Search allowClear placeholder="搜索批次号" style={{ width: 220 }} onSearch={setImportSearch} />
        </Space>

        <Table<ImportCandidate>
          rowKey={(row) => `${row.order_type}:${row.order_id}`}
          size="small"
          loading={importQuery.isLoading}
          dataSource={importRows}
          pagination={{ pageSize: 6 }}
          rowSelection={{
            selectedRowKeys: selectedImportKeys,
            onChange: (keys) => setSelectedImportKeys(keys as string[])
          }}
          columns={[
            { title: '类型', dataIndex: 'type_label', width: 80 },
            { title: '批次', dataIndex: 'batch_no', width: 120 },
            { title: '单位', dataIndex: 'party_name', width: 140 },
            { title: '日期', dataIndex: 'biz_date', width: 110, render: (v) => v ?? '—' },
            { title: '摘要', dataIndex: 'biz_desc', ellipsis: true },
            { title: '应收', dataIndex: 'debit', width: 100, align: 'right', render: (v) => money(v) },
            { title: '应付', dataIndex: 'credit', width: 100, align: 'right', render: (v) => money(v) },
            { title: '发票类型', dataIndex: 'invoice_direction', width: 100, render: (v) => invoiceLabel(v) },
            { title: '发票金额', dataIndex: 'invoice_amount', width: 110, align: 'right', render: (v) => (v == null ? '—' : money(v)) }
          ]}
        />

        <Card size="small" title="导入预览" style={{ marginTop: 12 }}>
          <Descriptions size="small" column={4}>
            <Descriptions.Item label="应收合计">¥{money(importTotals.debit)}</Descriptions.Item>
            <Descriptions.Item label="应付合计">¥{money(importTotals.credit)}</Descriptions.Item>
            <Descriptions.Item label="应开发票合计">¥{money(importTotals.issue)}</Descriptions.Item>
            <Descriptions.Item label="应收发票合计">¥{money(importTotals.receive)}</Descriptions.Item>
          </Descriptions>
          <Table<ImportCandidate>
            rowKey={(row) => `${row.order_type}:${row.order_id}`}
            size="small"
            dataSource={importPreview}
            pagination={false}
            locale={{ emptyText: '请选择要导入的订单' }}
            columns={[
              { title: '类型', dataIndex: 'type_label', width: 80 },
              { title: '批次', dataIndex: 'batch_no', width: 120 },
              { title: '摘要', dataIndex: 'biz_desc' },
              { title: '应收', dataIndex: 'debit', width: 100, align: 'right', render: (v) => money(v) },
              { title: '应付', dataIndex: 'credit', width: 100, align: 'right', render: (v) => money(v) },
              { title: '发票类型', dataIndex: 'invoice_direction', width: 100, render: (v) => invoiceLabel(v) },
              { title: '发票金额', dataIndex: 'invoice_amount', width: 110, align: 'right', render: (v) => (v == null ? '—' : money(v)) }
            ]}
          />
          <div className="form-hint">导入后状态默认为未对账；实际收付款和实际发票请在对应页面补充。</div>
        </Card>
      </Modal>
    </div>
  )
}
