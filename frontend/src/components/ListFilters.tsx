import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'

interface ListFiltersProps {
  children: ReactNode
  defaultCollapsed?: boolean
}

/** 统一的列表筛选区：字段等宽排列，并允许用户收起以腾出表格空间。 */
export function ListFilters({ children, defaultCollapsed = false }: ListFiltersProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <section className={`list-filters${collapsed ? ' is-collapsed' : ''}`} aria-label="筛选条件">
      <div className="list-filters-heading">
        <span className="list-filters-title">筛选条件</span>
        <Button
          type="link"
          size="small"
          icon={collapsed ? <DownOutlined /> : <UpOutlined />}
          iconPosition="end"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          {collapsed ? '展开' : '收起'}
        </Button>
      </div>
      {!collapsed && <div className="list-filter-grid">{children}</div>}
    </section>
  )
}
