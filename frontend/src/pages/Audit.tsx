import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Modal, Select, Space, Table, Tag } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { DetailModal, type DetailField, type DetailTable } from '../components/DetailModal'
import { OrderStatusTag } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, localTablePagination } from '../utils/pagination'

interface PendingAudit {
  order_kind: 'smelting' | 'outsource' | 'procurement' | 'sales'
  order_id: number
  batch_no: string
  party_name?: string | null
  amount?: number | null
  created_by?: number | null
  created_by_name?: string | null
  created_at?: string | null
  status: 'pending_review'
}

const KIND_META: Record<PendingAudit['order_kind'], { label: string; color: string; path: string }> = {
  smelting: { label: '冶炼', color: 'purple', path: 'smelting-orders' },
  outsource: { label: '外协', color: 'geekblue', path: 'outsource-orders' },
  procurement: { label: '采购', color: 'gold', path: 'procurement-orders' },
  sales: { label: '销售', color: 'green', path: 'sales-orders' }
}

const SMELTING_TYPE_LABELS: Record<string, string> = { ext_smelting: '外部冶炼', inhouse: '本厂冶炼' }
const PROCESS_TYPE_LABELS: Record<string, string> = { forging: '锻造', esr: '电渣', turning: '车加工', annealing: '退火' }

