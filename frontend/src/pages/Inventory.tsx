import { useQuery } from '@tanstack/react-query'
import { Table } from 'antd'
import { api, PageResult } from '../api/client'

interface InventoryRow {
  id: number
  item?: { name: string; item_type: string } | null
  owner?: { name: string } | null
  spec?: string | null
  unit: string
  current_pieces: number
  current_weight: string
}

export function Inventory() {
  const query = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => (await api.get<PageResult<InventoryRow>>('/inventory', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">库房管理</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '物品', render: (_, row) => row.item?.name },
          { title: '规格', dataIndex: 'spec' },
          { title: '归属', render: (_, row) => row.owner?.name },
          { title: '支数', dataIndex: 'current_pieces' },
          { title: '重量', dataIndex: 'current_weight' },
          { title: '单位', dataIndex: 'unit' }
        ]}
      />
    </div>
  )
}
