import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

interface Payment {
  id: number
  party_id: number
  direction: 'pay' | 'receive'
  pay_date?: string | null
  amount: string
  method?: string | null
  notes?: string | null
}

export function Payments() {
  const query = useQuery({
    queryKey: ['payments'],
    queryFn: async () => (await api.get<PageResult<Payment>>('/payments', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">收付款记录</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '日期', dataIndex: 'pay_date' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '方向', dataIndex: 'direction', render: (value) => <Tag color={value === 'receive' ? 'green' : 'blue'}>{value === 'receive' ? '收款' : '付款'}</Tag> },
          { title: '金额', dataIndex: 'amount' },
          { title: '方式', dataIndex: 'method' },
          { title: '备注', dataIndex: 'notes' }
        ]}
      />
    </div>
  )
}
