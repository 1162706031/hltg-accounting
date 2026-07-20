import {
  DashboardOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuOutlined,
  PayCircleOutlined,
  ProductOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  ToolOutlined
} from '@ant-design/icons'
import { Button, Drawer, Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'

const { Header, Sider, Content } = Layout

interface AppMenuItem {
  key: string
  icon?: ReactNode
  label: string
  roles?: string[]
  children?: AppMenuItem[]
}

const menuItems: AppMenuItem[] = [
  { key: '/', icon: <DashboardOutlined />, label: '工作台' },
  {
    key: 'production',
    icon: <ToolOutlined />,
    label: '生产加工',
    children: [
      { key: '/steelmaking-records', label: '炼钢记录' },
      { key: '/smelting', label: '冶炼加工' },
      { key: '/outsource', label: '外协加工' }
    ]
  },
  {
    key: 'trade',
    icon: <ShoppingCartOutlined />,
    label: '购销管理',
    children: [
      { key: '/procurement', label: '采购管理' },
      { key: '/sales', label: '销售管理' }
    ]
  },
  {
    key: 'warehouse',
    icon: <InboxOutlined />,
    label: '仓库管理',
    children: [
      { key: '/inventory', label: '库房管理' },
      { key: '/inventory/logs', label: '库存变动' }
    ]
  },
  {
    key: 'finance',
    icon: <PayCircleOutlined />,
    label: '财务管理',
    children: [
      { key: '/reconciliation', label: '用户对账' },
      { key: '/payments', label: '收付款记录' },
      { key: '/invoices', label: '开票记录' }
    ]
  },
  {
    key: 'master-data',
    icon: <ProductOutlined />,
    label: '基础资料',
    children: [
      { key: '/parties', label: '往来单位' },
      { key: '/items', label: '物品管理' },
      { key: '/master-data', label: '基础资料配置', roles: ['admin', 'accountant'] }
    ]
  },
  {
    key: 'system',
    icon: <SettingOutlined />,
    label: '系统管理',
    children: [
      { key: '/audit', label: '审核中心', roles: ['reviewer', 'admin'] },
      { key: '/operation-logs', label: '操作日志', roles: ['admin'] },
      { key: '/users', label: '用户管理', roles: ['admin'] },
      { key: '/settings', label: '系统设置', roles: ['admin'] }
    ]
  }
]

function filterMenuItems(items: AppMenuItem[], role?: string): AppMenuItem[] {
  return items.flatMap((item) => {
    if (item.roles && (!role || !item.roles.includes(role))) return []
    const children = item.children ? filterMenuItems(item.children, role) : undefined
    if (item.children && !children?.length) return []
    const { roles: _roles, ...visibleItem } = item
    return [{ ...visibleItem, children }]
  })
}

function routeItems(items: AppMenuItem[]): AppMenuItem[] {
  return items.flatMap((item) => item.children ? routeItems(item.children) : item.key.startsWith('/') ? [item] : [])
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleItems = filterMenuItems(menuItems, user?.role)
  const routes = routeItems(visibleItems)

  const selectedKey =
    routes
      .map((item) => item.key)
      .filter((key) => location.pathname === key || (key !== '/' && location.pathname.startsWith(key)))
      .sort((a, b) => b.length - a.length)[0] ?? '/'
  const activeGroupKey = visibleItems.find((item) => item.children?.some((child) => child.key === selectedKey))?.key

  return (
    <Layout className="app-shell" style={{ minHeight: '100vh' }}>
      <Sider className="app-sider" width={168} theme="light">
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6 }}>
          <ToolOutlined />
          <Typography.Text strong>旭峰新材料 ERP</Typography.Text>
        </div>
        <Menu
          mode="inline"
          inlineIndent={16}
          selectedKeys={location.pathname === '/help' ? [] : [selectedKey]}
          defaultOpenKeys={activeGroupKey ? [activeGroupKey] : []}
          items={visibleItems as MenuProps['items']}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>
      <Layout className="app-main">
        <Header
          className="app-header"
        >
          <div className="app-header-leading">
            <Button
              className="mobile-menu-button"
              type="text"
              icon={<MenuOutlined />}
              aria-label="打开导航菜单"
              onClick={() => setMobileMenuOpen(true)}
            />
            <Typography.Text className="app-header-user" type="secondary">
              当前用户：{user?.real_name || user?.username}
            </Typography.Text>
          </div>
          <div className="app-header-actions">
            <Button
              className="app-header-help"
              type={location.pathname === '/help' ? 'primary' : 'default'}
              icon={<QuestionCircleOutlined />}
              aria-label="打开帮助中心"
              onClick={() => navigate('/help')}
            >
              帮助
            </Button>
            <Button
              className="app-header-logout"
              icon={<LogoutOutlined />}
              aria-label="退出系统"
              onClick={() => {
                logout()
                navigate('/login')
              }}
            >
              退出
            </Button>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
      <Drawer
        className="mobile-nav-drawer"
        title="旭峰新材料 ERP"
        placement="left"
        width={240}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <Menu
          mode="inline"
          inlineIndent={16}
          selectedKeys={location.pathname === '/help' ? [] : [selectedKey]}
          defaultOpenKeys={activeGroupKey ? [activeGroupKey] : []}
          items={visibleItems as MenuProps['items']}
          onClick={({ key }) => {
            navigate(key)
            setMobileMenuOpen(false)
          }}
          style={{ borderInlineEnd: 0 }}
        />
      </Drawer>
    </Layout>
  )
}
