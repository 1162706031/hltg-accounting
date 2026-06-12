import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

interface InventoryLog {
  id: number
  inventory_id: number
  change_type: 'in' | 'out' | 'adjust' | 'init'
  change_date: string
  delta_pieces: number
  delta_weight: string
  before_weight: string
  after_weight: string
  notes?: string | null
}

const colors: Record<InventoryLog['change_type'], string> = { in: 'green', out: 'red', adjust: 'orange', init: 'default' }
const labels: Record<InventoryLog['change_type'], string> = { in: '入库', out: '出库', adjust: '调整', init: '初始' }

export function InventoryLogs() {
  const query = useQuery({
    queryKey: ['inventory-logs'],
    queryFn: async () => (await api.get<PageResult<InventoryLog>>('/inventory/logs', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">库存变动记录</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '日期', dataIndex: 'change_date' },
          { title: '类型', dataIndex: 'change_type', render: (value: InventoryLog['change_type']) => <Tag color={colors[value]}>{labels[value]}</Tag> },
          { title: '库存ID', dataIndex: 'inventory_id' },
          { title: '变化支数', dataIndex: 'delta_pieces' },
          { title: '变化重量', dataIndex: 'delta_weight' },
          { title: '变动前', dataIndex: 'before_weight' },
          { title: '变动后', dataIndex: 'after_weight' },
          { title: '备注', dataIndex: 'notes' }
        ]}
      />
    </div>
  )
}
