import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import { api, PageResult } from '../api/client'

interface Party {
  id: number
  name: string
  short_name?: string | null
  is_internal: boolean
  is_customer: boolean
  is_supplier: boolean
  is_processor: boolean
  contact?: string | null
  phone?: string | null
}

export function Parties() {
  const query = useQuery({
    queryKey: ['parties'],
    queryFn: async () => (await api.get<PageResult<Party>>('/parties', { params: { page_size: 100 } })).data
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">往来单位</h1>
      </div>
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '简称', dataIndex: 'short_name' },
          {
            title: '角色',
            render: (_, row) => (
              <>
                {row.is_internal && <Tag color="default">本厂</Tag>}
                {row.is_customer && <Tag color="green">客户</Tag>}
                {row.is_supplier && <Tag color="blue">供应商</Tag>}
                {row.is_processor && <Tag color="orange">外协厂</Tag>}
              </>
            )
          },
          { title: '联系人', dataIndex: 'contact' },
          { title: '电话', dataIndex: 'phone' }
        ]}
      />
    </div>
  )
}
