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
import { canManageData } from '../utils/permissions'

const { RangePicker } = DatePicker

type PaymentDirection = 'pay' | 'receive'

interface PartyLite {
  id: number
  name: string
  short_name?: string | null
}

interface Payment {
  id: number
  party_id: number
  party?: PartyLite | null
  direction: PaymentDirection
  pay_date?: string | null
  amount: string
  method?: string | null
  ref_type?: OrderRefType | string | null
  ref_id?: number | null
  linked_orders?: Array<{ ref_type: string; ref_id: number; batch_no?: string | null }> | null
  notes?: string | null
}

interface PaymentFormValues {
  party_id: number
  direction: PaymentDirection
  pay_date?: Dayjs | null
  amount: number
  method?: string | null
  ref_type?: OrderRefType | null
  ref_id?: number | null
  linked_order_keys?: string[]
  notes?: string | null
}

const directionMap: Record<PaymentDirection, { label: string; color: string }> = {
  receive: { label: '收款', color: 'green' },
  pay: { label: '付款', color: 'blue' }
}

const moneyFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function money(value?: string | number | null) {
  const n = Number(value ?? 0)
  return moneyFormatter.format(Number.isFinite(n) ? n : 0)
}

function buildPayload(values: PaymentFormValues, reconciliationRows: ReconciliationOrderRow[]) {
  const rowsByKey = new Map(reconciliationRows.map((row) => [orderKey(row.ref_type, row.ref_id), row]))
  const linkedOrders = linkedOrdersFromKeys(values.linked_order_keys, rowsByKey)
  const firstOrder = firstLinkedOrder(values.linked_order_keys)
  return {
    party_id: values.party_id,
    direction: values.direction,
    pay_date: values.pay_date ? values.pay_date.format('YYYY-MM-DD') : null,
    amount: values.amount ?? 0,
    method: values.method || null,
    ref_type: firstOrder?.ref_type || values.ref_type || null,
    ref_id: firstOrder?.ref_id || values.ref_id || null,
    linked_orders: linkedOrders.length ? linkedOrders : null,
    notes: values.notes || null
  }
}

function rowToForm(row: Payment): PaymentFormValues {
  return {
    party_id: row.party_id,
    direction: row.direction,
    pay_date: row.pay_date ? dayjs(row.pay_date) : null,
    amount: Number(row.amount ?? 0),
    method: row.method ?? '',
    ref_type: (row.ref_type as OrderRefType | null) ?? null,
    ref_id: row.ref_id ?? null,
    linked_order_keys: linkedOrderKeysFromRecord(row),
    notes: row.notes ?? ''
  }
}

