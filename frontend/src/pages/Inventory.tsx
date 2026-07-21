import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Alert,
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
import { SpecificationSelect, useSpecificationCreator } from '../components/SpecificationSelect'
import { useAuth } from '../utils/AuthContext'
import {
  ItemOption,
  masterDataLabelMap,
  masterDataSelectOptions,
  PartyOption,
  UNIT_OPTIONS,
  itemOptions,
  partyOptions,
  useItems,
  useMasterDataOptions,
  useParties
} from '../utils/lookups'
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
  spec: string
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
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const itemTypesQ = useMasterDataOptions('item_type')
  const currentItemTypeLabels = { ...itemTypeLabels, ...masterDataLabelMap(itemTypesQ.data) }
  const itemTypeOpts = itemTypesQ.data?.length
    ? masterDataSelectOptions(itemTypesQ.data)
    : Object.entries(itemTypeLabels).map(([value, label]) => ({ value, label }))
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
  const itemOpts = itemOptions(itemList, currentItemTypeLabels)

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
        message.warning(`已删除 ${data.deleted_count} 条，跳过 ${data.skipped.length} 条（存在订单引用或库存项已不存在）`)
        modal.info({
          title: '以下库存项未删除',
          content: (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {data.skipped.map((item) => (
                <li key={item.id}>#{item.id}：{item.reason}</li>
              ))}
            </ul>
          )
        })
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
        <div className="filter-item"><span>类型：</span><Select allowClear placeholder="全部类型" value={typeFilter} onChange={setTypeFilter} options={itemTypeOpts} /></div>
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
        toolbarActions={canManage ? <><Button type="primary" onClick={() => setInOpen(true)}>+ 批量入库</Button><Button danger disabled={!selected.length} loading={batchDeleteMut.isPending} onClick={() => modal.confirm({
          title: `确认删除选中的 ${selected.length} 条库存项？`,
          content: '未被订单引用的库存项将被删除，即使仍有库存结余；被订单引用的库存项会自动跳过。',
          okButtonProps: { danger: true },
          onOk: () => batchDeleteMut.mutateAsync(selected)
        })}>批量删除</Button></> : null}
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
                  {currentItemTypeLabels[row.item.item_type] ?? row.item.item_type}
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
                  value: detail.item ? currentItemTypeLabels[detail.item.item_type] ?? detail.item.item_type : '—'
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
  const { modal } = AntApp.useApp()
  const [form] = Form.useForm<BatchInForm>()
  const { openSpecificationCreator, specificationCreatorModal } = useSpecificationCreator(form)
  const specificationsQ = useMasterDataOptions('specification')
  const specificationOpts = masterDataSelectOptions(specificationsQ.data)
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ lines: [createInLine()] }}
      onFinish={(v) => onSubmit(v)}
    >
      <Alert
        className="inventory-in-warning"
        type="error"
        showIcon
        message="重要警告：入库提交后无法修改，请谨慎入库"
        description="错误的入库数据无法在后期直接编辑，只能在未被业务订单引用时删除后重新入库。提交前请逐行核对入库日期、物品、规格、数量、单位和归属单位。"
      />
      <Alert
        className="inventory-in-rules"
        type="info"
        showIcon
        message="批量入库规则（提交前请逐行确认）"
        description={
          <div className="inventory-in-rule-content">
            <ol>
              <li>每一行代表一笔入库，入库日期、物品、规格、数量、单位和归属单位均为必填项。</li>
              <li>规格只能选择基础资料中的已有规格；没有合适规格时，点击下拉框底部“＋ 新增规格”并按规范创建。</li>
              <li>归属单位决定库存所有权，请勿把本厂库存、客户来料或其他单位库存选错归属。</li>
              <li>相同“物品＋规格＋归属单位”会累计到同一库存，计量单位必须与原库存保持一致。</li>
              <li>数量必须大于 0；重复填写相同库存组合会重复累加，请提交前检查是否存在重复行。</li>
              <li>每批可提交 1–100 行；任意一行校验或入库失败，整批都会撤销，不会只入库其中一部分。</li>
            </ol>
            <div className="inventory-in-rule-examples">
              <div><b>正确示例：</b>H13｜Φ150｜2 吨｜本厂｜选择实际入库日期</div>
              <div><b>常见错误：</b>规格中写入物品或数量、选错归属、同一库存混用“吨/千克”、误填重复行</div>
            </div>
          </div>
        }
      />
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
                <span>逐行核对必填信息；相同库存组合将累计数量</span>
              </div>
              <Space>
                <Button type="primary" ghost disabled={fields.length >= 100} icon={<PlusOutlined />} onClick={() => add(createInLine())}>
                  添加入库行
                </Button>
                <Button
                  danger
                  disabled={!selectedRowKeys.length}
                  onClick={() => modal.confirm({
                    title: `确认移除选中的 ${selectedRowKeys.length} 条入库明细？`,
                    okButtonProps: { danger: true },
                    onOk: () => {
                      remove(fields.filter((field) => selectedRowKeys.includes(field.key)).map((field) => field.name))
                      setSelectedRowKeys([])
                    }
                  })}
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
                  <Form.Item {...field} name={[field.name, 'spec']} rules={[{ required: true, message: '请选择规格' }]}>
                    <SpecificationSelect
                      showSearch
                      optionFilterProp="label"
                      options={specificationOpts}
                      onAddSpecification={() => openSpecificationCreator(['lines', field.name, 'spec'])}
                      placeholder="选择已有规格"
                      notFoundContent="暂无规格，请点击下方新增"
                    />
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
                    onClick={() => modal.confirm({
                      title: `确认删除第 ${index + 1} 条入库明细？`,
                      okButtonProps: { danger: true },
                      onOk: () => {
                        remove(field.name)
                        setSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                      }
                    })}
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
      {specificationCreatorModal}
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
      width={620}
    >
      {isAdjust && (
        <>
          <Alert
            className="inventory-adjust-warning"
            type="error"
            showIcon
            message="重要警告：错误的盘点调整可能导致草稿订单无法进行"
            description="盘点会直接改写当前可用库存。若错误调低库存，已经选用该库存的冶炼、外协、销售等草稿订单，可能在开始、审核或实际扣库时因库存不足而无法继续。请核对相关待办订单后再提交。"
          />
          <Alert
            className="inventory-adjust-rules"
            type="warning"
            showIcon
            message="盘点调整规则"
            description={
              <div className="inventory-adjust-rule-content">
                <ol>
                  <li>“实际数量”填写盘点完成后的库存总数，不是本次需要增加或减少的差额。</li>
                  <li>系统会用“实际数量－当前库存”自动计算盘盈或盘亏，并保存完整变动记录。</li>
                  <li>填写 0 表示实物库存已经为零；数量不能小于 0，计量单位沿用当前库存单位。</li>
                  <li>盘点日期应填写实际盘点发生日期；建议在备注中写明盘盈、盘亏原因和盘点依据。</li>
                  <li>提交前请确认该库存是否已被尚未执行的草稿订单选用，避免调整后库存不足。</li>
                </ol>
              </div>
            }
          />
        </>
      )}
      {!isAdjust && (
        <>
          <Alert
            className="inventory-out-warning"
            type="error"
            showIcon
            message="重要警告：错误的出库可能导致草稿订单无法进行"
            description="手工出库会立即减少当前可用库存，提交后不能直接编辑。若出库数量、物品库存或归属单位核对错误，已经选用该库存的冶炼、外协、销售等草稿订单，可能因库存不足而无法继续。请谨慎出库。"
          />
          <Alert
            className="inventory-out-rules"
            type="warning"
            showIcon
            message="出库规则"
            description={
              <div className="inventory-out-rule-content">
                <ol>
                  <li>“出库数量”填写本次要从库存中扣减的数量，不是出库后的剩余数量。</li>
                  <li>出库数量必须大于 0，且不能超过页面显示的当前库存；计量单位沿用当前库存单位。</li>
                  <li>请再次核对物品、规格和归属单位，确保从正确的库存项中扣减。</li>
                  <li>出库日期应填写实际出库发生日期；建议在备注中写明用途、领用单位或相关凭证。</li>
                  <li>提交前请确认该库存是否已被尚未执行的草稿订单选用，并预留订单所需数量。</li>
                </ol>
              </div>
            }
          />
        </>
      )}
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
          <Form.Item
            name="actual_quantity"
            label={`盘点后的实际库存总数（${target.unit}）`}
            extra="请填写最终实物总数，不要填写本次增减差额。"
            rules={[{ required: true, message: '请输入盘点后的实际库存总数' }]}
          >
            <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
          </Form.Item>
        ) : (
          <Form.Item
            name="quantity"
            label={`本次出库数量（≤ ${target.current_quantity} ${target.unit}）`}
            extra="填写本次扣减量，不要填写出库后的剩余库存。"
            rules={[{ required: true, type: 'number', min: 0.001, message: '请输入大于0且不超过当前库存的出库数量' }]}
          >
            <InputNumber min={0.001} max={Number(target.current_quantity)} step={0.001} style={{ width: '100%' }} />
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
