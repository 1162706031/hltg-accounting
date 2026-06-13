import { useQuery } from '@tanstack/react-query'
import { Button, Table, Tag } from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'

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
  const [detail, setDetail] = useState<Invoice | null>(null)
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
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '日期', dataIndex: 'invoice_date' },
          { title: '单位ID', dataIndex: 'party_id' },
          { title: '方向', dataIndex: 'direction', render: (value) => <Tag color={value === 'issue' ? 'purple' : 'cyan'}>{value === 'issue' ? '已开发票' : '已收发票'}</Tag> },
          { title: '发票号', dataIndex: 'invoice_no' },
          { title: '金额', dataIndex: 'amount' },
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
        title="开票详情"
        fields={
          detail
            ? [
                { label: '日期', value: detail.invoice_date },
                { label: '单位ID', value: detail.party_id },
                { label: '方向', value: detail.direction === 'issue' ? '已开发票' : '已收发票' },
                { label: '发票号', value: detail.invoice_no },
                { label: '金额', value: detail.amount },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
