import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag
} from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'

type RoleKey = 'is_internal' | 'is_customer' | 'is_supplier' | 'is_processor'

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
  address?: string | null
  notes?: string | null
}

interface PartyBalance {
  party_id: number
  net_receivable: string
  net_payable: string
  net_to_issue: string
  net_to_receive: string
}

interface BalanceLine {
  id: number
  ref_type?: string | null
  biz_date?: string | null
  biz_desc?: string | null
  steel_grade?: string | null
  debit: string
  credit: string
  invoice_direction?: 'issue' | 'receive' | null
  invoice_amount?: string | null
  recon_status: string
}

interface BalanceDetail {
  party_id: number
  party_name: string
  net_receivable: string
  net_payable: string
  net_to_issue: string
  net_to_receive: string
  lines: BalanceLine[]
}

interface FormValues {
  name: string
  short_name?: string | null
  is_internal: boolean
  is_customer: boolean
  is_supplier: boolean
  is_processor: boolean
  contact?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
}

const ROLES: Array<{ key: RoleKey; label: string; color: string }> = [
  { key: 'is_internal', label: '本厂', color: 'default' },
  { key: 'is_customer', label: '客户', color: 'green' },
  { key: 'is_supplier', label: '供应商', color: 'blue' },
  { key: 'is_processor', label: '外协厂', color: 'orange' }
]

const REF_TYPE_LABELS: Record<string, string> = {
  smelting: '冶炼加工',
  outsource: '外协加工',
  procurement: '采购',
  sales: '销售'
}

function money(v?: string | number | null) {
  const n = Number(v ?? 0)
  if (!n) return '0'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function PartyDetailPanel({ partyId }: { partyId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['party', partyId, 'balance'],
    queryFn: async () => (await api.get<BalanceDetail>(`/parties/${partyId}/balance`)).data
  })

  if (isLoading) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    )
  }
  if (!data) return null

  return (
    <div style={{ padding: '8px 4px' }}>
      <Descriptions size="small" column={4} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="应收未收">¥{money(data.net_receivable)}</Descriptions.Item>
        <Descriptions.Item label="应付未付">¥{money(data.net_payable)}</Descriptions.Item>
        <Descriptions.Item label="应开未开发票">¥{money(data.net_to_issue)}</Descriptions.Item>
        <Descriptions.Item label="应收未收发票">¥{money(data.net_to_receive)}</Descriptions.Item>
      </Descriptions>
      <Table<BalanceLine>
        rowKey="id"
        size="small"
        dataSource={data.lines}
        pagination={false}
        locale={{ emptyText: '暂无往来明细' }}
        columns={[
          {
            title: '类型',
            dataIndex: 'ref_type',
            width: 100,
            render: (v: string | null) => (v ? REF_TYPE_LABELS[v] ?? v : '—')
          },
          { title: '业务日期', dataIndex: 'biz_date', width: 110, render: (v) => v ?? '—' },
          { title: '业务摘要', dataIndex: 'biz_desc', ellipsis: true, render: (v) => v ?? '—' },
          { title: '钢种', dataIndex: 'steel_grade', width: 90, render: (v) => v ?? '—' },
          { title: '借方', dataIndex: 'debit', width: 110, align: 'right', render: (v) => money(v) },
          { title: '贷方', dataIndex: 'credit', width: 110, align: 'right', render: (v) => money(v) },
          {
            title: '发票类型',
            dataIndex: 'invoice_direction',
            width: 100,
            render: (v: BalanceLine['invoice_direction']) =>
              v === 'issue' ? '应开发票' : v === 'receive' ? '应收发票' : '—'
          },
          {
            title: '发票金额',
            dataIndex: 'invoice_amount',
            width: 110,
            align: 'right',
            render: (v) => (v != null ? money(v) : '—')
          }
        ]}
      />
    </div>
  )
}