export function Payments() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const [partyFilter, setPartyFilter] = useState<number | undefined>()
  const [directionFilter, setDirectionFilter] = useState<PaymentDirection | undefined>()
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Payment | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Payment | null>(null)
  const [form] = Form.useForm<PaymentFormValues>()
  const selectedPartyId = Form.useWatch('party_id', form)

  const parties = useParties()
  const partyOpts = partyOptions(parties.data)

  const query = useQuery({
    queryKey: ['payments', partyFilter, directionFilter, dateRange?.[0]?.format('YYYY-MM-DD'), dateRange?.[1]?.format('YYYY-MM-DD'), search, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<Payment>>('/payments', {
          params: {
            page,
            page_size: pageSize,
            party_id: partyFilter,
            direction: directionFilter,
            date_from: dateRange?.[0]?.format('YYYY-MM-DD'),
            date_to: dateRange?.[1]?.format('YYYY-MM-DD'),
            q: search || undefined
          }
        })
      ).data
  })

  const reconciliationQuery = useQuery({
    queryKey: ['reconciliations', 'payment-linked-orders', selectedPartyId],
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
        const debit = Number(row.debit ?? 0)
        const credit = Number(row.credit ?? 0)
        const amount = Math.max(Number.isFinite(debit) ? debit : 0, Number.isFinite(credit) ? credit : 0)
        return {
          value: orderKey(row.ref_type, row.ref_id),
          label: `${row.biz_date ?? '未定日期'}｜${row.biz_desc ?? '对账记录'}｜¥${money(amount)}`
        }
      }),
    [reconciliationRows]
  )

  const rows = query.data?.items ?? []
  const totalReceive = rows.filter((r) => r.direction === 'receive').reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const totalPay = rows.filter((r) => r.direction === 'pay').reduce((sum, r) => sum + Number(r.amount || 0), 0)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['party'] })
    qc.invalidateQueries({ queryKey: ['reconciliations'] })
  }

  const createMut = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) => api.post('/payments', payload).then((r) => r.data),
    onSuccess: () => {
      message.success('收付款记录已创建')
      invalidateAll()
      setOpen(false)
      form.resetFields()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '创建失败')
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ReturnType<typeof buildPayload> }) =>
      api.put(`/payments/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      message.success('收付款记录已保存')
      invalidateAll()
      setOpen(false)
      setEditing(null)
      form.resetFields()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '保存失败')
  })

  const singleDeleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/payments/${id}`).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      invalidateAll()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '删除失败')
  })

  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.post('/payments/batch-delete', { ids }).then((r) => r.data),
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

  const openEdit = (row: Payment) => {
    setEditing(row)
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
      title: `确认删除选中的 ${selectedIds.length} 条收付款记录？`,
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMut.mutateAsync(selectedIds)
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">收付款记录</h1>
        {canManage && (
          <Space>
            <Button type="primary" onClick={openCreate}>
              + 新建收付款
            </Button>
            <Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>
              批量删除
            </Button>
          </Space>
        )}
      </div>

      <div className="recon-summary-grid">
        <Card size="small">
          <Statistic title="本页收款合计" value={totalReceive} precision={2} prefix="¥" />
        </Card>
        <Card size="small">
          <Statistic title="本页付款合计" value={totalPay} precision={2} prefix="¥" />
        </Card>
        <Card size="small">
          <Statistic title="本页净收付" value={totalReceive - totalPay} precision={2} prefix="¥" />
        </Card>
      </div>

      <Space wrap className="toolbar">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="单位筛选"
          style={{ width: 220 }}
          value={partyFilter}
          onChange={(v) => {
            setPartyFilter(v)
            setPage(1)
          }}
          options={partyOpts}
        />
        <Select
          allowClear
          placeholder="方向筛选"
          style={{ width: 130 }}
          value={directionFilter}
          onChange={(v) => {
            setDirectionFilter(v)
            setPage(1)
          }}
          options={Object.entries(directionMap).map(([value, config]) => ({ value, label: config.label }))}
        />
        <RangePicker
          value={dateRange}
          onChange={(range) => {
            setDateRange(range)
            setPage(1)
          }}
        />
        <Input.Search
          allowClear
          placeholder="搜索单位/方式/备注"
          style={{ width: 240 }}
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

      <Table<Payment>
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
          { title: '日期', dataIndex: 'pay_date', width: 120, render: (v) => v ?? '—' },
          { title: '往来单位', render: (_, row) => row.party?.short_name || row.party?.name || `#${row.party_id}` },
          {
            title: '方向',
            dataIndex: 'direction',
            width: 90,
            render: (value: PaymentDirection) => <Tag color={directionMap[value].color}>{directionMap[value].label}</Tag>
          },
          { title: '金额', dataIndex: 'amount', width: 130, align: 'right', render: (v) => money(v) },
          { title: '方式', dataIndex: 'method', width: 110, render: (v) => v || '—' },
          {
            title: '关联订单',
            width: 220,
            ellipsis: true,
            render: (_, row) => formatLinkedOrders(row)
          },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v || '—' },
          {
            title: '操作',
            width: 190,
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
                          title: '确认删除这条收付款记录？',
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
        title={editing ? '编辑收付款' : '新建收付款'}
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
          initialValues={editing ? rowToForm(editing) : { direction: 'receive', pay_date: dayjs(), amount: 0 }}
        >
          <div className="modal-form-grid">
            <Form.Item name="party_id" label="往来单位" rules={[{ required: true, message: '请选择往来单位' }]}>
              <PartySelect options={partyOpts} placeholder="选择收付款对象" />
            </Form.Item>
            <Form.Item name="direction" label="方向" rules={[{ required: true }]}>
              <Select options={Object.entries(directionMap).map(([value, config]) => ({ value, label: config.label }))} />
            </Form.Item>
            <Form.Item name="pay_date" label="日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="method" label="方式">
              <Input placeholder="电汇 / 电承 / 现金" maxLength={20} />
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
        title="收付款详情"
        fields={
          detail
            ? [
                { label: '日期', value: detail.pay_date },
                { label: '往来单位', value: detail.party?.name || `#${detail.party_id}` },
                { label: '方向', value: directionMap[detail.direction].label },
                { label: '金额', value: `¥${money(detail.amount)}` },
                { label: '方式', value: detail.method },
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
