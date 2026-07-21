import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Card, Input, Select, Space, Tabs, Tag, Typography } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
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
          <Typography.Text type="secondary">统一维护工艺名称、物品类型、物品名称和仓库规格</Typography.Text>
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
  const [nameFilter, setNameFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'system' | 'custom'>('all')
  const [appliedFilters, setAppliedFilters] = useState({ name: '', source: 'all' as 'all' | 'system' | 'custom' })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const query = useMasterDataOptions(category)
  const meta = MASTER_DATA_CATEGORY_META[category]
  const filteredOptions = (query.data ?? []).filter((option) => {
    if (appliedFilters.name && !option.name.toLocaleLowerCase().includes(appliedFilters.name.toLocaleLowerCase())) return false
    if (appliedFilters.source === 'system' && !option.is_system) return false
    if (appliedFilters.source === 'custom' && option.is_system) return false
    return true
  })

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
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.post('/master-data/options/batch-delete', { ids }).then((response) => response.data),
    onSuccess: (result: { deleted_count: number; skipped: Array<{ id: number; reason: string }> }) => {
      if (result.deleted_count) message.success(`已删除 ${result.deleted_count} 项`)
      if (result.skipped.length) {
        modal.info({
          title: `已跳过 ${result.skipped.length} 项`,
          content: (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.skipped.map((item) => <li key={item.id}>#{item.id}：{item.reason}</li>)}
            </ul>
          )
        })
      }
      setSelectedIds([])
      invalidate()
    },
    onError: (error: any) => message.error(error?.response?.data?.detail ?? '批量删除失败')
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

  const applyFilters = () => {
    setAppliedFilters({ name: nameFilter.trim(), source: sourceFilter })
    setSelectedIds([])
    setPage(1)
  }

  const resetFilters = () => {
    setNameFilter('')
    setSourceFilter('all')
    setAppliedFilters({ name: '', source: 'all' })
    setSelectedIds([])
    setPage(1)
  }

  const confirmBatchDelete = () => {
    if (!selectedIds.length) return
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 项${meta.label}？`,
      content: '系统会逐项检查引用；已经被物品、库存或业务记录使用的配置会自动跳过。',
      okText: '批量删除',
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMutation.mutateAsync(selectedIds)
    })
  }

  return (
    <Card>
      <div className="master-data-panel-heading">
        <div>
          <Typography.Title level={5}>{meta.label}</Typography.Title>
          <Typography.Text type="secondary">{meta.description}</Typography.Text>
        </div>
      </div>
      <ListFilters defaultCollapsed={false}>
        <div className="filter-item">
          <span>名称：</span>
          <Input allowClear value={nameFilter} placeholder={`搜索${meta.label}`} onChange={(event) => setNameFilter(event.target.value)} onPressEnter={applyFilters} />
        </div>
        <div className="filter-item">
          <span>来源：</span>
          <Select value={sourceFilter} onChange={setSourceFilter} options={[
            { value: 'all', label: '全部来源' },
            { value: 'system', label: '系统内置' },
            { value: 'custom', label: '自定义' }
          ]} />
        </div>
        <div className="filter-actions">
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </ListFilters>
      <BusinessTable<MasterDataOption>
        tableId={`master-data-${category}`}
        toolbarActions={(
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>添加{meta.label}</Button>
            <Button danger icon={<DeleteOutlined />} disabled={!selectedIds.length} loading={batchDeleteMutation.isPending} onClick={confirmBatchDelete}>批量删除</Button>
          </>
        )}
        rowKey="id"
        loading={query.isLoading}
        dataSource={filteredOptions}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
          getCheckboxProps: (option) => ({ disabled: option.is_system })
        }}
        scroll={{ x: 720 }}
        pagination={{
          current: page,
          pageSize,
          total: filteredOptions.length,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 项`,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPageSize !== pageSize ? 1 : nextPage)
            setPageSize(nextPageSize)
          }
        }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '来源',
            dataIndex: 'is_system',
            width: 120,
            render: (isSystem: boolean) => isSystem ? <Tag color="blue">系统内置</Tag> : <Tag>自定义</Tag>
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 190,
            render: (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
          },
          {
            title: '操作',
            key: 'operation',
            fixed: 'right',
            width: 110,
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
