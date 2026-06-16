import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Checkbox, Form, Input, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'

interface LoginValues {
  username: string
  password: string
  remember?: boolean
}

const REMEMBER_LOGIN_KEY = 'hltg_remember_login'

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [form] = Form.useForm<LoginValues>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_LOGIN_KEY)
    if (!saved) return

    try {
      const values = JSON.parse(saved) as Pick<LoginValues, 'username' | 'password'>
      form.setFieldsValue({
        username: values.username,
        password: values.password,
        remember: true
      })
    } catch {
      localStorage.removeItem(REMEMBER_LOGIN_KEY)
    }
  }, [form])

  const handleFinish = async (values: LoginValues) => {
    setSubmitting(true)
    try {
      await login(values.username, values.password)
      if (values.remember) {
        localStorage.setItem(
          REMEMBER_LOGIN_KEY,
          JSON.stringify({ username: values.username, password: values.password })
        )
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
    <div className="login-shell">
      <div className="login-stage">
        <section className="login-brand" aria-label="系统信息">
          <div className="login-mark">HL</div>
          <h1 className="login-brand-title">旭峰新材料</h1>
          <p className="login-brand-subtitle">会计管理系统</p>
        </section>
        <section className="login-panel" aria-label="登录">
          <div className="login-heading">
            <h2 className="login-title">登录系统</h2>
            <p className="login-subtitle">请输入账号信息</p>
          </div>
          <Form
            form={form}
            layout="vertical"
            size="large"
            onFinish={handleFinish}
            requiredMark={false}
          >
            <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
              <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Form.Item className="login-options" name="remember" valuePropName="checked">
              <Checkbox>记住密码</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登录
            </Button>
          </Form>
        </section>
      </div>
    </div>
  )
}
