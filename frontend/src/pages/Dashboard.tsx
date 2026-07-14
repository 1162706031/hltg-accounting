import {
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  DollarOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  FireOutlined,
  InboxOutlined,
  PayCircleOutlined,
  ProductOutlined,
  ReconciliationOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SwapOutlined,
  ToolOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
  message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, api } from '../api/client'
import { BusinessTable } from '../components/BusinessTable'
import { useAuth } from '../utils/AuthContext'
import { OrderStatusTag, type OrderStatus } from '../utils/orderStatus'

const { RangePicker } = DatePicker

interface TrendPoint {
  date: string
  procurement: number | string
  sales: number | string
  production: number
  smelting: number
  outsource: number
  steelmaking: number
}

interface InventoryChartItem {
  item_name: string
  unit: string
  quantity: number | string
}

interface TodoItem {
  key: string
  label: string
  count: number
  level: 'warning' | 'info' | 'error' | 'default'
  path: string
}

interface RecentItem {
  kind: string
  kind_label: string
  record_id: number
  reference: string
  biz_date: string
  party_name?: string | null
  amount?: number | string | null
  status: string
  path: string
}

interface DashboardOverview {
  date_from: string
  date_to: string
  procurement_count: number
  procurement_amount: number | string
  sales_count: number
  sales_amount: number | string
  smelting_count: number
  outsource_count: number
  steelmaking_count: number
  steelmaking_cost: number | string
  cash_received: number | string
  cash_paid: number | string
  invoice_issued: number | string
  invoice_received: number | string
  receivable: number | string
  payable: number | string
  inventory_sku_count: number
  inventory_positive_count: number
  pending_audit_count: number
  trends: TrendPoint[]
  inventory_distribution: InventoryChartItem[]
  todos: TodoItem[]
  recent: RecentItem[]
}

interface AiStatus {
  configured: boolean
  reachable: boolean
  provider: string
  message: string
  default_agent_role?: string | null
  enabled_agent_roles: string[]
}

interface AiSession {
  session_id: string
  expires_at: string
  agent_role: string
  available_agent_roles: string[]
}

type RangePreset = '7d' | '30d' | 'month' | 'quarter' | 'custom'
type DateRange = [Dayjs, Dayjs]

const initialRange = (): DateRange => [dayjs().subtract(29, 'day'), dayjs()]

function presetRange(value: RangePreset): DateRange {
  const now = dayjs()
  if (value === '7d') return [now.subtract(6, 'day'), now]
  if (value === 'month') return [now.startOf('month'), now]
  if (value === 'quarter') {
    const quarterStartMonth = Math.floor(now.month() / 3) * 3
    return [now.month(quarterStartMonth).startOf('month'), now]
  }
  return initialRange()
}

