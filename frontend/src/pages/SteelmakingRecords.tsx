import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
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
  Tag,
  TimePicker
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useState } from 'react'
import { api, PageResult } from '../api/client'
import { DetailModal } from '../components/DetailModal'
import { PartySelect } from '../components/QuickCreate'
import { useAuth } from '../utils/AuthContext'
import { partyOptions, useParties } from '../utils/lookups'
import { DEFAULT_PAGE_SIZE, tablePagination } from '../utils/pagination'
import { canManageData } from '../utils/permissions'

const ELEMENTS = ['C', 'Mn', 'Si', 'Cr', 'W', 'Mo', 'V', 'Co', 'Nb', 'Ni', 'P', 'S'] as const
const emptyActualComposition = () =>
  Object.fromEntries(ELEMENTS.map((code) => [code, '0'])) as Record<string, string>
type WeightUnit = 'kg' | 'ton'

interface ChemicalItem {
  id: number
  name: string
  item_type: string
  chemical_enabled: boolean
  chemical_composition?: Record<string, string> | null
  default_price?: string | null
}

interface MaterialLine {
  id?: number
  item_id: number
  item_name_snapshot?: string
  item_code_snapshot?: string | null
  chemical_composition_snapshot?: Record<string, string>
  input_weight: string
  input_weight_unit: WeightUnit
  weight_kg?: string
  default_price_snapshot?: string | null
  custom_price?: string | null
  final_unit_price?: string | null
  material_cost?: string | null
  sort_order: number
}

interface CompositionLine {
  id: number
  element_code: string
  element_name: string
  element_weight_kg: string
  theoretical_percentage: string
  actual_percentage?: string | null
  deviation_percentage?: string | null
}

interface SteelmakingRecord {
  id: number
  batch_no: string
  record_date: string
  furnace_no: string
  steel_grade: string
  owner_id: number
  owner?: { id: number; name: string } | null
  ingot_type?: string | null
  furnace_weight: string
  furnace_weight_unit: WeightUnit
  furnace_weight_kg: string
  power_on_time?: string | null
  tap_time?: string | null
  tap_temperature?: string | null
  pouring_time?: string | null
  total_cost?: string | null
  cost_per_ton?: string | null
  cost_complete: boolean
  status: 'draft' | 'confirmed'
  remark?: string | null
  materials?: MaterialLine[]
  compositions?: CompositionLine[]
}

interface FormValues {
  record_date: Dayjs
  furnace_no: string
  steel_grade: string
  owner_id: number
  ingot_type?: string
  furnace_weight: string
  furnace_weight_unit: WeightUnit
  power_on_time?: Dayjs | null
  tap_time?: Dayjs | null
  tap_temperature?: string | null
  pouring_time?: Dayjs | null
  remark?: string
  materials: Array<{
    item_id: number
    input_weight: string
    input_weight_unit: WeightUnit
    custom_price?: string | null
  }>
  actual_composition?: Record<string, string | null>
}

function compositionSummary(item: ChemicalItem) {
  const values = ELEMENTS
    .filter((code) => Number(item.chemical_composition?.[code] ?? 0) !== 0)
    .slice(0, 4)
    .map((code) => `${code}=${item.chemical_composition?.[code]}%`)
  const price = item.default_price != null ? `默认价${item.default_price}元/吨` : '无默认价'
  return `#${item.id} ${item.name}，${values.join('，') || '成分均为0'}，${price}`
}

function timeValue(value?: string | null) {
  return value ? dayjs(`2000-01-01T${value}`) : null
}

