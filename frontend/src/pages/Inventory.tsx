import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { ListFilters } from '../components/ListFilters'
import { DetailModal } from '../components/DetailModal'
import { ItemSelect, PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { ItemOption, PartyOption, UNIT_OPTIONS, itemOptions, partyOptions, useItems, useParties } from '../utils/lookups'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'
import { replaceCachedPageItem } from '../utils/queryCache'

interface InventoryRow {
  id: number
  item_id: number | null
  spec: string | null
  unit: string
  owner_id: number
  current_quantity: string
  notes?: string | null
  item?: { id: number; name: string; item_type: string } | null
  owner?: { id: number; name: string } | null
}

const itemTypeLabels: Record<string, string> = {
  steel_grade: '钢种',
  raw_material: '原料',
  alloy: '合金',
  finished_product: '成品',
  semi_finished: '半成品',
  scrap: '废料'
}
const itemTypeColors: Record<string, string> = {
  steel_grade: 'blue',
  raw_material: 'default',
  alloy: 'orange',
  finished_product: 'green',
  semi_finished: 'cyan',
  scrap: 'red'
}

interface InLineForm {
  item_id: number
  owner_id: number
  spec?: string
  unit: string
  quantity: number
  change_date: Dayjs
  notes?: string
}

interface BatchInForm {
  lines: InLineForm[]
}

export function Inventory() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const [typeFilter, setTypeFilter] = useState<string | undefined>()
  const [ownerFilter, setOwnerFilter] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ type: undefined as string | undefined, owner: undefined as number | undefined, search: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<number[]>([])
  const [inOpen, setInOpen] = useState(false)
  const [outTarget, setOutTarget] = useState<InventoryRow | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<InventoryRow | null>(null)
  const [detail, setDetail] = useState<InventoryRow | null>(null)

  const partiesQ = useParties()
  const partyList: PartyOption[] = partiesQ.data ?? []
  const partyOpts = partyOptions(partyList)

  const itemsQ = useItems()
  const itemList: ItemOption[] = itemsQ.data ?? []
  const itemOpts = itemOptions(itemList)

  const list = useQuery({
    queryKey: ['inventory', appliedFilters, page, pageSize],
    queryFn: async () =>
      (
        await api.get<PageResult<InventoryRow>>('/inventory', {
          params: {
            page,
            page_size: pageSize,
            item_type: appliedFilters.type,
            owner_id: appliedFilters.owner,
            q: appliedFilters.search || undefined
          }
        })
      ).data
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory'] })

  const stockInMut = useMutation({
    mutationFn: async (v: BatchInForm) =>
      (
        await api.post('/inventory/batch-in', {
          lines: v.lines.map((line) => ({
            ...line,
            change_date: line.change_date.format('YYYY-MM-DD')
          }))
        })
      ).data,
    onSuccess: (result: { processed_count: number }) => {
      message.success(`已完成 ${result.processed_count} 条入库`)
      setInOpen(false)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '入库失败')
  })

  const stockOutMut = useMutation({
    mutationFn: async ({ id, ...v }: { id: number; quantity: number; change_date: Dayjs; notes?: string }) =>
      (
        await api.post(`/inventory/${id}/out`, {
          ...v,
          change_date: v.change_date.format('YYYY-MM-DD')
        })
      ).data,
    onSuccess: (updated: InventoryRow) => {
      message.success('出库成功')
      replaceCachedPageItem(qc, ['inventory'], updated)
      setOutTarget(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '出库失败')
  })

  const adjustMut = useMutation({
    mutationFn: async ({ id, ...v }: { id: number; actual_quantity: number; change_date: Dayjs; notes?: string }) =>
      (
        await api.post(`/inventory/${id}/adjust`, {
          ...v,
          change_date: v.change_date.format('YYYY-MM-DD')
        })
      ).data,
    onSuccess: (updated: InventoryRow) => {
      message.success('盘点调整成功')
      replaceCachedPageItem(qc, ['inventory'], updated)
      setAdjustTarget(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inventory-logs'] })
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '调整失败')
  })

  const batchDeleteMut = useMutation({
    mutationFn: async (ids: number[]) => (await api.post('/inventory/batch-delete', { ids })).data,
    onSuccess: (data: { deleted_count: number; skipped: { id: number; reason: string }[] }) => {
      if (data.skipped?.length) {
        message.warning(`已删除 ${data.deleted_count} 条，跳过 ${data.skipped.length} 条（库存非空）`)
      } else {
        message.success(`已删除 ${data.deleted_count} 条`)
      }
      setSelected([])
      invalidate()
    },
    onError: (e: any) => message.error(e?.response?.data?.detail ?? '批量删除失败')
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">库房管理</h1>
      </div>
      <ListFilters>
        <div className="filter-item"><span>类型：</span><Select allowClear placeholder="全部类型" value={typeFilter} onChange={setTypeFilter} options={Object.entries(itemTypeLabels).map(([v, l]) => ({ value: v, label: l }))} /></div>
        <div className="filter-item"><span>归属：</span><Select allowClear placeholder="全部归属" value={ownerFilter} onChange={setOwnerFilter} options={partyOpts} showSearch optionFilterProp="label" /></div>
        <div className="filter-item"><span>物品：</span><Input placeholder="搜索物品/规格" allowClear value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="filter-actions"><Button type="primary" onClick={() => {
          setAppliedFilters({ type: typeFilter, owner: ownerFilter, search: search.trim() })
          setPage(1)
        }}>查询</Button>
        <Button onClick={() => {
          setTypeFilter(undefined); setOwnerFilter(undefined); setSearch('')
          setAppliedFilters({ type: undefined, owner: undefined, search: '' }); setPage(1)
        }}>重置</Button></div>
      </ListFilters>
      <BusinessTable
        tableId="inventory"
        toolbarActions={canManage ? <><Button type="primary" onClick={() => setInOpen(true)}>+ 批量入库</Button><Button danger disabled={!selected.length} onClick={() => batchDeleteMut.mutate(selected)}>批量删除</Button></> : null}
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items}
        pagination={tablePagination(list.data, page, pageSize, setPage, setPageSize)}
        scroll={{ x: 1200 }}
        onRow={(row) => ({ onDoubleClick: () => setDetail(row), style: { cursor: 'pointer' } })}
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as number[])
              }
            : undefined
        }
        columns={[
          {
            title: '类型',
            width: 90,
            render: (_, row) =>
              row.item ? (
                <Tag color={itemTypeColors[row.item.item_type] ?? 'default'}>
                  {itemTypeLabels[row.item.item_type] ?? row.item.item_type}
                </Tag>
              ) : (
                '-'
              )
          },
          { title: '物品', render: (_, row) => row.item?.name ?? '-' },
          { title: '规格', dataIndex: 'spec' },
          { title: '归属', render: (_, row) => row.owner?.name ?? '-' },
          { title: '数量', dataIndex: 'current_quantity' },
          { title: '单位', dataIndex: 'unit', width: 70 },
          { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v ?? '—' },
          {
            title: '操作',
            fixed: 'right' as const,
            width: canManage ? 220 : 80,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => setDetail(row)}>
                  查看
                </Button>
                {canManage && (
                  <>
                    <Button
                      size="small"
                      onClick={() => setOutTarget(row)}
                      disabled={Number(row.current_quantity) === 0}
                    >
                      出库
                    </Button>
                    <Button size="small" onClick={() => setAdjustTarget(row)}>
                      盘点调整
                    </Button>
                  </>
                )}
              </Space>
            )
          }
        ]}
      />

      <Modal
        title="批量入库"
        open={inOpen}
        onCancel={() => setInOpen(false)}
        confirmLoading={stockInMut.isPending}
        destroyOnClose
        width={1120}
        footer={null}
      >
        <BatchInFormModal
          partyOpts={partyOpts}
          itemOpts={itemOpts}
          onSubmit={(v) => stockInMut.mutate(v)}
          onCancel={() => setInOpen(false)}
          submitting={stockInMut.isPending}
        />
      </Modal>

      <OutAdjustModal
        key={outTarget ? `out-${outTarget.id}` : 'out-empty'}
        target={outTarget}
        kind="out"
        onClose={() => setOutTarget(null)}
        onSubmit={(v) => stockOutMut.mutate({ id: outTarget!.id, ...v })}
        submitting={stockOutMut.isPending}
      />
      <OutAdjustModal
        key={adjustTarget ? `adjust-${adjustTarget.id}` : 'adjust-empty'}
        target={adjustTarget}
        kind="adjust"
        onClose={() => setAdjustTarget(null)}
        onSubmit={(v) =>
          adjustMut.mutate({
            id: adjustTarget!.id,
            actual_quantity: v.actual_quantity as number,
            change_date: v.change_date,
            notes: v.notes
          })
        }
        submitting={adjustMut.isPending}
      />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `库存 ${detail.item?.name ?? ''}` : ''}
        fields={
          detail
            ? [
                {
                  label: '类型',
                  value: detail.item ? itemTypeLabels[detail.item.item_type] ?? detail.item.item_type : '—'
                },
                { label: '物品', value: detail.item?.name },
                { label: '规格', value: detail.spec },
                { label: '归属', value: detail.owner?.name },
                { label: '数量', value: detail.current_quantity },
                { label: '单位', value: detail.unit },
                { label: '备注', value: detail.notes, span: 2 }
              ]
            : []
        }
      />
    </div>
  )
}

