import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Modal, Select, Space, Table, Tag } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { OrderStatusTag } from '../utils/orderStatus'
import { DEFAULT_PAGE_SIZE, localTablePagination } from '../utils/pagination'

interface PendingAudit {
  order_kind: 'smelting' | 'outsource' | 'procurement' | 'sales'
  order_id: number
  batch_no: string
  party_name?: string | null
  amount?: number | null
  created_by?: number | null
  created_at?: string | null
  status: 'pending_review'
}

const KIND_META: Record<PendingAudit['order_kind'], { label: string; color: string; path: string }> = {
  smelting: { label: '冶炼', color: 'purple', path: 'smelting-orders' },
  outsource: { label: '外协', color: 'geekblue', path: 'outsource-orders' },
  procurement: { label: '采购', color: 'gold', path: 'procurement-orders' },
  sales: { label: '销售', color: 'green', path: 'sales-orders' }
}

export function Audit() {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState('')
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [rejectTarget, setRejectTarget] = useState<PendingAudit | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const query = useQuery({
    queryKey: ['pending-audits', kind],
    queryFn: async () =>
      (await api.get<PendingAudit[]>('/dashboard/pending-audits', { params: kind ? { kind } : {} })).data
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
      </div>
      <Table<PendingAudit>
        rowKey={(r) => `${r.order_kind}-${r.order_id}`}
        loading={query.isLoading}
        dataSource={query.data}
        pagination={localTablePagination(query.data?.length ?? 0, pageSize, setPageSize)}
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
          { title: '录入人', dataIndex: 'created_by', render: (v) => v ?? '—' },
          { title: '时间', dataIndex: 'created_at', render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '—') },
          { title: '状态', dataIndex: 'status', render: (s) => <OrderStatusTag status={s} /> },
          {
            title: '操作',
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