export function SteelmakingRecords() {
  const { message, modal } = AntApp.useApp()
  const { user } = useAuth()
  const canManage = canManageData(user?.role)
  const qc = useQueryClient()
  const [form] = Form.useForm<FormValues>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [batchNo, setBatchNo] = useState('')
  const [furnaceNo, setFurnaceNo] = useState('')
  const [steelGrade, setSteelGrade] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [applied, setApplied] = useState({ dateFrom: '', dateTo: '', batchNo: '', furnaceNo: '', steelGrade: '', status: '' })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingBatchNo, setEditingBatchNo] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [materialSearch, setMaterialSearch] = useState('')
  const [materialSelectedRowKeys, setMaterialSelectedRowKeys] = useState<number[]>([])
  const parties = useParties()

  const query = useQuery({
    queryKey: ['steelmaking-records', applied, page, pageSize],
    queryFn: async () => (
      await api.get<PageResult<SteelmakingRecord>>('/steelmaking-records', {
        params: {
          page,
          page_size: pageSize,
          date_from: applied.dateFrom || undefined,
          date_to: applied.dateTo || undefined,
          batch_no: applied.batchNo || undefined,
          furnace_no: applied.furnaceNo || undefined,
          steel_grade: applied.steelGrade || undefined,
          status: applied.status || undefined
        }
      })
    ).data
  })

  const detailQuery = useQuery({
    queryKey: ['steelmaking-records', 'detail', detailId],
    enabled: detailId !== null,
    queryFn: async () => (await api.get<SteelmakingRecord>(`/steelmaking-records/${detailId}`)).data
  })

  const chemicalItems = useQuery({
    queryKey: ['items', 'chemical-enabled', materialSearch],
    queryFn: async () => (
      await api.get<PageResult<ChemicalItem>>('/items', {
        params: { page: 1, page_size: 200, chemical_enabled: true, is_active: true, q: materialSearch || undefined }
      })
    ).data.items
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['steelmaking-records'] })
  const onError = (error: any) => message.error(error.response?.data?.detail ?? '操作失败')

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = {
        ...values,
        record_date: values.record_date.format('YYYY-MM-DD'),
        power_on_time: values.power_on_time?.format('HH:mm:ss') ?? null,
        tap_time: values.tap_time?.format('HH:mm:ss') ?? null,
        pouring_time: values.pouring_time?.format('HH:mm:ss') ?? null,
        materials: (values.materials ?? []).map((line, index) => ({ ...line, sort_order: index + 1 })),
        actual_composition: Object.fromEntries(
          ELEMENTS.flatMap((code) => {
            const value = values.actual_composition?.[code]
            return value == null || value === '' ? [] : [[code, value]]
          })
        )
      }
      return editingId
        ? api.put(`/steelmaking-records/${editingId}`, body)
        : api.post('/steelmaking-records', body)
    },
    onSuccess: () => {
      message.success('已保存草稿并完成后端计算')
      setOpen(false)
      setEditingId(null)
      setEditingBatchNo(null)
      setMaterialSelectedRowKeys([])
      form.resetFields()
      invalidate()
    },
    onError
  })

  const confirm = useMutation({
    mutationFn: (id: number) => api.post(`/steelmaking-records/${id}/confirm`),
    onSuccess: () => { message.success('已确认'); invalidate() },
    onError
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/steelmaking-records/${id}`),
    onSuccess: () => { message.success('已删除'); invalidate() },
    onError
  })

  const openCreate = () => {
    setEditingId(null)
    setEditingBatchNo(null)
    setMaterialSelectedRowKeys([])
    form.resetFields()
    form.setFieldsValue({
      record_date: dayjs(),
      owner_id: parties.data?.find((party) => party.is_internal)?.id,
      furnace_weight_unit: 'kg',
      materials: [],
      actual_composition: emptyActualComposition()
    })
    setOpen(true)
  }

  const openEdit = async (id: number) => {
    const row = (await api.get<SteelmakingRecord>(`/steelmaking-records/${id}`)).data
    setEditingId(id)
    setEditingBatchNo(row.batch_no)
    setMaterialSelectedRowKeys([])
    form.resetFields()
    form.setFieldsValue({
      record_date: dayjs(row.record_date),
      furnace_no: row.furnace_no,
      steel_grade: row.steel_grade,
      owner_id: row.owner_id,
      ingot_type: row.ingot_type ?? undefined,
      furnace_weight: row.furnace_weight,
      furnace_weight_unit: row.furnace_weight_unit,
      power_on_time: timeValue(row.power_on_time),
      tap_time: timeValue(row.tap_time),
      tap_temperature: row.tap_temperature,
      pouring_time: timeValue(row.pouring_time),
      remark: row.remark ?? undefined,
      materials: (row.materials ?? []).map((line) => ({
        item_id: line.item_id,
        input_weight: line.input_weight,
        input_weight_unit: line.input_weight_unit,
        custom_price: line.custom_price
      })),
      actual_composition: Object.fromEntries(
        (row.compositions ?? []).filter((line) => line.actual_percentage != null).map((line) => [line.element_code, line.actual_percentage!])
      )
    })
    setOpen(true)
  }

  const resetFilters = () => {
    setDateRange(null); setBatchNo(''); setFurnaceNo(''); setSteelGrade(''); setStatusFilter('')
    setApplied({ dateFrom: '', dateTo: '', batchNo: '', furnaceNo: '', steelGrade: '', status: '' })
    setPage(1)
  }

  const detail = detailQuery.data
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">炼钢记录</h1>
        {canManage && <Button type="primary" onClick={openCreate}>+ 新建炼钢记录</Button>}
      </div>

      <div className="toolbar">
        <div className="filter-item"><span>日期：</span><DatePicker.RangePicker value={dateRange} onChange={(v) => setDateRange(v as [Dayjs, Dayjs] | null)} /></div>
        <div className="filter-item"><span>批次号：</span><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} style={{ width: 150 }} /></div>
        <div className="filter-item"><span>炉号：</span><Input value={furnaceNo} onChange={(e) => setFurnaceNo(e.target.value)} style={{ width: 150 }} /></div>
        <div className="filter-item"><span>钢种：</span><Input value={steelGrade} onChange={(e) => setSteelGrade(e.target.value)} style={{ width: 150 }} /></div>
        <div className="filter-item"><span>状态：</span><Select value={statusFilter} onChange={setStatusFilter} style={{ width: 120 }} options={[{ value: '', label: '全部' }, { value: 'draft', label: '草稿' }, { value: 'confirmed', label: '已确认' }]} /></div>
        <div className="filter-actions">
          <Button type="primary" onClick={() => {
            setApplied({
              dateFrom: dateRange?.[0].format('YYYY-MM-DD') ?? '', dateTo: dateRange?.[1].format('YYYY-MM-DD') ?? '',
              batchNo: batchNo.trim(), furnaceNo: furnaceNo.trim(), steelGrade: steelGrade.trim(), status: statusFilter
            }); setPage(1)
          }}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>
      </div>

      <Table<SteelmakingRecord>
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items}
        pagination={tablePagination(query.data, page, pageSize, setPage, setPageSize)}
        scroll={{ x: 1250 }}
        onRow={(row) => ({ onDoubleClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: '批次号', dataIndex: 'batch_no', width: 130, render: (value) => <span style={{ whiteSpace: 'nowrap' }}>{value}</span> },
          { title: '日期', dataIndex: 'record_date', width: 110 },
          { title: '炉号', dataIndex: 'furnace_no', width: 130 },
          { title: '钢种', dataIndex: 'steel_grade', width: 130 },
          { title: '所属', dataIndex: ['owner', 'name'], width: 140, render: (value) => value ?? '—' },
          { title: '锭型', dataIndex: 'ingot_type', width: 110, render: (v) => v ?? '—' },
          { title: '炉重(kg)', dataIndex: 'furnace_weight_kg', width: 130, align: 'right' },
          { title: '总成本', dataIndex: 'total_cost', width: 130, align: 'right' },
          { title: '单吨成本', dataIndex: 'cost_per_ton', width: 130, align: 'right' },
          { title: '成本完整', dataIndex: 'cost_complete', width: 100, render: (v) => <Tag color={v ? 'green' : 'orange'}>{v ? '是' : '否'}</Tag> },
          { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'confirmed' ? 'green' : 'default'}>{v === 'confirmed' ? '已确认' : '草稿'}</Tag> },
          {
            title: '操作', fixed: 'right', width: canManage ? 210 : 70,
            render: (_, row) => <Space size={0}>
              <Button type="link" size="small" onClick={() => setDetailId(row.id)}>查看</Button>
              {canManage && row.status === 'draft' && <Button type="link" size="small" onClick={() => openEdit(row.id)}>编辑</Button>}
              {canManage && row.status === 'draft' && <Button type="link" size="small" onClick={() => confirm.mutate(row.id)}>确认</Button>}
              {canManage && <Button type="link" danger size="small" onClick={() => modal.confirm({ title: '确认删除该炼钢记录？', onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}
            </Space>
          }
        ]}
      />

      <Modal
        className="steelmaking-record-modal"
        title={editingId ? '编辑炼钢记录' : '新建炼钢记录'}
        open={open}
        width={1180}
        onCancel={() => { setOpen(false); setEditingId(null); setEditingBatchNo(null); setMaterialSelectedRowKeys([]); form.resetFields() }}
        onOk={() => form.validateFields().then((values) => save.mutate(values))}
        confirmLoading={save.isPending}
        okText="保存草稿"
      >
        <Form form={form} layout="vertical">
          <div className="steelmaking-basic-grid">
            <Form.Item label="批次号"><Input disabled value={editingBatchNo ?? ''} placeholder="保存后自动生成" /></Form.Item>
            <Form.Item name="record_date" label="日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="furnace_no" label="炉号" tooltip="留空时自动使用批次号"><Input placeholder="留空则与批次号一致" /></Form.Item>
            <Form.Item name="steel_grade" label="钢种" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="owner_id" label="所属" rules={[{ required: true, message: '请选择所属单位' }]}><PartySelect options={partyOptions(parties.data)} placeholder="选择所属单位" /></Form.Item>
            <Form.Item name="ingot_type" label="锭型"><Input /></Form.Item>
            <Form.Item name="furnace_weight" label="炉重" rules={[{ required: true }]}><InputNumber stringMode min="0.000001" precision={6} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="furnace_weight_unit" label="炉重单位" rules={[{ required: true }]}><Select options={[{ value: 'kg', label: 'kg' }, { value: 'ton', label: '吨' }]} /></Form.Item>
            <Form.Item name="power_on_time" label="送电时间"><TimePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="tap_time" label="出钢时间"><TimePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="tap_temperature" label="出钢温度(℃)"><InputNumber stringMode min="0" precision={2} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="pouring_time" label="浇注时间"><TimePicker style={{ width: '100%' }} /></Form.Item>
          </div>

          <Form.List name="materials">
            {(fields, { add, remove: removeLine }) => <div className="steelmaking-material-editor">
              <div className="steelmaking-material-toolbar">
                <div>
                  <div className="section-heading">原料投入</div>
                  <span>仅显示已启用化学成分的物品</span>
                </div>
                <Space>
                  <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => add({ input_weight_unit: 'kg' })}>添加原料</Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={materialSelectedRowKeys.length === 0}
                    onClick={() => {
                      removeLine(fields.filter((field) => materialSelectedRowKeys.includes(field.key)).map((field) => field.name))
                      setMaterialSelectedRowKeys([])
                    }}
                  >
                    移除所选
                  </Button>
                </Space>
              </div>
              <div className="steelmaking-material-table">
                <div className="steelmaking-material-header">
                  <span>
                    <Checkbox
                      checked={fields.length > 0 && fields.every((field) => materialSelectedRowKeys.includes(field.key))}
                      indeterminate={fields.some((field) => materialSelectedRowKeys.includes(field.key)) && !fields.every((field) => materialSelectedRowKeys.includes(field.key))}
                      onChange={(event) => setMaterialSelectedRowKeys(event.target.checked ? fields.map((field) => field.key) : [])}
                    />
                  </span>
                  <span>序号</span>
                  <span>原料名称 / 编号 / 成分 / 默认价</span>
                  <span>投入重量</span>
                  <span>单位</span>
                  <span>本次单价（元/吨）</span>
                  <span>操作</span>
                </div>
                {fields.length === 0 && <div className="steelmaking-material-empty">暂无原料，请点击“添加原料”新增一行</div>}
                {fields.map((field, index) => <div className="steelmaking-material-row" key={field.key}>
                  <span className="steelmaking-material-select">
                    <Checkbox
                      checked={materialSelectedRowKeys.includes(field.key)}
                      onChange={(event) => setMaterialSelectedRowKeys((keys) => event.target.checked ? [...keys, field.key] : keys.filter((key) => key !== field.key))}
                    />
                  </span>
                  <span className="steelmaking-material-index">{index + 1}</span>
                  <Form.Item name={[field.name, 'item_id']} rules={[{ required: true, message: '请选择原料' }]}>
                    <Select
                      className="steelmaking-material-select-box"
                      showSearch
                      filterOption={false}
                      popupMatchSelectWidth={620}
                      onSearch={(value) => setMaterialSearch(value.trim())}
                      placeholder="搜索名称或物品编号"
                      options={(chemicalItems.data ?? []).map((item) => {
                        const summary = compositionSummary(item)
                        return { value: item.id, label: summary, title: summary }
                      })}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'input_weight']} rules={[{ required: true, message: '请输入重量' }]}><InputNumber stringMode min="0.000001" precision={6} placeholder="请输入" style={{ width: '100%' }} /></Form.Item>
                  <Form.Item name={[field.name, 'input_weight_unit']} rules={[{ required: true }]}><Select options={[{ value: 'kg', label: 'kg' }, { value: 'ton', label: '吨' }]} /></Form.Item>
                  <Form.Item name={[field.name, 'custom_price']}><InputNumber stringMode min="0" precision={4} placeholder="留空使用默认价" style={{ width: '100%' }} /></Form.Item>
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => {
                      removeLine(field.name)
                      setMaterialSelectedRowKeys((keys) => keys.filter((key) => key !== field.key))
                    }}
                  >删除</Button>
                </div>)}
              </div>
            </div>}
          </Form.List>

          <div className="section-heading" style={{ marginTop: 18 }}>实际成品成分（%，未填按空值保存）</div>
          <div className="chemical-grid">
            {ELEMENTS.map((code) => <Form.Item key={code} name={['actual_composition', code]} label={`${code} (%)`} rules={[{ type: 'number', min: 0, max: 100, transform: (v) => Number(v) }]}>
              <InputNumber stringMode min="0" max="100" precision={6} style={{ width: '100%' }} />
            </Form.Item>)}
          </div>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <DetailModal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        loading={detailQuery.isLoading}
        title={detail ? `炼钢记录 ${detail.furnace_no}` : '炼钢记录详情'}
        width={1050}
        fields={detail ? [
          { label: '批次号', value: detail.batch_no }, { label: '日期', value: detail.record_date },
          { label: '炉号', value: detail.furnace_no },
          { label: '钢种', value: detail.steel_grade }, { label: '锭型', value: detail.ingot_type },
          { label: '所属', value: detail.owner?.name },
          { label: '原始炉重', value: `${detail.furnace_weight} ${detail.furnace_weight_unit === 'ton' ? '吨' : 'kg'}` },
          { label: '标准炉重', value: `${detail.furnace_weight_kg} kg` },
          { label: '送电时间', value: detail.power_on_time }, { label: '出钢时间', value: detail.tap_time },
          { label: '出钢温度', value: detail.tap_temperature }, { label: '浇注时间', value: detail.pouring_time },
          { label: '总成本', value: detail.total_cost }, { label: '单吨成本', value: detail.cost_per_ton },
          { label: '成本完整', value: detail.cost_complete ? '是' : '否（存在无价格原料）' },
          { label: '备注', value: detail.remark, span: 2 }
        ] : []}
        tables={detail ? [
          {
            title: '原料及成本快照', rowKey: 'id', dataSource: detail.materials ?? [],
            columns: [
              { title: '原料', dataIndex: 'item_name_snapshot' }, { title: '编号', dataIndex: 'item_code_snapshot' },
              { title: '原始重量', render: (_: any, row: MaterialLine) => `${row.input_weight} ${row.input_weight_unit === 'ton' ? '吨' : 'kg'}` },
              { title: '标准重量kg', dataIndex: 'weight_kg' }, { title: '默认价', dataIndex: 'default_price_snapshot', render: (v: string) => v ?? '—' },
              { title: '自定义价', dataIndex: 'custom_price', render: (v: string) => v ?? '—' },
              { title: '采用价', dataIndex: 'final_unit_price', render: (v: string) => v ?? '不可计算' },
              { title: '成本', dataIndex: 'material_cost', render: (v: string) => v ?? '不可计算' }
            ]
          },
          {
            title: '成分对比', rowKey: 'id', dataSource: detail.compositions ?? [],
            columns: [
              { title: '元素', dataIndex: 'element_code' },
              { title: '理论成分%', dataIndex: 'theoretical_percentage', render: (v: string) => Number(v).toFixed(4) },
              { title: '实际成分%', dataIndex: 'actual_percentage', render: (v: string | null) => v == null ? '—' : Number(v).toFixed(4) },
              { title: '偏差%', dataIndex: 'deviation_percentage', render: (v: string | null) => {
                if (v == null) return '—'; const n = Number(v)
                return <span style={{ color: n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined }}>{n > 0 ? '+' : ''}{n.toFixed(4)}</span>
              } }
            ]
          }
        ] : []}
      />
    </div>
  )
}
