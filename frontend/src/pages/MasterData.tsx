import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Card, Space, Table, Tabs, Tag, Typography } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { MASTER_DATA_CATEGORY_META, MasterDataCreateModal } from '../components/MasterDataCreateModal'
import {
  MasterDataCategory,
  MasterDataOption,
  useMasterDataOptions
} from '../utils/lookups'

export function MasterData() {
  return (
    <div className="page master-data-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">基础资料配置</h1>
          <Typography.Text type="secondary">统一维护工艺名称、物品类型和仓库规格</Typography.Text>
        </div>
      </div>
      <Tabs
        className="master-data-tabs"
        items={(Object.keys(MASTER_DATA_CATEGORY_META) as MasterDataCategory[]).map((category) => ({
          key: category,
          label: MASTER_DATA_CATEGORY_META[category].label,
          children: <MasterDataCategoryPanel category={category} />
        }))}
      />
    </div>
  )
}

function MasterDataCategoryPanel({ category }: { category: MasterDataCategory }) {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const query = useMasterDataOptions(category)
  const meta = MASTER_DATA_CATEGORY_META[category]

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['master-data-options'] })
    qc.invalidateQueries({ queryKey: ['items'] })
  }
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/master-data/options/${id}`).then((response) => response.data),
    onSuccess: () => {
      message.success('已删除')
      invalidate()
    },
    onError: (error: any) => message.error(error?.response?.data?.detail ?? '删除失败')
  })

  const confirmDelete = (option: MasterDataOption) => {
    modal.confirm({
      title: `确认删除“${option.name}”？`,
      content: '系统会检查物品、库存及业务单据引用；已被使用的配置不会删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => deleteMutation.mutateAsync(option.id)
    })
  }

  const openCreateModal = () => {
    setCreateOpen(true)
  }

  return (
    <Card>
      <div className="master-data-panel-heading">
        <div>
          <Typography.Title level={5}>{meta.label}</Typography.Title>
          <Typography.Text type="secondary">{meta.description}</Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
        >
          添加{meta.label}
        </Button>
      </div>
      <Table<MasterDataOption>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '来源',
            dataIndex: 'is_system',
            width: 120,
            render: (isSystem: boolean) => isSystem ? <Tag color="blue">系统内置</Tag> : <Tag>自定义</Tag>
          },
          {
            title: '操作',
            key: 'operation',
            width: 120,
            render: (_, option) => (
              <Space>
                <Button
                  danger
                  type="link"
                  icon={<DeleteOutlined />}
                  disabled={option.is_system}
                  onClick={() => confirmDelete(option)}
                >
                  删除
                </Button>
              </Space>
            )
          }
        ]}
      />
      <MasterDataCreateModal
        category={category}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </Card>
  )
}
