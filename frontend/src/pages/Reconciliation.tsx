import { useQuery } from '@tanstack/react-query'
import { Button, Table, Tag } from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'

interface ReconciliationRow {
  id: number
  party_id: number
  period: string
  biz_date?: string | null
  biz_desc?: string | null
  debit: string
  credit: string
  invoice_direction?: 'issue' | 'receive' | null
  invoice_amount?: string | null
  recon_status: 'unreconciled' | 'verified' | 'completed' | 'disabled'
  notes?: string | null
}

const statusMap: Record<ReconciliationRow['recon_status'], { color: string; label: string }> = {
  unreconciled: { color: 'orange', label: '未对账' },
  verified: { color: 'blue', label: '已核对' },
  completed: { color: 'green', label: '已完成/已支付' },
  disabled: { color: 'default', label: '不启用' }
}

export function Reconciliation() {
  const [detail, setDetail] = useState<ReconciliationRow | null>(null)
  const query = useQuery({
    queryKey: ['reconciliations'],
    queryFn: async () => (await api.get<PageResult<ReconciliationRow>>('/reconciliations', { params: { page_size: 100 } })).data
  })

  const dirLabel = (v?: string | null) => (v === 'issue' ? '应开发票' : v === 'receive' ? '应收发票' : '-')

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">用户对账</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '账期', dataIndex: 'period' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '业务日期', dataIndex: 'biz_date' },
          { title: '摘要', dataIndex: 'biz_desc' },
          { title: '应收', dataIndex: 'debit' },
          { title: '应付', dataIndex: 'credit' },
          { title: '发票方向', dataIndex: 'invoice_direction', render: (value) => dirLabel(value) },
          { title: '发票金额', dataIndex: 'invoice_amount' },
          { title: '状态', dataIndex: 'recon_status', render: (value: ReconciliationRow['recon_status']) => <Tag color={statusMap[value].color}>{statusMap[value].label}</Tag> },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            width: 90,
            render: (_, row) => (
              <Button size="small" onClick={() => setDetail(row)}>
                查看
              </Button>
            )
          }
        ]}
      />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="对账明细"
        fields={
          detail
            ? [
                { label: '账期', value: detail.period },
                { label: '单位ID', value: detail.party_id },
                { label: '业务日期', value: detail.biz_date },
                { label: '摘要', value: detail.biz_desc, span: 2 },
                { label: '应收', value: detail.debit },
                { label: '应付', value: detail.credit },
                { label: '发票方向', value: dirLabel(detail.invoice_direction) },
                { label: '发票金额', value: detail.invoice_amount },
                { label: '状态', value: <Tag color={statusMap[detail.recon_status].color}>{statusMap[detail.recon_status].label}</Tag> },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
