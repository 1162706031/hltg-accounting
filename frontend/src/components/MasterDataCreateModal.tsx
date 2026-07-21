import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Col, Form, Input, InputNumber, Modal, Radio, Row, Typography } from 'antd'
import { api, getErrorMessage } from '../api/client'
import { MasterDataCategory, MasterDataOption } from '../utils/lookups'

export interface MasterDataCategoryMeta {
  label: string
  description: string
  placeholder: string
  purpose: string
  rules: string[]
  validExamples: string
  invalidExamples: string
}

export const MASTER_DATA_CATEGORY_META: Record<MasterDataCategory, MasterDataCategoryMeta> = {
  process: {
    label: '工艺名称',
    description: '用于新建外协单时选择加工工艺。',
    placeholder: '例如：正火',
    purpose: '工艺名称表示一种独立、可重复选择的加工工序。',
    rules: [
      '一次只创建一种工艺；“正火”和“淬火”应分别创建。',
      '只填写工艺名称，不要夹带外协厂、物品、价格或备注。',
      '名称应采用公司统一叫法；创建前先检查列表，避免同义词和重复项。'
    ],
    validExamples: '正火、淬火、抛丸（每个名称分别创建）',
    invalidExamples: '正火、淬火；某某厂锻造；退火50元'
  },
  item_type: {
    label: '物品类型',
    description: '用于物品新建、筛选及业务展示。',
    placeholder: '例如：包装物',
    purpose: '物品类型是稳定的分类名称，不是某一种具体物品。',
    rules: [
      '一次只创建一个类别；“辅料”和“包装物”应分别创建。',
      '填写类别名称，不要填写具体钢种、合金牌号、规格或供应商。',
      '分类粒度应与现有“原料、合金、成品”等保持一致，避免过细或含义重叠。'
    ],
    validExamples: '包装物、辅料（每个类别分别创建）',
    invalidExamples: '辅料/包装物；钼铁60%；Φ150圆钢'
  },
  specification: {
    label: '规格',
    description: '仓库入库只能选择这里已有的规格。',
    placeholder: '请输入其他非标准规格',
    purpose: '先选择钢材种类，再填写必要尺寸或重量，由系统生成统一规格名称。',
    rules: [
      '圆钢只填写直径，系统自动生成“Φ直径”，例如直径300生成“Φ300”。',
      '方形钢只填写长度和宽度，系统自动生成“长度×宽度”，例如300和300生成“300×300”。',
      '钢锭选择标准重量或填写自定义重量；只有“其他”种类允许手动填写最终规格。'
    ],
    validExamples: '圆钢300 → Φ300；方形钢300和300 → 300×300；钢锭1.5T → 1.5T',
    invalidExamples: '把“Φ300”直接填进直径；把物品名称、数量、炉号或备注写进规格'
  }
}

const MULTIPLE_VALUE_PATTERN = /[、，,；;\/／+＋\r\n]/

interface MasterDataCreateModalProps {
  category: MasterDataCategory
  open: boolean
  onClose: () => void
  onCreated?: (option: MasterDataOption) => void
}

type SpecificationKind = 'round_steel' | 'rectangular_steel' | 'steel_ingot' | 'other'
type IngotWeightPreset = '300kg' | '1.5T' | '4T' | 'custom'
type IngotWeightUnit = 'kg' | 'T'

interface CreateFormValues {
  name?: string
  specification_kind?: SpecificationKind
  diameter_mm?: number
  length_mm?: number
  width_mm?: number
  ingot_weight_preset?: IngotWeightPreset
  ingot_weight?: number
  ingot_weight_unit?: IngotWeightUnit
}

const SPECIFICATION_KIND_OPTIONS = [
  { value: 'round_steel', label: '圆钢', symbol: 'Φ', description: '填写直径', example: '300 → Φ300' },
  { value: 'rectangular_steel', label: '方形钢', symbol: '□', description: '填写长度和宽度', example: '300、300 → 300×300' },
  { value: 'steel_ingot', label: '钢锭', symbol: '▰', description: '选择或填写重量', example: '选择1.5T → 1.5T' },
  { value: 'other', label: '其他', symbol: '…', description: '手动填写非标规格', example: '按实际规格填写' }
]

const INGOT_WEIGHT_OPTIONS = [
  { value: '300kg', label: '300kg' },
  { value: '1.5T', label: '1.5T' },
  { value: '4T', label: '4T' },
  { value: 'custom', label: '其他重量' }
]

function formatNumber(value?: number) {
  if (value == null || !Number.isFinite(value) || value <= 0) return ''
  return String(Number(value))
}

