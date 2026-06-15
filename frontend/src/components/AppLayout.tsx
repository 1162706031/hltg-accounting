import {
  AuditOutlined,
  BankOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  InboxOutlined,
  LogoutOutlined,
  PayCircleOutlined,
  ProductOutlined,
  ReconciliationOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined
} from '@ant-design/icons'
import { Button, Layout, Menu, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'

const { Header, Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/parties', icon: <TeamOutlined />, label: '往来单位' },
  { key: '/items', icon: <ProductOutlined />, label: '物品管理' },
  { key: '/inventory', icon: <InboxOutlined />, label: '库房管理' },
  { key: '/inventory/logs', icon: <FileTextOutlined />, label: '库存变动' },
  { key: '/smelting', icon: <ToolOutlined />, label: '冶炼加工' },
  { key: '/outsource', icon: <DeploymentUnitOutlined />, label: '外协加工' },
  { key: '/procurement', icon: <ShoppingCartOutlined />, label: '采购管理' },
  { key: '/sales', icon: <BankOutlined />, label: '销售管理' },
  { key: '/reconciliation', icon: <ReconciliationOutlined />, label: '用户对账' },
  { key: '/payments', icon: <PayCircleOutlined />, label: '收付款' },
  { key: '/invoices', icon: <FileDoneOutlined />, label: '开票记录' },
  { key: '/audit', icon: <AuditOutlined />, label: '审核中心', roles: ['reviewer', 'admin'] },
  { key: '/users', icon: <UserOutlined />, label: '用户管理', roles: ['admin'] },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' }
]

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  const visibleItems = menuItems
    .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
    .map(({ roles: _roles, ...item }) => item)

  const selectedKey =
    menuItems
      .map((item) => item.key)
      .filter((key) => location.pathname === key || (key !== '/' && location.pathname.startsWith(key)))
      .sort((a, b) => b.length - a.length)[0] ?? '/'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={216} theme="light">
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10 }}>
          <ToolOutlined />
          <Typography.Text strong>旭峰新材料 ERP</Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={visibleItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: '#fff',
            borderBottom: '1px solid #e5e8ef'
          }}
        >
          <Typography.Text type="secondary">当前用户：{user?.real_name || user?.username}</Typography.Text>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            退出
          </Button>
        </Header>
        <Content style={{ padding: 20 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