const money = (value: number | string | null | undefined) =>
  Number(value ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function MetricCard({
  title,
  value,
  suffix,
  detail,
  icon,
  tone,
  onClick
}: {
  title: string
  value: string | number
  suffix?: string
  detail: string
  icon: ReactNode
  tone: string
  onClick?: () => void
}) {
  return (
    <Card className={`dashboard-metric-card ${onClick ? 'is-clickable' : ''}`} onClick={onClick}>
      <div className={`dashboard-metric-icon ${tone}`}>{icon}</div>
      <div className="dashboard-metric-content">
        <Typography.Text type="secondary">{title}</Typography.Text>
        <div className="dashboard-metric-value">
          {value}<span>{suffix}</span>
        </div>
        <Typography.Text type="secondary" className="dashboard-metric-detail">{detail}</Typography.Text>
      </div>
    </Card>
  )
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const points = useMemo(() => {
    if (!data.length) return []
    const step = Math.max(1, Math.ceil(data.length / 15))
    return data.filter((_item, index) => index % step === 0 || index === data.length - 1)
  }, [data])
  const max = Math.max(1, ...points.flatMap((item) => [Number(item.procurement), Number(item.sales)]))
  const width = 720
  const height = 210
  const chartTop = 18
  const chartBottom = 170
  const x = (index: number) => 22 + (points.length <= 1 ? 0 : index * 676 / (points.length - 1))
  const y = (value: number | string) => chartBottom - Number(value) / max * (chartBottom - chartTop)
  const polyline = (key: 'procurement' | 'sales') => points.map((item, index) => `${x(index)},${y(item[key])}`).join(' ')

  if (!points.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围暂无趋势数据" />
  return (
    <div className="dashboard-chart-wrap">
      <svg className="dashboard-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="采购销售金额趋势">
        {[0, 1, 2, 3].map((line) => {
          const lineY = chartTop + line * (chartBottom - chartTop) / 3
          return <line key={line} x1="22" y1={lineY} x2="698" y2={lineY} className="dashboard-chart-grid" />
        })}
        <polyline points={polyline('procurement')} className="dashboard-chart-line procurement" />
        <polyline points={polyline('sales')} className="dashboard-chart-line sales" />
        {points.map((item, index) => (
          <g key={item.date}>
            <circle cx={x(index)} cy={y(item.procurement)} r="3.5" className="dashboard-chart-dot procurement" />
            <circle cx={x(index)} cy={y(item.sales)} r="3.5" className="dashboard-chart-dot sales" />
            <text x={x(index)} y="198" textAnchor="middle" className="dashboard-chart-label">
              {dayjs(item.date).format('MM-DD')}
            </text>
          </g>
        ))}
      </svg>
      <div className="dashboard-chart-legend">
        <span><i className="procurement" />采购金额</span>
        <span><i className="sales" />销售金额</span>
        <span>本期生产批次 {data.reduce((sum, item) => sum + item.production, 0)}</span>
      </div>
    </div>
  )
}

function InventoryChart({ data }: { data: InventoryChartItem[] }) {
  const max = Math.max(1, ...data.map((item) => Number(item.quantity)))
  if (!data.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无正库存物品" />
  return (
    <div className="dashboard-inventory-chart">
      {data.map((item, index) => (
        <div className="dashboard-inventory-row" key={`${item.item_name}-${item.unit}`}>
          <div className="dashboard-inventory-rank">{index + 1}</div>
          <Typography.Text ellipsis={{ tooltip: item.item_name }}>{item.item_name}</Typography.Text>
          <div className="dashboard-inventory-track">
            <span style={{ width: `${Math.max(2, Number(item.quantity) / max * 100)}%` }} />
          </div>
          <strong>{Number(item.quantity).toLocaleString('zh-CN', { maximumFractionDigits: 3 })}</strong>
          <Typography.Text type="secondary">{item.unit}</Typography.Text>
        </div>
      ))}
    </div>
  )
}

function ProcessingChart({ data }: { data: TrendPoint[] }) {
  const groups = useMemo(() => {
    if (!data.length) return []
    const step = Math.max(1, Math.ceil(data.length / 12))
    const result: Array<{ label: string; smelting: number; outsource: number; steelmaking: number }> = []
    for (let index = 0; index < data.length; index += step) {
      const chunk = data.slice(index, index + step)
      const start = dayjs(chunk[0].date).format('MM-DD')
      const end = dayjs(chunk[chunk.length - 1].date).format('MM-DD')
      result.push({
        label: start === end ? start : `${start}~${end}`,
        smelting: chunk.reduce((sum, item) => sum + item.smelting, 0),
        outsource: chunk.reduce((sum, item) => sum + item.outsource, 0),
        steelmaking: chunk.reduce((sum, item) => sum + item.steelmaking, 0)
      })
    }
    return result
  }, [data])
  const max = Math.max(1, ...groups.flatMap((item) => [item.smelting, item.outsource, item.steelmaking]))
  if (!groups.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围暂无加工数据" />
  return (
    <div className="dashboard-processing-chart">
      <div className="dashboard-processing-bars">
        {groups.map((item) => (
          <div className="dashboard-processing-group" key={item.label}>
            <div className="dashboard-processing-columns">
              <span className="smelting" title={`冶炼 ${item.smelting} 批`} style={{ height: item.smelting ? `${Math.max(2, item.smelting / max * 100)}%` : 0 }} />
              <span className="outsource" title={`外协 ${item.outsource} 批`} style={{ height: item.outsource ? `${Math.max(2, item.outsource / max * 100)}%` : 0 }} />
              <span className="steelmaking" title={`炼钢 ${item.steelmaking} 批`} style={{ height: item.steelmaking ? `${Math.max(2, item.steelmaking / max * 100)}%` : 0 }} />
            </div>
            <Typography.Text type="secondary">{item.label}</Typography.Text>
          </div>
        ))}
      </div>
      <div className="dashboard-chart-legend">
        <span><i className="smelting" />冶炼加工</span>
        <span><i className="outsource" />外协加工</span>
        <span><i className="steelmaking" />炼钢记录</span>
      </div>
    </div>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange)
  const [appliedRange, setAppliedRange] = useState<DateRange>(initialRange)
  const [aiOpen, setAiOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [aiSession, setAiSession] = useState<AiSession | null>(null)
  const [aiStreaming, setAiStreaming] = useState(false)

  const queryParams = {
    date_from: appliedRange[0].format('YYYY-MM-DD'),
    date_to: appliedRange[1].format('YYYY-MM-DD')
  }
  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview', queryParams.date_from, queryParams.date_to],
    queryFn: async () => (await api.get<DashboardOverview>('/dashboard/overview', { params: queryParams })).data
  })
  const aiStatusQuery = useQuery({
    queryKey: ['dashboard-ai-status'],
    queryFn: async () => (await api.get<AiStatus>('/dashboard/ai/status')).data
  })
  const data = overviewQuery.data
  const productionCount = (data?.smelting_count ?? 0) + (data?.outsource_count ?? 0) + (data?.steelmaking_count ?? 0)
  const visibleTodos = (data?.todos ?? []).filter((item) => item.key !== 'audit' || ['admin', 'reviewer'].includes(user?.role ?? ''))

  const applyPreset = (value: RangePreset) => {
    setPreset(value)
    if (value !== 'custom') setDraftRange(presetRange(value))
  }
  const reset = () => {
    const range = initialRange()
    setPreset('30d')
    setDraftRange(range)
    setAppliedRange(range)
  }
  const createAiSession = async () => {
    const session = (await api.post<AiSession>('/dashboard/ai/session')).data
    setAiSession(session)
    return session
  }

  const ask = async () => {
    const text = question.trim()
    if (!text) return message.warning('请先输入想查询的问题')
    setAnswer('')
    setAiStreaming(true)
    try {
      let session = aiSession ?? await createAiSession()
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = localStorage.getItem('hltg_access_token')
        const response = await fetch(`${API_BASE}/dashboard/ai/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ session_id: session.session_id, message: text, agent_role: session.agent_role })
        })
        if (response.status === 409 && attempt === 0) {
          session = await createAiSession()
          continue
        }
        if (!response.ok) {
          const error = await response.json().catch(() => ({ detail: '智能问数请求失败' }))
          throw new Error(typeof error.detail === 'string' ? error.detail : '智能问数请求失败')
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('流式服务未返回响应内容')
        const decoder = new TextDecoder()
        const contents = new Map<string, string>()
        const order: string[] = []
        let buffer = ''
        let sequence = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw || raw === '[DONE]') continue
            const event = JSON.parse(raw)
            if (typeof event === 'string') {
              setAnswer(event)
            } else if (event.type === 'text') {
              sequence += 1
              const id = event.msg_id || `_message_${sequence}`
              if (!contents.has(id)) order.push(id)
              contents.set(id, event.content || '')
              setAnswer(order.map((key) => contents.get(key)).filter(Boolean).join('\n\n'))
            }
          }
        }
        break
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '智能问数服务暂时不可用')
    } finally {
      setAiStreaming(false)
    }
  }

  const recentColumns: ColumnsType<RecentItem> = [
    { title: '业务类型', dataIndex: 'kind_label', width: 100, render: (value) => <Tag>{value}</Tag> },
    { title: '日期', dataIndex: 'biz_date', width: 110 },
    { title: '批次号 / 炉号', dataIndex: 'reference', width: 160, ellipsis: true },
    { title: '往来单位', dataIndex: 'party_name', ellipsis: true, render: (value) => value || '—' },
    { title: '金额 / 成本', dataIndex: 'amount', align: 'right', width: 140, render: (value) => value == null ? '—' : `¥ ${money(value)}` },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <OrderStatusTag status={value as OrderStatus} /> },
    { title: '操作', key: 'action', fixed: 'right', width: 76, render: (_value, row) => <Button type="link" onClick={() => navigate(row.path)}>查看</Button> }
  ]

  return (
    <div className="page dashboard-page">
      <section className="dashboard-hero">
        <div>
          <Typography.Text className="dashboard-eyebrow">ERP BUSINESS OVERVIEW</Typography.Text>
          <h1>您好，{user?.real_name || user?.username}</h1>
          <p>集中查看购销、生产、库存、财务与审核数据，快速处理今日重点业务。</p>
        </div>
        <Button type="primary" size="large" icon={<RobotOutlined />} onClick={() => setAiOpen(true)}>
          智能问数
        </Button>
      </section>

      <Card className="dashboard-filter-card">
        <div className="dashboard-filter-row">
          <div className="dashboard-filter-title"><CalendarOutlined /> 统计时间</div>
          <Segmented
            value={preset}
            onChange={(value) => applyPreset(value as RangePreset)}
            options={[
              { label: '近7天', value: '7d' },
              { label: '近30天', value: '30d' },
              { label: '本月', value: 'month' },
              { label: '本季度', value: 'quarter' },
              { label: '自定义', value: 'custom' }
            ]}
          />
          <RangePicker
            value={draftRange}
            allowClear={false}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) {
                setPreset('custom')
                setDraftRange([value[0], value[1]])
              }
            }}
          />
          <Space>
            <Button type="primary" icon={<SearchOutlined />} onClick={() => setAppliedRange(draftRange)}>查询</Button>
            <Button icon={<ReloadOutlined />} onClick={reset}>重置</Button>
          </Space>
        </div>
        <Typography.Text type="secondary">
          当前统计：{appliedRange[0].format('YYYY-MM-DD')} 至 {appliedRange[1].format('YYYY-MM-DD')}
        </Typography.Text>
      </Card>

      {overviewQuery.isError && <Alert type="error" showIcon message="工作台数据加载失败" description="请检查后端服务或稍后重试。" />}
      {overviewQuery.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : data && <>
        <div className="dashboard-metric-grid">
          <MetricCard title="采购金额" value={`¥ ${money(data.procurement_amount)}`} detail={`${data.procurement_count} 笔采购订单`} icon={<ShoppingCartOutlined />} tone="blue" onClick={() => navigate('/procurement')} />
          <MetricCard title="销售金额" value={`¥ ${money(data.sales_amount)}`} detail={`${data.sales_count} 笔销售订单`} icon={<ShoppingOutlined />} tone="green" onClick={() => navigate('/sales')} />
          <MetricCard title="生产加工" value={productionCount} suffix=" 批" detail={`冶炼 ${data.smelting_count} · 外协 ${data.outsource_count} · 炼钢 ${data.steelmaking_count}`} icon={<ToolOutlined />} tone="orange" />
          <MetricCard title="炼钢原料成本" value={`¥ ${money(data.steelmaking_cost)}`} detail="按炼钢记录快照成本汇总" icon={<FireOutlined />} tone="red" onClick={() => navigate('/steelmaking-records')} />
          <MetricCard title="本期收款" value={`¥ ${money(data.cash_received)}`} detail={`开出发票 ¥ ${money(data.invoice_issued)}`} icon={<PayCircleOutlined />} tone="cyan" onClick={() => navigate('/payments')} />
          <MetricCard title="本期付款" value={`¥ ${money(data.cash_paid)}`} detail={`收到发票 ¥ ${money(data.invoice_received)}`} icon={<BankOutlined />} tone="purple" onClick={() => navigate('/payments')} />
          <MetricCard title="业务应收" value={`¥ ${money(data.receivable)}`} detail={`业务应付 ¥ ${money(data.payable)}`} icon={<DollarOutlined />} tone="gold" onClick={() => navigate('/reconciliation')} />
          <MetricCard title="库存物品" value={data.inventory_positive_count} suffix=" 项" detail={`共 ${data.inventory_sku_count} 个库存记录`} icon={<InboxOutlined />} tone="teal" onClick={() => navigate('/inventory')} />
        </div>

        <div className="dashboard-main-grid">
          <Card title="业务金额趋势" className="dashboard-chart-card" extra={<Typography.Text type="secondary">单位：元</Typography.Text>}>
            <TrendChart data={data.trends} />
          </Card>
          <Card title="待办提醒" className="dashboard-todo-card" extra={<Badge count={visibleTodos.reduce((sum, item) => sum + item.count, 0)} overflowCount={999} />}>
            <div className="dashboard-todo-list">
              {visibleTodos.map((item) => (
                <button key={item.key} type="button" onClick={() => navigate(item.path)}>
                  <span className={`dashboard-todo-dot ${item.level}`} />
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                  <span className="dashboard-todo-arrow">›</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="dashboard-analytics-grid">
          <Card
            title="当前库存分布"
            className="dashboard-analytics-card"
            extra={<Typography.Text type="secondary">按物品和单位 · 前10项</Typography.Text>}
          >
            <InventoryChart data={data.inventory_distribution} />
          </Card>
          <Card
            title="加工批次趋势"
            className="dashboard-analytics-card"
            extra={<Typography.Text type="secondary">随统计时间范围变化</Typography.Text>}
          >
            <ProcessingChart data={data.trends} />
          </Card>
        </div>

        <Card title="常用业务入口" className="dashboard-quick-card">
          <div className="dashboard-quick-grid">
            {[
              ['/procurement', '采购管理', <ShoppingCartOutlined />],
              ['/sales', '销售管理', <ShoppingOutlined />],
              ['/steelmaking-records', '炼钢记录', <ExperimentOutlined />],
              ['/smelting', '冶炼加工', <FireOutlined />],
              ['/outsource', '外协加工', <SwapOutlined />],
              ['/inventory', '库存管理', <DatabaseOutlined />],
              ['/reconciliation', '用户对账', <ReconciliationOutlined />],
              ['/invoices', '开票记录', <FileDoneOutlined />],
              ['/items', '物品管理', <ProductOutlined />],
              ...(['admin', 'reviewer'].includes(user?.role ?? '') ? [['/audit', '审核中心', <AuditOutlined />] as const] : [])
            ].map(([path, label, icon]) => (
              <button type="button" key={path as string} onClick={() => navigate(path as string)}>
                <span>{icon}</span>{label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="最近业务" extra={<Typography.Text type="secondary">最新 10 条</Typography.Text>}>
          <BusinessTable<RecentItem>
            tableId="dashboard-recent"
            rowKey={(row) => `${row.kind}-${row.record_id}`}
            columns={recentColumns}
            dataSource={data.recent}
            pagination={false}
            size="middle"
            scroll={{ x: 850 }}
          />
        </Card>
      </>}

      <Drawer title={<Space><RobotOutlined />智能问数</Space>} width={520} open={aiOpen} onClose={() => setAiOpen(false)}>
        <Alert
          type={aiStatusQuery.data?.reachable ? 'success' : 'info'}
          showIcon
          message={aiStatusQuery.data?.reachable ? `${aiStatusQuery.data.provider} 已连接` : 'AgentScope 智能体未连接'}
          description={aiStatusQuery.data?.message ?? '正在检查智能问数服务状态…'}
        />
        <Typography.Paragraph type="secondary" className="dashboard-ai-range">
          当前角色：{aiSession?.agent_role || aiStatusQuery.data?.default_agent_role || '等待连接'}。快捷问题会带上工作台所选日期，自由提问将原样发送。
        </Typography.Paragraph>
        <Typography.Text strong>您可以这样问</Typography.Text>
        <div className="dashboard-ai-suggestions">
          {[
            `查询 ${queryParams.date_from} 至 ${queryParams.date_to} 的销售额和采购额`,
            `查询 ${queryParams.date_from} 至 ${queryParams.date_to} 的待处理业务`,
            `总结 ${queryParams.date_from} 至 ${queryParams.date_to} 的生产加工和炼钢成本情况`
          ].map((item) => (
            <Button key={item} onClick={() => setQuestion(item)}>{item}</Button>
          ))}
        </div>
        <Input.TextArea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={5}
          maxLength={1000}
          showCount
          placeholder="输入有关经营、生产、库存或财务数据的问题…"
        />
        <Button
          block
          type="primary"
          size="large"
          icon={<RobotOutlined />}
          disabled={!aiStatusQuery.data?.reachable}
          loading={aiStreaming}
          onClick={ask}
          className="dashboard-ai-submit"
        >
          开始问数
        </Button>
        {!aiStatusQuery.data?.reachable && (
          <Alert
            className="dashboard-ai-config"
            type="warning"
            showIcon
            message="管理员配置后即可启用"
            description="请启动 agentscope-agent 服务，并在 ERP 后端配置 AI_AGENT_URL、AI_AGENT_API_KEY 和 AI_AGENT_ROLE。API Key 不会暴露给浏览器。"
          />
        )}
        {answer && (
          <Card className="dashboard-ai-answer" title={<Space><RobotOutlined />问数结果</Space>}>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{answer}</Typography.Paragraph>
          </Card>
        )}
      </Drawer>
    </div>
  )
}
