import { useQuery } from '@tanstack/react-query'
import { Button, Table, Tag } from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'

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
  const [detail, setDetail] = useState<Payment | null>(null)
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
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '日期', dataIndex: 'pay_date' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '方向', dataIndex: 'direction', render: (value) => <Tag color={value === 'receive' ? 'green' : 'blue'}>{value === 'receive' ? '收款' : '付款'}</Tag> },
          { title: '金额', dataIndex: 'amount' },
          { title: '方式', dataIndex: 'method' },
          { title: '备注', dataIndex: 'notes' },
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
        title="收付款详情"
        fields={
          detail
            ? [
                { label: '日期', value: detail.pay_date },
                { label: '单位ID', value: detail.party_id },
                { label: '方向', value: detail.direction === 'receive' ? '收款' : '付款' },
                { label: '金额', value: detail.amount },
                { label: '方式', value: detail.method },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
