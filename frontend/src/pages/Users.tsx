import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'

interface User {
  id: number
  username: string
  real_name?: string | null
  role: 'admin' | 'accountant' | 'reviewer' | 'viewer'
  is_active: boolean
  created_at: string
}

const ROLE_META: Record<User['role'], { label: string; color: string }> = {
  admin: { label: '管理员', color: 'red' },
  accountant: { label: '会计', color: 'blue' },
  reviewer: { label: '审核员', color: 'green' },
  viewer: { label: '只读', color: 'default' }
}

const ROLE_OPTIONS = Object.entries(ROLE_META).map(([value, m]) => ({ value, label: m.label }))

export function Users() {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [pwTarget, setPwTarget] = useState<User | null>(null)
  const [detail, setDetail] = useState<User | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [form] = Form.useForm()
  const [pwForm] = Form.useForm()

  const query = useQuery({
    queryKey: ['users', page, pageSize],
    queryFn: async () => (await api.get<PageResult<User>>('/users', { params: { page, page_size: pageSize } })).data
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] })
  const onError = (e: any) => message.error(e.response?.data?.detail ?? '操作失败')

  const createUser = useMutation({
    mutationFn: async (values: any) => api.post('/users', values),
    onSuccess: () => {
      message.success('已创建用户')
      setCreating(false)
      form.resetFields()
      invalidate()
    },
    onError
  })

  const updateUser = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: any }) => api.put(`/users/${id}`, values),
    onSuccess: () => {
      message.success('已保存')
      setEditing(null)
      form.resetFields()
      invalidate()
    },
    onError
  })

  const deleteUser = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      message.success('已删除')
      invalidate()
    },
    onError
  })

  const resetPw = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) =>
      api.post(`/users/${id}/reset-password`, { password }),
    onSuccess: () => {
      message.success('密码已重置')
      setPwTarget(null)
      pwForm.resetFields()
    },
    onError
  })

  const openCreate = () => {
    setCreating(true)
    form.resetFields()
    form.setFieldsValue({ role: 'accountant', is_active: true })
  }

  const openEdit = (user: User) => {
    setEditing(user)
    form.setFieldsValue({ real_name: user.real_name, role: user.role, is_active: user.is_active })
  }

  const submitForm = async () => {
    const values = await form.validateFields()
    if (editing) updateUser.mutate({ id: editing.id, values })
    else createUser.mutate(values)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">用户管理</h1>
        <Button type="primary" onClick={openCreate}>
          + 新建用户
        </Button>
      </div>
      <Table<User>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'real_name', render: (v) => v ?? '—' },
          { title: '角色', dataIndex: 'role', render: (r: User['role']) => <Tag color={ROLE_META[r].color}>{ROLE_META[r].label}</Tag> },
          {
            title: '状态',
            dataIndex: 'is_active',
            render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag>
          },
          { title: '创建时间', dataIndex: 'created_at', render: (v: string) => v?.slice(0, 10) },
          {
            title: '操作',
            render: (_, row) => (
              <Space>
                <Button type="link" onClick={() => setDetail(row)}>
                  查看
                </Button>
                <Button type="link" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button type="link" onClick={() => setPwTarget(row)}>
                  重置密码
                </Button>
                <Button
                  type="link"
                  danger
                  onClick={() =>
                    modal.confirm({
                      title: `删除用户 ${row.username}？`,
                      onOk: () => deleteUser.mutateAsync(row.id)
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
        title={editing ? `编辑用户 ${editing.username}` : '新建用户'}
        open={creating || !!editing}
        onCancel={() => {
          setCreating(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={submitForm}
        confirmLoading={createUser.isPending || updateUser.isPending}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2, max: 50 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, max: 128 }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Form.Item name="real_name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="is_active" label="状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: '启用' },
                { value: false, label: '禁用' }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 — ${pwTarget?.username ?? ''}`}
        open={!!pwTarget}
        onCancel={() => {
          setPwTarget(null)
          pwForm.resetFields()
        }}
        onOk={async () => {
          const values = await pwForm.validateFields()
          if (pwTarget) resetPw.mutate({ id: pwTarget.id, password: values.password })
        }}
        confirmLoading={resetPw.isPending}
      >
        <Form form={pwForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, max: 128 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `用户 ${detail.username}` : ''}
        fields={
          detail
            ? [
                { label: '用户名', value: detail.username },
                { label: '姓名', value: detail.real_name },
                { label: '角色', value: ROLE_META[detail.role].label },
                { label: '状态', value: detail.is_active ? '启用' : '禁用' },
                { label: '创建时间', value: detail.created_at?.slice(0, 10), span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}
