import {
  DashboardOutlined,
  DownOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PayCircleOutlined,
  ProductOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  ToolOutlined,
  UserOutlined
} from '@ant-design/icons'
import { Avatar, Button, Drawer, Dropdown, Layout, Menu, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { useAuth } from '../utils/AuthContext'
import { useSystemSettings } from '../utils/SystemSettingsContext'

const { Header, Sider, Content } = Layout

interface AppMenuItem {
  key: string
  icon?: ReactNode
  label: string
  roles?: string[]
  children?: AppMenuItem[]
}

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  accountant: '会计',
  reviewer: '审核员',
  viewer: '只读用户'
}

const menuItems: AppMenuItem[] = [
  { key: '/', icon: <DashboardOutlined />, label: '经营工作台' },
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
  const { user, logout, avatarUrl } = useAuth()
  const { settings, updateSettings } = useSystemSettings()
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
  const activeItem = routes.find((item) => item.key === selectedKey)
  const activeGroup = visibleItems.find((item) => item.children?.some((child) => child.key === selectedKey))
  const activeGroupKey = activeGroup?.key
  const standaloneTitle = location.pathname === '/help'
    ? '帮助中心'
    : location.pathname === '/profile'
      ? '个人中心'
      : undefined
  const pageTitle = standaloneTitle ?? activeItem?.label ?? '经营工作台'

  const signOut = () => {
    logout()
    navigate('/login')
  }

  const userMenu: MenuProps['items'] = [
    {
      key: 'identity',
      disabled: true,
      label: (
        <div className="user-menu-identity">
          <strong>{user?.real_name || user?.username}</strong>
          <span>{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</span>
        </div>
      )
    },
    { type: 'divider' },
    { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
    ...(user?.role === 'admin' ? [{ key: 'settings', icon: <SettingOutlined />, label: '系统设置' }] : []),
    { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助中心' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }
  ]

  const handleUserMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') signOut()
    if (key === 'help') navigate('/help')
    if (key === 'profile') navigate('/profile')
    if (key === 'settings') navigate('/settings')
  }

  const navigation = (
    <Menu
      className="app-navigation"
      theme="dark"
      mode="inline"
      inlineIndent={18}
      selectedKeys={standaloneTitle ? [] : [selectedKey]}
      defaultOpenKeys={activeGroupKey ? [activeGroupKey] : []}
      items={visibleItems as MenuProps['items']}
      onClick={({ key }) => navigate(key)}
    />
  )

  return (
    <Layout className="app-shell" style={{ minHeight: '100vh' }}>
      <Sider
        className="app-sider"
        width={232}
        collapsedWidth={72}
        theme="dark"
        trigger={null}
        collapsible
        collapsed={settings.sidebarCollapsed}
      >
        <button className="app-brand" type="button" onClick={() => navigate('/')} aria-label="返回工作台">
          <BrandMark />
          {!settings.sidebarCollapsed && (
            <span className="app-brand-copy">
              <strong>{settings.companyName}</strong>
              <small>{settings.systemName}</small>
            </span>
          )}
        </button>
        <div className="app-nav-label">{settings.sidebarCollapsed ? '' : '业务导航'}</div>
        {navigation}
        {!settings.sidebarCollapsed && (
          <div className="app-sider-status"><i /> 系统服务正常</div>
        )}
      </Sider>

      <Layout className="app-main">
        <Header className="app-header">
          <div className="app-header-leading">
            <Button
              className="mobile-menu-button"
              type="text"
              icon={<MenuOutlined />}
              aria-label="打开导航菜单"
              onClick={() => setMobileMenuOpen(true)}
            />
            <Tooltip title={settings.sidebarCollapsed ? '展开导航' : '收起导航'}>
              <Button
                className="desktop-collapse-button"
                type="text"
                icon={settings.sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                aria-label={settings.sidebarCollapsed ? '展开导航' : '收起导航'}
                onClick={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
              />
            </Tooltip>
            <div className="app-page-context">
              <Typography.Text type="secondary">{activeGroup?.label ?? settings.systemName}</Typography.Text>
              <strong>{pageTitle}</strong>
            </div>
          </div>

          <div className="app-header-actions">
            <Tooltip title="帮助中心">
              <Button
                className="app-header-icon-button"
                type="text"
                icon={<QuestionCircleOutlined />}
                aria-label="打开帮助中心"
                onClick={() => navigate('/help')}
              />
            </Tooltip>
            <span className="app-header-divider" />
            <Dropdown menu={{ items: userMenu, onClick: handleUserMenu }} placement="bottomRight" trigger={['click']}>
              <Button type="text" className="app-user-trigger">
                <Avatar size={32} src={avatarUrl} icon={<UserOutlined />} />
                <span className="app-user-copy">
                  <strong>{user?.real_name || user?.username}</strong>
                  <small>{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</small>
                </span>
                <DownOutlined className="app-user-chevron" />
              </Button>
            </Dropdown>
          </div>
        </Header>
        <Content className="app-content">
          <div className="app-content-inner"><Outlet /></div>
        </Content>
      </Layout>

      <Drawer
        className="mobile-nav-drawer"
        title={
          <div className="mobile-drawer-brand">
            <BrandMark />
            <span><strong>{settings.companyName}</strong><small>{settings.systemName}</small></span>
          </div>
        }
        placement="left"
        width={280}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        styles={{ body: { padding: 0, background: '#0f1f36' }, header: { background: '#0f1f36', borderColor: 'rgba(255,255,255,.1)' } }}
      >
        {navigation}
      </Drawer>
    </Layout>
  )
}
