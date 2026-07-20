import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Form, Input, Modal, Typography } from 'antd'
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
    placeholder: '例如：Φ150',
    purpose: '规格是可供入库和业务单据直接选择的单一标准规格。',
    rules: [
      '一次只创建一个规格；不同尺寸必须分开创建。',
      '按公司统一格式填写，尺寸符号和大小写应保持一致，如统一使用“×”而非多种写法。',
      '不要夹带物品名称、数量、计量单位、炉号、供应商或临时备注。'
    ],
    validExamples: 'Φ150、300×12（每个规格分别创建）',
    invalidExamples: 'Φ150、Φ180；H13 Φ150 2吨；Φ150急用'
  }
}

const MULTIPLE_VALUE_PATTERN = /[、，,；;\/／+＋\r\n]/

interface MasterDataCreateModalProps {
  category: MasterDataCategory
  open: boolean
  onClose: () => void
  onCreated?: (option: MasterDataOption) => void
}

export function MasterDataCreateModal({ category, open, onClose, onCreated }: MasterDataCreateModalProps) {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<{ name: string }>()
  const meta = MASTER_DATA_CATEGORY_META[category]

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<MasterDataOption>('/master-data/options', { category, name }).then((response) => response.data),
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
      width={640}
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
          message="请按规范创建，基础资料会被库存和业务单据长期引用"
          description="每次只能创建一个独立名称；不能把多个名称合并，也不能将工艺、具体物品、物品类型和规格相互混填。创建后如已被业务数据使用，将不能直接删除。"
        />
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
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        onFinish={({ name }) => createMutation.mutate(name.trim())}
      >
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
      </Form>
    </Modal>
  )
}