export function Parties() {
  const qc = useQueryClient()
  const { message, modal } = AntApp.useApp()

  const [roleFilter, setRoleFilter] = useState<RoleKey | undefined>()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Party | null>(null)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Party | null>(null)
  const [form] = Form.useForm<FormValues>()

  const query = useQuery({
    queryKey: ['parties', roleFilter, search],
    queryFn: async () => {
      const params: Record<string, string | number> = { page_size: 200 }
      if (roleFilter) params[roleFilter] = 1
      if (search) params.q = search
      return (await api.get<PageResult<Party>>('/parties', { params })).data
    }
  })

  const balanceQuery = useQuery({
    queryKey: ['party', 'balances'],
    queryFn: async () => (await api.get<PartyBalance[]>('/reconciliations/balances')).data
  })
  const balanceById = new Map((balanceQuery.data ?? []).map((b) => [b.party_id, b]))

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['parties'] })
    qc.invalidateQueries({ queryKey: ['party'] })
  }

  const createMut = useMutation({
    mutationFn: (payload: FormValues) => api.post('/parties', payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已创建')
      invalidateAll()
      setOpen(false)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '创建失败')
    }
  })
  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: FormValues }) =>
      api.put(`/parties/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      message.success('已保存')
      invalidateAll()
      setOpen(false)
      setEditing(null)
      form.resetFields()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '保存失败')
    }
  })
  const singleDeleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/parties/${id}`).then((r) => r.data),
    onSuccess: (res: { message: string }) => {
      message.success(res.message)
      invalidateAll()
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '删除失败')
    }
  })
  const batchDeleteMut = useMutation({
    mutationFn: (ids: number[]) => api.post('/parties/batch-delete', { ids }).then((r) => r.data),
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
      invalidateAll()
      setSelectedIds([])
    }
  })

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }
  const openEdit = (row: Party) => {
    setEditing(row)
    setOpen(true)
  }
  const handleSubmit = () => {
    form.validateFields().then((vals) => {
      if (!vals.is_internal && !vals.is_customer && !vals.is_supplier && !vals.is_processor) {
        message.error('请至少选择一个角色')
        return
      }
      const payload: FormValues = {
        ...vals,
        short_name: vals.short_name || null,
        contact: vals.contact || null,
        phone: vals.phone || null,
        address: vals.address || null,
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
      title: `确认删除选中的 ${selectedIds.length} 个单位？`,
      content: '有库存、对账、收付款或开票记录引用的单位将被跳过。',
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMut.mutateAsync(selectedIds)
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">往来单位</h1>
        <Space>
          <Button type="primary" onClick={openCreate}>
            + 新建单位
          </Button>
          <Button danger disabled={!selectedIds.length} onClick={handleBatchDelete}>
            批量删除
          </Button>
        </Space>
      </div>

      <Space wrap className="toolbar">
        <Select<RoleKey>
          allowClear
          placeholder="角色筛选"
          style={{ width: 140 }}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v)}
          options={ROLES.map((r) => ({ value: r.key, label: r.label }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索名称/简称"
          style={{ width: 240 }}
          onSearch={setSearch}
        />
      </Space>

      <Table<Party>
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
        expandable={{
          expandedRowRender: (row) => <PartyDetailPanel partyId={row.id} />
        }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '简称', dataIndex: 'short_name', render: (v) => v || '—' },
          {
            title: '角色',
            render: (_, row) => (
              <>
                {ROLES.filter((r) => row[r.key]).map((r) => (
                  <Tag key={r.key} color={r.color}>
                    {r.label}
                  </Tag>
                ))}
              </>
            )
          },
          { title: '联系人', dataIndex: 'contact', render: (v) => v || '—' },
          { title: '电话', dataIndex: 'phone', render: (v) => v || '—' },
          {
            title: '应收未收',
            align: 'right',
            render: (_, row) => money(balanceById.get(row.id)?.net_receivable)
          },
          {
            title: '应付未付',
            align: 'right',
            render: (_, row) => money(balanceById.get(row.id)?.net_payable)
          },
          {
            title: '应开未开发票',
            align: 'right',
            render: (_, row) => money(balanceById.get(row.id)?.net_to_issue)
          },
          {
            title: '应收未收发票',
            align: 'right',
            render: (_, row) => money(balanceById.get(row.id)?.net_to_receive)
          },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v || '—' },
          {
            title: '操作',
            width: 200,
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
        title={editing ? '编辑往来单位' : '新建往来单位'}
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
                  short_name: editing.short_name ?? '',
                  is_internal: editing.is_internal,
                  is_customer: editing.is_customer,
                  is_supplier: editing.is_supplier,
                  is_processor: editing.is_processor,
                  contact: editing.contact ?? '',
                  phone: editing.phone ?? '',
                  address: editing.address ?? '',
                  notes: editing.notes ?? ''
                }
              : {
                  name: '',
                  short_name: '',
                  is_internal: false,
                  is_customer: false,
                  is_supplier: false,
                  is_processor: false,
                  contact: '',
                  phone: '',
                  address: '',
                  notes: ''
                }
          }
        >
          <Form.Item name="name" label="单位名称" rules={[{ required: true, min: 1, max: 100 }]}>
            <Input placeholder="如 富烽、捷丰" />
          </Form.Item>
          <Form.Item name="short_name" label="简称">
            <Input placeholder="可选，用于列表紧凑显示" />
          </Form.Item>
          <Form.Item label="角色" required>
            <Space size="large">
              {ROLES.map((r) => (
                <Form.Item key={r.key} name={r.key} valuePropName="checked" noStyle>
                  <Checkbox>{r.label}</Checkbox>
                </Form.Item>
              ))}
            </Space>
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `往来单位 ${detail.name}` : ''}
        fields={
          detail
            ? [
                { label: '名称', value: detail.name },
                { label: '简称', value: detail.short_name },
                {
                  label: '角色',
                  value: ROLES.filter((r) => detail[r.key]).map((r) => r.label).join('、') || '—',
                  span: 2
                },
                { label: '联系人', value: detail.contact },
                { label: '电话', value: detail.phone },
                { label: '地址', value: detail.address, span: 2 },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