function generatedSpecification(values: CreateFormValues) {
  if (values.specification_kind === 'round_steel') {
    const diameter = formatNumber(values.diameter_mm)
    return diameter ? `Φ${diameter}` : ''
  }
  if (values.specification_kind === 'rectangular_steel') {
    const length = formatNumber(values.length_mm)
    const width = formatNumber(values.width_mm)
    return length && width ? `${length}×${width}` : ''
  }
  if (values.specification_kind === 'steel_ingot') {
    if (values.ingot_weight_preset && values.ingot_weight_preset !== 'custom') return values.ingot_weight_preset
    const weight = formatNumber(values.ingot_weight)
    return weight && values.ingot_weight_unit ? `${weight}${values.ingot_weight_unit}` : ''
  }
  if (values.specification_kind === 'other') return values.name?.trim() ?? ''
  return ''
}

export function MasterDataCreateModal({ category, open, onClose, onCreated }: MasterDataCreateModalProps) {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<CreateFormValues>()
  const meta = MASTER_DATA_CATEGORY_META[category]
  const specificationKind = Form.useWatch('specification_kind', form)
  const diameter = Form.useWatch('diameter_mm', form)
  const length = Form.useWatch('length_mm', form)
  const width = Form.useWatch('width_mm', form)
  const ingotWeightPreset = Form.useWatch('ingot_weight_preset', form)
  const ingotWeight = Form.useWatch('ingot_weight', form)
  const ingotWeightUnit = Form.useWatch('ingot_weight_unit', form)
  const manualName = Form.useWatch('name', form)
  const specificationPreview = generatedSpecification({
    specification_kind: specificationKind,
    diameter_mm: diameter,
    length_mm: length,
    width_mm: width,
    ingot_weight_preset: ingotWeightPreset,
    ingot_weight: ingotWeight,
    ingot_weight_unit: ingotWeightUnit,
    name: manualName
  })

  const createMutation = useMutation({
    mutationFn: (values: CreateFormValues) => {
      const name = category === 'specification' ? generatedSpecification(values) : values.name?.trim()
      if (!name) throw new Error(`请完成${meta.label}信息`)
      return api.post<MasterDataOption>('/master-data/options', { category, name }).then((response) => response.data)
    },
    onSuccess: (option) => {
      qc.setQueryData<MasterDataOption[]>(['master-data-options', category], (current) => {
        if (!current) return [option]
        return current.some((item) => item.id === option.id) ? current : [...current, option]
      })
      qc.invalidateQueries({ queryKey: ['master-data-options'] })
      qc.invalidateQueries({ queryKey: ['items'] })
      message.success(`${meta.label}已添加`)
      form.resetFields()
      onCreated?.(option)
      onClose()
    },
    onError: (error: unknown) => message.error(getErrorMessage(error, '添加失败'))
  })

  const validateSingleValue = (_: unknown, value?: string) => {
    if (!value?.trim()) return Promise.reject(new Error(`请输入${meta.label}`))
    if (MULTIPLE_VALUE_PATTERN.test(value)) {
      return Promise.reject(new Error(`每次只能添加一个${meta.label}，请勿使用逗号、顿号、分号、斜杠、加号或换行合并多项`))
    }
    return Promise.resolve()
  }

  return (
    <Modal
      className="master-data-create-modal"
      open={open}
      title={`添加${meta.label}`}
      width={category === 'specification' ? 760 : 640}
      okText="确认添加"
      cancelText="取消"
      confirmLoading={createMutation.isPending}
      destroyOnClose
      onOk={() => form.submit()}
      onCancel={() => {
        if (!createMutation.isPending) {
          form.resetFields()
          onClose()
        }
      }}
    >
      <div className="master-data-create-guide">
        <Alert
          type="warning"
          showIcon
          message={category === 'specification' ? '请先选择规格种类，页面会自动生成标准格式' : '请按规范创建，基础资料会被库存和业务单据长期引用'}
          description={category === 'specification'
            ? '圆钢、方形钢和钢锭无需手动拼写规格；只有确实无法归类时才选择“其他”。创建后如已被业务数据使用，将不能直接删除。'
            : '每次只能创建一个独立名称；不能把多个名称合并，也不能将工艺、具体物品、物品类型和规格相互混填。创建后如已被业务数据使用，将不能直接删除。'}
        />
        {category === 'specification' ? (
          <div className="specification-builder-intro">
            <strong>页面生成、确认后提交</strong>
            <span>尺寸统一按毫米填写；最终只向后端提交下方预览中的规范结果。</span>
          </div>
        ) : (
          <div className="master-data-rule-card">
            <Typography.Title level={5}>{meta.label}创建规范</Typography.Title>
            <Typography.Paragraph>{meta.purpose}</Typography.Paragraph>
            <ul>
              {meta.rules.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
            <div className="master-data-example master-data-example-valid">
              <span>正确示例</span>
              <Typography.Text>{meta.validExamples}</Typography.Text>
            </div>
            <div className="master-data-example master-data-example-invalid">
              <span>错误示例</span>
              <Typography.Text>{meta.invalidExamples}</Typography.Text>
            </div>
          </div>
        )}
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={{ ingot_weight_unit: 'kg' }}
        onFinish={(values) => createMutation.mutate(values)}
      >
        {category === 'specification' ? (
          <>
            <div className="specification-step-title">
              <span>1</span>
              <div>
                <strong>选择规格种类</strong>
                <small>点击下面最符合实际物品形态的选项</small>
              </div>
            </div>
            <Form.Item
              name="specification_kind"
              className="specification-kind-form-item"
              rules={[{ required: true, message: '请选择规格种类' }]}
            >
              <Radio.Group className="specification-kind-grid">
                {SPECIFICATION_KIND_OPTIONS.map((option) => (
                  <Radio.Button key={option.value} value={option.value}>
                    <span className="specification-kind-symbol">{option.symbol}</span>
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                    <small>{option.example}</small>
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>

            {specificationKind && (
              <div className="specification-parameter-panel">
                <div className="specification-step-title">
                  <span>2</span>
                  <div>
                    <strong>填写生成参数</strong>
                    <small>页面会自动添加符号和单位，无需手动拼接</small>
                  </div>
                </div>

                {specificationKind === 'round_steel' && (
                  <Form.Item
                    name="diameter_mm"
                    preserve={false}
                    label="圆钢直径"
                    extra="只填写数字，页面会自动添加“Φ”前缀。"
                    rules={[{ required: true, message: '请输入圆钢直径' }]}
                  >
                    <InputNumber autoFocus min={0.001} max={1000000} precision={3} addonAfter="mm" placeholder="例如：300" style={{ width: '100%' }} />
                  </Form.Item>
                )}

                {specificationKind === 'rectangular_steel' && (
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="length_mm" preserve={false} label="长度" rules={[{ required: true, message: '请输入长度' }]}>
                        <InputNumber autoFocus min={0.001} max={1000000} precision={3} addonAfter="mm" placeholder="例如：300" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="width_mm" preserve={false} label="宽度" rules={[{ required: true, message: '请输入宽度' }]}>
                        <InputNumber min={0.001} max={1000000} precision={3} addonAfter="mm" placeholder="例如：300" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                )}

                {specificationKind === 'steel_ingot' && (
                  <>
                    <Form.Item name="ingot_weight_preset" preserve={false} label="选择钢锭重量" rules={[{ required: true, message: '请选择钢锭重量' }]}>
                      <Radio.Group className="ingot-weight-options" optionType="button" buttonStyle="solid" options={INGOT_WEIGHT_OPTIONS} />
                    </Form.Item>
                    {ingotWeightPreset === 'custom' && (
                      <Row gutter={12}>
                        <Col xs={24} sm={16}>
                          <Form.Item name="ingot_weight" preserve={false} label="自定义重量" rules={[{ required: true, message: '请输入重量' }]}>
                            <InputNumber autoFocus min={0.001} max={1000000} precision={3} placeholder="输入重量" style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name="ingot_weight_unit" preserve label="重量单位" rules={[{ required: true, message: '请选择单位' }]}>
                            <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: 'kg', label: 'kg' }, { value: 'T', label: 'T' }]} />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}
                  </>
                )}

                {specificationKind === 'other' && (
                  <Form.Item
                    name="name"
                    preserve={false}
                    label="其他规格名称"
                    extra="只有无法归入圆钢、方形钢或钢锭时才使用手动输入。"
                    rules={[
                      { max: 80, message: '名称最多80个字符' },
                      { validator: validateSingleValue }
                    ]}
                  >
                    <Input autoFocus allowClear maxLength={80} showCount placeholder={meta.placeholder} />
                  </Form.Item>
                )}
              </div>
            )}

            <div className="specification-result-step">
              <div className="specification-step-title">
                <span>3</span>
                <div>
                  <strong>确认生成结果</strong>
                  <small>确认无误后点击“确认添加”</small>
                </div>
              </div>
              <Alert
                className="specification-generated-preview"
                type={specificationPreview ? 'success' : 'info'}
                showIcon
                message={specificationPreview ? `最终规格：${specificationPreview}` : '请先选择种类并完成参数'}
              />
            </div>
          </>
        ) : (
          <Form.Item
            name="name"
            label={`${meta.label}名称`}
            extra="请先核对现有列表；同一分类下不能创建重名项。"
            rules={[
              { max: 80, message: '名称最多80个字符' },
              { validator: validateSingleValue }
            ]}
          >
            <Input allowClear maxLength={80} showCount placeholder={meta.placeholder} autoFocus />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
