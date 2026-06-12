import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

interface Invoice {
  id: number
  party_id: number
  direction: 'issue' | 'receive'
  invoice_date?: string | null
  invoice_no?: string | null
  amount: string
  notes?: string | null
}

export function Invoices() {
  const query = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get<PageResult<Invoice>>('/invoices', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">开票记录</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '日期', dataIndex: 'invoice_date' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '方向', dataIndex: 'direction', render: (value) => <Tag color={value === 'issue' ? 'purple' : 'cyan'}>{value === 'issue' ? '已开发票' : '已收发票'}</Tag> },
          { title: '发票号', dataIndex: 'invoice_no' },
          { title: '金额', dataIndex: 'amount' },
          { title: '备注', dataIndex: 'notes' }
        ]}
      />
    </div>
  )
}
