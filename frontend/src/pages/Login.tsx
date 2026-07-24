import {
  ArrowRightOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined
} from '@ant-design/icons'
import { Button, Checkbox, Form, Input, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../utils/AuthContext'
import { useSystemSettings } from '../utils/SystemSettingsContext'

interface LoginValues {
  username: string
  password: string
  remember?: boolean
}

const REMEMBER_LOGIN_KEY = 'hltg_remember_login'

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { settings } = useSystemSettings()
  const [form] = Form.useForm<LoginValues>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_LOGIN_KEY)
    if (!saved) return

    try {
      const values = JSON.parse(saved) as Pick<LoginValues, 'username'> & { password?: string }
      form.setFieldsValue({ username: values.username, remember: true })
      // 兼容旧版本数据，并主动清除曾保存在浏览器中的密码字段。
      if (values.password) {
        localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({ username: values.username }))
      }
    } catch {
      localStorage.removeItem(REMEMBER_LOGIN_KEY)
    }
  }, [form])

  const handleFinish = async (values: LoginValues) => {
    setSubmitting(true)
    try {
      await login(values.username, values.password)
      if (values.remember) {
        localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({ username: values.username }))
      } else {
        localStorage.removeItem(REMEMBER_LOGIN_KEY)
      }
      navigate('/')
    } catch {
      message.error('登录失败，请检查用户名和密码')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-topbar">
        <span className="login-topbar-caption">企业经营管理平台</span>
        <span className="login-system-badge"><SafetyCertificateOutlined /> 企业内部系统</span>
      </div>

      <div className="login-stage">
        <section className="login-brand" aria-label="系统介绍">
          <div className="login-brand-content">
            <div className="login-hero-brand">
              <BrandMark className="login-hero-logo" />
              <span>
                <strong>{settings.companyName}</strong>
                <small>{settings.systemName}</small>
              </span>
            </div>
            <span className="login-eyebrow">BUSINESS OPERATIONS PLATFORM</span>
            <h1>把每一笔业务，<br />沉淀为清晰的经营数据。</h1>
            <p>{settings.productTagline}，为管理决策提供准确、及时、可追溯的数据支持。</p>
            <div className="login-capabilities">
              <span><CheckCircleFilled /> 生产与库存协同</span>
              <span><CheckCircleFilled /> 购销与财务闭环</span>
              <span><CheckCircleFilled /> 权限与操作留痕</span>
            </div>
          </div>
          <div className="login-brand-metric" aria-hidden="true">
            <BarChartOutlined />
            <span><strong>统一数据视图</strong><small>业务信息实时汇总</small></span>
          </div>
        </section>

        <section className="login-panel" aria-label="账号登录">
          <div className="login-heading">
            <span className="login-panel-label">欢迎使用</span>
            <h2 className="login-title">登录管理平台</h2>
            <p className="login-subtitle">请使用由管理员分配的企业账号登录</p>
          </div>
          <Form
            form={form}
            layout="vertical"
            size="large"
            onFinish={handleFinish}
            requiredMark={false}
          >
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item className="login-options" name="remember" valuePropName="checked">
              <Checkbox>记住账号</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              安全登录 <ArrowRightOutlined />
            </Button>
          </Form>
          <div className="login-security-note">
            <SafetyCertificateOutlined /> 登录即表示您同意遵守企业信息安全规范
          </div>
        </section>
      </div>

      <footer className="login-footer">
        <span>© {new Date().getFullYear()} {settings.companyName}</span>
        <a
          className="login-footer-icp"
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noreferrer"
        >
          鄂ICP备2026022112号-2
        </a>
        <span className="login-footer-security">数据安全 · 权限隔离 · 全程留痕</span>
      </footer>
    </main>
  )
}
