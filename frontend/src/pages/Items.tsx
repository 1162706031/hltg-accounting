import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag
} from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'

type ItemType = 'steel_grade' | 'raw_material' | 'alloy' | 'finished_product' | 'semi_finished' | 'scrap'

interface Item {
  id: number
  name: string
  item_type: ItemType
  is_active: boolean
  notes?: string | null
}

const typeLabels: Record<ItemType, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}
const typeColors: Record<ItemType, string> = {
  steel_grade: 'blue',
  raw_material: 'default',
  alloy: 'orange',
  finished_product: 'green',
  semi_finished: 'cyan',
  scrap: 'red'
}

interface FormValues {
  name: string
  item_type: ItemType
  is_active: boolean
  notes?: string | null
}

export function Items() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()

  const [typeFilter, setTypeFilter] = useState<ItemType | undefined>()
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Item | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Item | null>(null)
  const [form] = Form.useForm<FormValues>()

  const query = useQuery({
    queryKey: ['items', typeFilter, activeFilter, search],
    queryFn: async () => {
      const params: Record<string, string | number> = { page_size: 200 }
      if (typeFilter) params.item_type = typeFilter
      if (activeFilter !== 'all') params.is_active = activeFilter === 'active' ? 1 : 0
      if (search) params.q = search
      return (await api.get<PageResult<Item>>('/items', { params })).data
    }
  })

  const createMut = useMutation({
    mutationFn: (payload: FormValues) => api.post('/items', payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已创建')
      qc.invalidateQueries({ queryKey: ['items'] })
      setOpen(false)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      const detail = err.response?.data?.detail ?? '创建失败'
      message.error(detail)
    }
  })
  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: FormValues }) =>
      api.put(`/items/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已保存')
      qc.invalidateQueries({ queryKey: ['items'] })
      setOpen(false)
      setEditing(null)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '保存失败')
    }
  })
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.put(`/items/${id}`, { is_active: isActive }).then((r) => r.data),
    onSuccess: (_d, vars) => {
      message.success(vars.isActive ? '已启用' : '已停用')
      qc.invalidateQueries({ queryKey: ['items'] })
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '操作失败')
    }
  })
  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.post('/items/batch-delete', { ids }).then((r) => r.data),
    onSuccess: (res: { deleted_count: number; skipped: Array<{ id: number; reason: string }> }) => {
      const summary = [`已删除 ${res.deleted_count} 个`]
      if (res.skipped.length) summary.push(`跳过 ${res.skipped.length} 个`)
      message.success(summary.join('，'))
      if (res.skipped.length) {
        modal.info({
          title: '已跳过',
          content: (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {res.skipped.map((s) => (
                <li key={s.id}>
                  #{s.id}：{s.reason}
                </li>
              ))}
            </ul>
          )
        })
      }
      qc.invalidateQueries({ queryKey: ['items'] })
      setSelectedIds([])
    }
  })
  const singleDeleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/items/${id}`).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      qc.invalidateQueries({ queryKey: ['items'] })
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '删除失败')
    }
  })

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }
  const openEdit = (row: Item) => {
    setEditing(row)
    setOpen(true)
  }
  const handleSubmit = () => {
    form.validateFields().then((vals) => {
      const payload: FormValues = { ...vals, notes: vals.notes || null }
      if (editing) {
        updateMut.mutate({ id: editing.id, payload })
      } else {
        createMut.mutate(payload)
      }
    })
  }
  const handleBatchDelete = () => {
    if (!selectedIds.length) return
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 个物品？`,
      content: '有库存引用或被进行中订单引用的物品将被自动停用或跳过。',
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMut.mutateAsync(selectedIds)
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">物品管理</h1>
        <Space>
          <Button type="primary" onClick={openCreate}>
            + 新建物品
          </Button>
          <Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>
            批量删除
          </Button>
        </Space>
      </div>

      <Space wrap className="toolbar">
        <Select
          allowClear
          placeholder="类型筛选"
          style={{ width: 140 }}
          value={typeFilter}
          onChange={(v) => setTypeFilter(v)}
          options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
        />
        <Select
          placeholder="状态筛选"
          style={{ width: 120 }}
          value={activeFilter}
          onChange={(v) => setActiveFilter(v)}
          options={[
            { value: 'all', label: '全部' },
            { value: 'active', label: '启用' },
            { value: 'inactive', label: '停用' }
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索名称/规格"
          style={{ width: 240 }}
          onSearch={setSearch}
        />
      </Space>

      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={false}
        size="middle"
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[])
        }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'item_type',
            render: (v: ItemType) => <Tag color={typeColors[v]}>{typeLabels[v]}</Tag>
          },
          {
            title: '状态',
            dataIndex: 'is_active',
            render: (v: boolean, row) => (
              <Switch
                size="small"
                checked={v}
                loading={toggleActiveMut.isPending && toggleActiveMut.variables?.id === row.id}
                onChange={(checked) => toggleActiveMut.mutate({ id: row.id, isActive: checked })}
              />
            )
          },
          { title: '备注', dataIndex: 'notes', ellipsis: true },
          {
            title: '操作',
            width: 220,
            render: (_, row) => (
              <Space size="small">
                <Button size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                <Button size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    modal.confirm({
                      title: `确认删除 ${row.name}？`,
                      okButtonProps: { danger: true },
                      onOk: () => singleDeleteMut.mutateAsync(row.id)
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editing ? '编辑物品' : '新建物品'}
        open={open}
        onCancel={() => {
          setOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={handleSubmit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form
          key={editing ? `edit-${editing.id}` : 'create'}
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={
            editing
              ? {
                  name: editing.name,
                  item_type: editing.item_type,
                  is_active: editing.is_active,
                  notes: editing.notes ?? ''
                }
              : { name: '', item_type: 'steel_grade', is_active: true, notes: '' }
          }
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, min: 1, max: 100 }]}
          >
            <Input placeholder="如 H13、钼铁、2Cr14Ni" />
          </Form.Item>
          <Form.Item
            name="item_type"
            label="类型"
            rules={[{ required: true }]}
          >
            <Select options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `物品 ${detail.name}` : ''}
        fields={
          detail
            ? [
                { label: '名称', value: detail.name },
                { label: '类型', value: typeLabels[detail.item_type] },
                { label: '状态', value: detail.is_active ? '启用' : '停用' },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
