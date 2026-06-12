import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Form, Input, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()

  return (
    <div className="login-shell">
      <div className="login-panel">
        <h1 className="login-title">汇隆特钢 ERP</h1>
        <p className="login-subtitle">会计、库存、对账一体化管理</p>
        <Form
          layout="vertical"
          initialValues={{ username: 'admin', password: 'admin123' }}
          onFinish={async (values) => {
            try {
              await login(values.username, values.password)
              navigate('/')
            } catch {
              message.error('登录失败，请检查用户名和密码')
            }
          }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            登录
          </Button>
        </Form>
      </div>
    </div>
  )
}
