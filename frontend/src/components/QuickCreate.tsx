import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Checkbox, Divider, Form, Input, Modal, Select, Space } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { ItemOption, itemTypeSelectOptions, PartyOption, useMasterDataOptions } from '../utils/lookups'
import { ItemNameSelect } from './ItemNameSelect'

type ItemType = string

type RoleKey = 'is_internal' | 'is_customer' | 'is_supplier' | 'is_processor'
const PARTY_ROLES: Array<{ key: RoleKey; label: string }> = [
  { key: 'is_internal', label: '本厂' },
  { key: 'is_customer', label: '客户' },
  { key: 'is_supplier', label: '供应商' },
  { key: 'is_processor', label: '外协厂' }
]

interface SelectOption {
  value: number
  label: string
}

/** 在下拉面板底部追加「+ 新建」按钮的通用渲染器。 */
function withCreateFooter(menu: React.ReactNode, label: string, onCreate: () => void) {
  return (
    <>
      {menu}
      <Divider style={{ margin: '4px 0' }} />
      <Button type="link" block style={{ textAlign: 'left' }} onMouseDown={(e) => e.preventDefault()} onClick={onCreate}>
        + 新建{label}
      </Button>
    </>
  )
}

/** 物品下拉 + 「+ 新建物品」弹窗。value/onChange 由 Form.Item 注入。 */
export function ItemSelect({
  options,
  value,
  onChange,
  placeholder = '搜索并选择物品',
  style
}: {
  options: SelectOption[]
  value?: number
  onChange?: (v: number) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        showSearch
        optionFilterProp="label"
        popupMatchSelectWidth={320}
        placeholder={placeholder}
        style={style ?? { width: '100%' }}
        popupRender={(menu) => withCreateFooter(menu, '物品', () => setCreateOpen(true))}
      />
      <QuickCreateItemModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(item) => {
          onChange?.(item.id)
          setCreateOpen(false)
        }}
      />
    </>
  )
}

/** 往来单位下拉 + 「+ 新建单位」弹窗。value/onChange 由 Form.Item 注入。 */
export function PartySelect({
  options,
  value,
  onChange,
  placeholder = '选择归属单位',
  style
}: {
  options: SelectOption[]
  value?: number
  onChange?: (v: number) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        showSearch
        optionFilterProp="label"
        placeholder={placeholder}
        style={style ?? { width: '100%' }}
        popupRender={(menu) => withCreateFooter(menu, '单位', () => setCreateOpen(true))}
      />
      <QuickCreatePartyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(party) => {
          onChange?.(party.id)
          setCreateOpen(false)
        }}
      />
    </>
  )
}

interface ItemFormValues {
  name: string
  item_type: ItemType
  notes?: string | null
}

/** 快速新建物品弹窗，成功后刷新物品下拉缓存并回调新建项。 */
export function QuickCreateItemModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (item: ItemOption) => void
}) {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<ItemFormValues>()
  const itemTypesQuery = useMasterDataOptions('item_type')
  const itemTypeOptions = itemTypeSelectOptions(itemTypesQuery.data)

  const createMut = useMutation({
    mutationFn: (payload: ItemFormValues) =>
      api.post<ItemOption & { is_active: boolean }>('/items', { ...payload, is_active: true }).then((r) => r.data),
    onSuccess: (item) => {
      message.success('物品已创建')
      qc.invalidateQueries({ queryKey: ['items'] })
      onCreated({ id: item.id, name: item.name, item_type: item.item_type })
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '创建失败')
    }
  })

  return (
    <Modal
      title="新建物品"
      open={open}
      onCancel={onClose}
      onOk={() => form.validateFields().then((vals) => createMut.mutate({ ...vals, notes: vals.notes || null }))}
      confirmLoading={createMut.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="name" label="名称" rules={[{ required: true, min: 1, max: 100 }]}>
          <ItemNameSelect />
        </Form.Item>
        <Form.Item name="item_type" label="类型" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="输入关键词搜索具体类别"
            loading={itemTypesQuery.isLoading}
            options={itemTypeOptions}
          />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

interface PartyFormValues {
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

/** 快速新建往来单位弹窗，成功后刷新单位下拉缓存并回调新建项。 */
export function QuickCreatePartyModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (party: PartyOption) => void
}) {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<PartyFormValues>()

  const createMut = useMutation({
    mutationFn: (payload: PartyFormValues) => api.post<PartyOption>('/parties', payload).then((r) => r.data),
    onSuccess: (party) => {
      message.success('单位已创建')
      qc.invalidateQueries({ queryKey: ['parties'] })
      onCreated(party)
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      message.error(err.response?.data?.detail ?? '创建失败')
    }
  })

  const handleOk = () => {
    form.validateFields().then((vals) => {
      if (!vals.is_internal && !vals.is_customer && !vals.is_supplier && !vals.is_processor) {
        message.error('请至少选择一个角色')
        return
      }
      createMut.mutate({
        ...vals,
        short_name: vals.short_name || null,
        contact: vals.contact || null,
        phone: vals.phone || null,
        address: vals.address || null,
        notes: vals.notes || null
      })
    })
  }

  return (
    <Modal
      title="新建往来单位"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={createMut.isPending}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ is_internal: false, is_customer: false, is_supplier: false, is_processor: false }}
      >
        <Form.Item name="name" label="单位名称" rules={[{ required: true, min: 1, max: 100 }]}>
          <Input placeholder="如 富烽、捷丰" />
        </Form.Item>
        <Form.Item name="short_name" label="简称">
          <Input placeholder="可选" />
        </Form.Item>
        <Form.Item label="角色" required>
          <Space size="large">
            {PARTY_ROLES.map((r) => (
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
  )
}
