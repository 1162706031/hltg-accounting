import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

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
}

const statusMap: Record<ReconciliationRow['recon_status'], { color: string; label: string }> = {
  unreconciled: { color: 'orange', label: '未对账' },
  verified: { color: 'blue', label: '已核对' },
  completed: { color: 'green', label: '已完成/已支付' },
  disabled: { color: 'default', label: '不启用' }
}

export function Reconciliation() {
  const query = useQuery({
    queryKey: ['reconciliations'],
    queryFn: async () => (await api.get<PageResult<ReconciliationRow>>('/reconciliations', { params: { page_size: 100 } })).data
  })

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
        columns={[
          { title: '账期', dataIndex: 'period' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '业务日期', dataIndex: 'biz_date' },
          { title: '摘要', dataIndex: 'biz_desc' },
          { title: '应收', dataIndex: 'debit' },
          { title: '应付', dataIndex: 'credit' },
          { title: '发票方向', dataIndex: 'invoice_direction', render: (value) => (value === 'issue' ? '应开发票' : value === 'receive' ? '应收发票' : '-') },
          { title: '发票金额', dataIndex: 'invoice_amount' },
          { title: '状态', dataIndex: 'recon_status', render: (value: ReconciliationRow['recon_status']) => <Tag color={statusMap[value].color}>{statusMap[value].label}</Tag> }
        ]}
      />
    </div>
  )
}