function createInLine(): Partial<InLineForm> {
  return { unit: '吨', change_date: dayjs() }
}

function BatchInFormModal({
  partyOpts,
  itemOpts,
  onSubmit,
  onCancel,
  submitting
}: {
  partyOpts: { value: number; label: string }[]
  itemOpts: { value: number; label: string }[]
  onSubmit: (v: BatchInForm) => void
  onCancel: () => void
  submitting: boolean
}) {
  const [form] = Form.useForm<BatchInForm>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ lines: [createInLine()] }}
      onFinish={(v) => onSubmit(v)}
    >
      <Form.List
        name="lines"
        rules={[
          {
            validator: async (_, lines) => {
              if (!lines?.length) throw new Error('请至少添加一条入库明细')
            }
          }
        ]}
      >
        {(fields, { add, remove }, { errors }) => (
          <div className="compact-line-list inventory-in-lines">
            <div className="line-list-toolbar">
              <div>
                <div className="section-heading">入库明细</div>
                <span>可一次添加多种物品；提交失败时整批不会入库</span>
              </div>
              <Space>
                <Button type="primary" ghost disabled={fields.length >= 100} icon={<PlusOutlined />} onClick={() => add(createInLine())}>
                  添加入库行
                </Button>
                <Button
                  danger
                  disabled={!selectedRowKeys.length}
                  onClick={() => {
                    remove(fields.filter((field) => selectedRowKeys.includes(field.key)).map((field) => field.name))
                    setSelectedRowKeys([])
                  }}
                >
                  移除所选
                </Button>
              </Space>
            </div>
            <div className="line-list-table">
              {fields.length > 0 && (
                <div className="line-list-header inventory-in-line-grid">
                  <span className="line-select-cell">
                    <Checkbox
                      checked={fields.every((field) => selectedRowKeys.includes(field.key))}
                      indeterminate={fields.some((field) => selectedRowKeys.includes(field.key)) && !fields.every((field) => selectedRowKeys.includes(field.key))}
                      onChange={(event) => setSelectedRowKeys(event.target.checked ? fields.map((field) => field.key) : [])}
                    />
                  </span>
                  <span className="line-index-cell">序号</span>
                  <span>入库日期</span>
                  <span>物品</span>
                  <span>规格</span>
                  <span>数量</span>
                  <span>单位</span>
                  <span>归属</span>
                  <span>备注</span>
                  <span className="line-action-cell">操作</span>
                </div>
              )}
              {fields.map((field, index) => (
                <div key={field.key} className="line-editor-row inventory-in-line-grid">
                  <span className="line-select-cell">
                    <Checkbox
                      checked={selectedRowKeys.includes(field.key)}
                      onChange={(event) => setSelectedRowKeys((keys) =>
                        event.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key)
                      )}
                    />
                  </span>
                  <span className="line-index-cell">{index + 1}</span>
                  <Form.Item {...field} name={[field.name, 'change_date']} rules={[{ required: true, message: '请选择日期' }]}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'item_id']} rules={[{ required: true, message: '请选择物品' }]}>
                    <ItemSelect options={itemOpts} placeholder="选择物品" />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'spec']}>
                    <Input placeholder="可选" />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    name={[field.name, 'quantity']}
                    rules={[{ required: true, type: 'number', min: 0.001, message: '请输入大于 0 的数量' }]}
                  >
                    <InputNumber min={0.001} step={0.001} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'unit']} rules={[{ required: true, message: '请选择单位' }]}>
                    <Select options={UNIT_OPTIONS} />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'owner_id']} rules={[{ required: true, message: '请选择归属' }]}>
                    <PartySelect options={partyOpts} placeholder="选择归属单位" />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, 'notes']}>
                    <Input placeholder="可选" maxLength={200} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    className="line-action-cell"
                    aria-label={`删除第 ${index + 1} 行`}
                    icon={<MinusCircleOutlined />}
                    onClick={() => {
                      remove(field.name)
                      setSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                    }}
                  />
                </div>
              ))}
              {!fields.length && <div className="line-list-empty">暂无明细，请点击“添加入库行”</div>}
            </div>
            <Form.ErrorList errors={errors} />
          </div>
        )}
      </Form.List>
      <div className="inventory-in-footer">
        <Space>
          <Button onClick={onCancel} disabled={submitting}>取消</Button>
          <Button htmlType="submit" type="primary" loading={submitting}>
            确认批量入库
          </Button>
        </Space>
      </div>
    </Form>
  )
}