function auditDetailFields(target: PendingAudit | null, detail: any): DetailField[] {
  if (!target || !detail) return []
  const common: DetailField[] = [
    { label: '批次号', value: detail.batch_no },
    { label: '往来单位', value: detail.party?.name ?? target.party_name },
    { label: '合计', value: detail.total_amount },
    { label: '状态', value: <OrderStatusTag status={detail.status} /> }
  ]
  if (target.order_kind === 'procurement') {
    return [
      ...common,
      { label: '采购日期', value: detail.purchase_date },
      { label: '小计', value: detail.subtotal },
      { label: '税额', value: detail.tax_amount },
      { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
      { label: '备注', value: detail.notes, span: 2 }
    ]
  }
  if (target.order_kind === 'sales') {
    return [
      ...common,
      { label: '整单发货日期', value: detail.ship_date },
      { label: '小计', value: detail.subtotal },
      { label: '税额', value: detail.tax_amount },
      { label: '税率', value: detail.tax_rate != null ? `${detail.tax_rate}%` : '—' },
      { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
      { label: '备注', value: detail.notes, span: 2 }
    ]
  }
  if (target.order_kind === 'smelting') {
    return [
      ...common,
      { label: '类型', value: SMELTING_TYPE_LABELS[detail.order_type] ?? detail.order_type },
      { label: '投料日期', value: detail.feed_date },
      { label: '出钢日期', value: detail.tap_date },
      { label: '成锭率', value: detail.yield_pct != null ? `${detail.yield_pct}%` : '—' },
      { label: '加工单价', value: detail.unit_price },
      { label: '加工费', value: detail.processing_amount },
      { label: '小计', value: detail.subtotal },
      { label: '税额', value: detail.tax_amount },
      { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
      { label: '备注', value: detail.notes, span: 2 }
    ]
  }
  return [
    ...common,
    { label: '工艺', value: PROCESS_TYPE_LABELS[detail.process_type] ?? detail.process_type },
    { label: '发出日期', value: detail.out_date },
    { label: '回厂日期', value: detail.in_date },
    { label: '成材率', value: detail.yield_rate != null ? `${(Number(detail.yield_rate) * 100).toFixed(2)}%` : '—' },
    { label: '加工单价', value: detail.unit_price },
    { label: '小计', value: detail.subtotal },
    { label: '税额', value: detail.tax_amount },
    { label: '是否开票', value: detail.need_invoice ? '是' : '否' },
    { label: '备注', value: detail.notes, span: 2 }
  ]
}

const commonProcessingColumns = [
  { title: '钢种/物品', render: (_: any, row: any) => row.item?.name ?? row.item_id ?? '—' },
  { title: '规格', dataIndex: 'spec', render: (value: string) => value ?? '—' },
  { title: '数量', dataIndex: 'quantity', align: 'right' as const },
  { title: '单位', dataIndex: 'unit' },
  { title: '单价', dataIndex: 'unit_price', align: 'right' as const, render: (value: any) => value ?? '—' },
  { title: '金额', dataIndex: 'amount', align: 'right' as const, render: (value: any) => value ?? '—' }
]

function auditDetailTables(target: PendingAudit | null, detail: any): DetailTable[] {
  if (!target || !detail) return []
  if (target.order_kind === 'procurement') {
    return [{
      title: '采购入库明细', rowKey: 'id', dataSource: detail.items ?? [],
      columns: [
        { title: '入库日期', dataIndex: 'in_date' },
        { title: '物品', render: (_: any, row: any) => row.item?.name ?? row.item_id ?? '—' },
        { title: '规格', dataIndex: 'item_spec', render: (value: string) => value ?? '—' },
        { title: '数量', dataIndex: 'quantity', align: 'right' },
        { title: '单位', dataIndex: 'unit' },
        { title: '单价', dataIndex: 'unit_price', align: 'right' },
        { title: '金额', dataIndex: 'amount', align: 'right' },
        { title: '所属', render: (_: any, row: any) => row.owner?.name ?? row.owner_id ?? '—' }
      ]
    }]
  }
  if (target.order_kind === 'sales') {
    return [{
      title: '销售明细', rowKey: 'id', dataSource: detail.items ?? [],
      columns: [
        { title: '发货日期', dataIndex: 'ship_date' },
        ...commonProcessingColumns,
        { title: '备注', dataIndex: 'notes', render: (value: string) => value ?? '—' }
      ]
    }]
  }
  if (target.order_kind === 'outsource') {
    return [
      { title: '发出明细', rowKey: 'id', dataSource: detail.outbound_lines ?? [], columns: [{ title: '发出日期', dataIndex: 'out_date' }, ...commonProcessingColumns] },
      { title: '回厂明细', rowKey: 'id', dataSource: detail.inbound_lines ?? [], columns: [{ title: '回厂日期', dataIndex: 'in_date' }, ...commonProcessingColumns, { title: '所属', render: (_: any, row: any) => row.owner?.name ?? row.owner_id ?? '—' }] }
    ]
  }
  return [
    { title: '投料明细', rowKey: 'id', dataSource: (detail.inbound_lines ?? []).filter((row: any) => row.side === 'in'), columns: [{ title: '投料日期', dataIndex: 'date' }, ...commonProcessingColumns, { title: '所属', render: (_: any, row: any) => row.owner?.name ?? row.owner_id ?? '—' }] },
    { title: '出钢明细', rowKey: 'id', dataSource: (detail.inbound_lines ?? []).filter((row: any) => row.side === 'out'), columns: [{ title: '出钢日期', dataIndex: 'date' }, ...commonProcessingColumns, { title: '炉号', dataIndex: 'furnace_no' }, { title: '所属', render: (_: any, row: any) => row.owner?.name ?? row.owner_id ?? '—' }] },
    { title: '补加合金', rowKey: 'id', dataSource: detail.alloy_lines ?? [], columns: [{ title: '补加日期', dataIndex: 'date' }, ...commonProcessingColumns] }
  ]
}

export function Audit() {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState('')
  const [appliedKind, setAppliedKind] = useState('')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [rejectTarget, setRejectTarget] = useState<PendingAudit | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [detailTarget, setDetailTarget] = useState<PendingAudit | null>(null)

  const query = useQuery({
    queryKey: ['pending-audits', appliedKind],
    queryFn: async () =>
      (await api.get<PendingAudit[]>('/dashboard/pending-audits', { params: appliedKind ? { kind: appliedKind } : {} })).data
  })

  const detailQuery = useQuery({
    queryKey: ['pending-audit-detail', detailTarget?.order_kind, detailTarget?.order_id],
    enabled: detailTarget !== null,
    retry: false,
    queryFn: async () => (
      await api.get(`/${KIND_META[detailTarget!.order_kind].path}/${detailTarget!.order_id}`)
    ).data
  })

  const approve = useMutation({
    mutationFn: async (row: PendingAudit) =>
      api.post(`/${KIND_META[row.order_kind].path}/${row.order_id}/approve`),
    onSuccess: () => {
      message.success('已审核通过')
      queryClient.invalidateQueries({ queryKey: ['pending-audits'] })
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '审核失败')
  })

  const reject = useMutation({
    mutationFn: async ({ row, reason }: { row: PendingAudit; reason: string }) =>
      api.post(`/${KIND_META[row.order_kind].path}/${row.order_id}/reject`, { reason }),
    onSuccess: () => {
      message.success('已驳回，订单已退回进行中')
      setRejectTarget(null)
      setRejectReason('')
      queryClient.invalidateQueries({ queryKey: ['pending-audits'] })
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '驳回失败')
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">审核中心</h1>
      </div>
      <div className="toolbar">
        <span>类型筛选：</span>
        <Select
          value={kind}
          style={{ width: 160 }}
          onChange={setKind}
          options={[
            { value: '', label: '全部' },
            { value: 'smelting', label: '冶炼' },
            { value: 'outsource', label: '外协' },
            { value: 'procurement', label: '采购' },
            { value: 'sales', label: '销售' }
          ]}
        />
        <Button type="primary" onClick={() => setAppliedKind(kind)}>查询</Button>
        <Button onClick={() => { setKind(''); setAppliedKind('') }}>重置</Button>
      </div>
      <Table<PendingAudit>
        rowKey={(r) => `${r.order_kind}-${r.order_id}`}
        loading={query.isLoading}
        dataSource={query.data}
        onRow={(row) => ({
          onDoubleClick: () => setDetailTarget(row),
          style: { cursor: 'pointer' },
          title: '双击查看订单详情'
        })}
        pagination={localTablePagination(query.data?.length ?? 0, pageSize, setPageSize)}
        scroll={{ x: 1050 }}
        columns={[
          {
            title: '类型',
            dataIndex: 'order_kind',
            render: (k: PendingAudit['order_kind']) => <Tag color={KIND_META[k].color}>{KIND_META[k].label}</Tag>
          },
          { title: '批次', dataIndex: 'batch_no' },
          { title: '单位', dataIndex: 'party_name', render: (v) => v ?? '—' },
          {
            title: '金额',
            dataIndex: 'amount',
            align: 'right',
            render: (v: number | null) => (v != null ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '—')
          },
          { title: '录入人', dataIndex: 'created_by_name', render: (v) => v ?? '—' },
          { title: '时间', dataIndex: 'created_at', render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—') },
          { title: '状态', dataIndex: 'status', render: (s) => <OrderStatusTag status={s} /> },
          {
            title: '操作',
            fixed: 'right' as const,
            width: 140,
            render: (_, row) => (
              <Space>
                <Button type="link" loading={approve.isPending} onClick={() => approve.mutate(row)}>
                  通过
                </Button>
                <Button type="link" danger onClick={() => setRejectTarget(row)}>
                  驳回
                </Button>
              </Space>
            )
          }
        ]}
      />

      <DetailModal
        open={detailTarget !== null}
        onClose={() => setDetailTarget(null)}
        loading={detailQuery.isLoading}
        title={detailTarget ? `${KIND_META[detailTarget.order_kind].label}订单 ${detailTarget.batch_no}` : '审核订单详情'}
        fields={auditDetailFields(detailTarget, detailQuery.data)}
        tables={auditDetailTables(detailTarget, detailQuery.data)}
      />

      <Modal
        title={`驳回 ${rejectTarget?.batch_no ?? ''}`}
        open={!!rejectTarget}
        onCancel={() => {
          setRejectTarget(null)
          setRejectReason('')
        }}
        onOk={() => {
          if (!rejectReason.trim()) {
            message.warning('请填写驳回原因')
            return
          }
          if (rejectTarget) reject.mutate({ row: rejectTarget, reason: rejectReason.trim() })
        }}
        confirmLoading={reject.isPending}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea
          rows={3}
          placeholder="请填写驳回原因"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  )
}
