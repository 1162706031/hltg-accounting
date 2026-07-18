import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag
} from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { DetailModal } from '../components/DetailModal'
import { ListFilters } from '../components/ListFilters'
import { useAuth } from '../utils/AuthContext'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'
import { replaceCachedPageItem } from '../utils/queryCache'

type ItemType = 'steel_grade' | 'raw_material' | 'alloy' | 'finished_product' | 'semi_finished' | 'scrap'

interface Item {
  id: number
  name: string
  item_type: ItemType
  is_active: boolean
  chemical_enabled: boolean
  chemical_composition?: Record<string, string> | null
  default_price?: string | null
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
  chemical_enabled: boolean
  chemical_composition?: Record<string, string | number | null> | null
  default_price?: string | number | null
  notes?: string | null
}

const CHEMICAL_ELEMENTS = ['C', 'Mn', 'Si', 'Cr', 'W', 'Mo', 'V', 'Co', 'Nb', 'Ni', 'P', 'S'] as const
const emptyChemicalComposition = () =>
  Object.fromEntries(CHEMICAL_ELEMENTS.map((code) => [code, '0'])) as Record<string, string>

export function Items() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)

  const [typeFilter, setTypeFilter] = useState<ItemType | undefined>()
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [chemicalFilter, setChemicalFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [search, setSearch] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ type: undefined as ItemType | undefined, active: 'all', chemical: 'all', search: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Item | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Item | null>(null)
  const [form] = Form.useForm<FormValues>()
  const chemicalEnabled = Form.useWatch('chemical_enabled', form)

  const query = useQuery({
    queryKey: ['items', appliedFilters, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (appliedFilters.type) params.item_type = appliedFilters.type
      if (appliedFilters.active !== 'all') params.is_active = appliedFilters.active === 'active' ? 1 : 0
      if (appliedFilters.chemical !== 'all') params.chemical_enabled = appliedFilters.chemical === 'enabled' ? 1 : 0
      if (appliedFilters.search) params.q = appliedFilters.search
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
    onSuccess: (updated: Item) => {
      message.success('已保存')
      replaceCachedPageItem(qc, ['items'], updated)
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
    onSuccess: (updated: Item, vars) => {
      message.success(vars.isActive ? '已启用' : '已停用')
      replaceCachedPageItem(qc, ['items'], updated)
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
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '批量删除失败')
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
    form.resetFields()
    form.setFieldsValue({
      name: row.name,
      item_type: row.item_type,
      is_active: row.is_active,
      chemical_enabled: row.chemical_enabled,
      chemical_composition: row.chemical_composition ?? {},
      default_price: row.default_price ?? null,
      notes: row.notes ?? ''
    })
    setOpen(true)
  }
  const handleSubmit = () => {
    form.validateFields().then((vals) => {
      const composition = chemicalEnabled
        ? Object.fromEntries(CHEMICAL_ELEMENTS.map((code) => [code, vals.chemical_composition?.[code] ?? 0]))
        : null
      const total = Object.values(composition ?? {}).reduce<number>((sum, value) => sum + Number(value || 0), 0)
      if (total > 100) {
        message.error('化学成分合计不能超过 100%')
        return
      }
      const payload: FormValues = {
        ...vals,
        chemical_composition: composition,
        default_price: chemicalEnabled ? vals.default_price ?? null : null,
        notes: vals.notes || null
      }
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

  const applyFilters = () => {
    setAppliedFilters({ type: typeFilter, active: activeFilter, chemical: chemicalFilter, search: search.trim() })
    setPage(1)
  }

  const resetFilters = () => {
    setTypeFilter(undefined)
    setActiveFilter('all')
    setChemicalFilter('all')
    setSearch('')
    setAppliedFilters({ type: undefined, active: 'all', chemical: 'all', search: '' })
    setPage(1)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">物品管理</h1>
      </div>

      <ListFilters>
        <div className="filter-item"><span>类型：</span><Select allowClear placeholder="全部类型" value={typeFilter} onChange={setTypeFilter} options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} /></div>
        <div className="filter-item"><span>状态：</span><Select value={activeFilter} onChange={setActiveFilter} options={[{ value: 'all', label: '全部' }, { value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} /></div>
        <div className="filter-item"><span>化学成分：</span><Select value={chemicalFilter} onChange={setChemicalFilter} options={[{ value: 'all', label: '全部' }, { value: 'enabled', label: '已启用' }, { value: 'disabled', label: '未启用' }]} /></div>
        <div className="filter-item"><span>名称：</span><Input allowClear value={search} placeholder="搜索名称/规格" onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="filter-actions"><Button type="primary" onClick={applyFilters}>查询</Button><Button onClick={resetFilters}>重置</Button></div>
      </ListFilters>

      <BusinessTable
        tableId="items"
        toolbarActions={canManage ? <><Button type="primary" onClick={openCreate}>+ 新建物品</Button><Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>批量删除</Button></> : null}
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        size="middle"
        scroll={{ x: 900 }}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as number[])
              }
            : undefined
        }
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'item_type',
            render: (v: ItemType) => <Tag color={typeColors[v]}>{typeLabels[v]}</Tag>
          },
          {
            title: '化学成分',
            dataIndex: 'chemical_enabled',
            width: 110,
            render: (v: boolean) => <Tag color={v ? 'blue' : 'default'}>{v ? '已启用' : '未启用'}</Tag>
          },
          {
            title: '默认单价(元/吨)',
            dataIndex: 'default_price',
            width: 150,
            align: 'right' as const,
            render: (v: string | null) => v ?? '—'
          },
          {
            title: '状态',
            dataIndex: 'is_active',
            render: (v: boolean, row) => (
              <Switch
                size="small"
                checked={v}
                disabled={!canManage}
                loading={toggleActiveMut.isPending && toggleActiveMut.variables?.id === row.id}
                onChange={(checked) => toggleActiveMut.mutate({ id: row.id, isActive: checked })}
              />
            )
          },
          { title: '备注', dataIndex: 'notes', ellipsis: true },
          {
            title: '操作',
            fixed: 'right' as const,
            width: canManage ? 220 : 80,
            render: (_, row) => (
              <Space size="small">
                <Button size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                {canManage && (
                  <>
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
                  </>
                )}
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
                  chemical_enabled: editing.chemical_enabled,
                  chemical_composition: editing.chemical_composition ?? {},
                  default_price: editing.default_price ?? null,
                  notes: editing.notes ?? ''
                }
              : {
                  name: '',
                  item_type: 'steel_grade',
                  is_active: true,
                  chemical_enabled: false,
                  chemical_composition: emptyChemicalComposition(),
                  default_price: null,
                  notes: ''
                }
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
          <Form.Item name="chemical_enabled" label="是否启用化学成分" valuePropName="checked">
            <Switch
              onChange={(checked) => {
                if (checked) {
                  const current = form.getFieldValue('chemical_composition') ?? {}
                  form.setFieldValue('chemical_composition', { ...emptyChemicalComposition(), ...current })
                }
              }}
            />
          </Form.Item>
          {chemicalEnabled && (
            <div className="chemical-editor">
              <Form.Item
                name="default_price"
                label="基础默认单价（元/吨）"
                rules={[{ type: 'number', min: 0, message: '单价不能小于 0', transform: (value) => Number(value) }]}
              >
                <InputNumber stringMode min="0" precision={4} style={{ width: '100%' }} />
              </Form.Item>
              <div className="chemical-grid">
                {CHEMICAL_ELEMENTS.map((code) => (
                  <Form.Item
                    key={code}
                    name={['chemical_composition', code]}
                    label={`${code} (%)`}
                    rules={[{ type: 'number', min: 0, max: 100, transform: (value) => Number(value ?? 0) }]}
                  >
                    <InputNumber stringMode min="0" max="100" precision={6} placeholder="0" style={{ width: '100%' }} />
                  </Form.Item>
                ))}
              </div>
            </div>
          )}
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
                { label: '化学成分', value: detail.chemical_enabled ? '已启用' : '未启用' },
                { label: '默认单价', value: detail.default_price != null ? `${detail.default_price} 元/吨` : '—' },
                {
                  label: '成分配置',
                  value: detail.chemical_enabled
                    ? CHEMICAL_ELEMENTS.map((code) => `${code}=${detail.chemical_composition?.[code] ?? 0}%`).join('，')
                    : '—',
                  span: 2
                },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
