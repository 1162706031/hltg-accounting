import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

interface Item {
  id: number
  name: string
  item_type: string
  spec?: string | null
  default_unit: string
  is_active: boolean
}

const itemTypeLabels: Record<string, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}

export function Items() {
  const query = useQuery({
    queryKey: ['items'],
    queryFn: async () => (await api.get<PageResult<Item>>('/items', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">物品管理</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'item_type', render: (value) => itemTypeLabels[value] ?? value },
          { title: '规格', dataIndex: 'spec' },
          { title: '默认单位', dataIndex: 'default_unit' },
          { title: '状态', dataIndex: 'is_active', render: (value) => <Tag color={value ? 'green' : 'red'}>{value ? '启用' : '停用'}</Tag> }
        ]}
      />
    </div>
  )
}