function OutAdjustModal({
  target,
  kind,
  onClose,
  onSubmit,
  submitting
}: {
  target: InventoryRow | null
  kind: 'out' | 'adjust'
  onClose: () => void
  onSubmit: (v: any) => void
  submitting: boolean
}) {
  const [form] = Form.useForm()
  if (!target) return null
  const isAdjust = kind === 'adjust'
  return (
    <Modal
      title={isAdjust ? `盘点调整 — ${target.item?.name ?? ''}` : `出库 — ${target.item?.name ?? ''}`}
      open={!!target}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={480}
    >
      <div style={{ background: '#f5f7fb', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
        当前库存：<b>{target.current_quantity}</b> {target.unit} · 归属：
        {target.owner?.name ?? '-'}
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={
          isAdjust
            ? { change_date: dayjs(), actual_quantity: Number(target.current_quantity) }
            : { change_date: dayjs(), quantity: 0 }
        }
        onFinish={onSubmit}
      >
        {isAdjust ? (
          <Form.Item name="actual_quantity" label={`实际数量（${target.unit}）`}>
            <InputNumber min={0} step={0.001} style={{ width: 200 }} />
          </Form.Item>
        ) : (
          <Form.Item name="quantity" label={`出库数量（≤ ${target.current_quantity} ${target.unit}）`}>
            <InputNumber min={0} max={Number(target.current_quantity)} step={0.001} style={{ width: 240 }} />
          </Form.Item>
        )}
        <Form.Item name="change_date" label={isAdjust ? '盘点日期' : '出库日期'} rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {isAdjust ? '确认调整' : '确认出库'}
            </Button>
          </Space>
        </div>
      </Form>
    </Modal>
  )
}
