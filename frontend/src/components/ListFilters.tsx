import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ReactElement, ReactNode } from 'react'
import { Children, isValidElement, useState } from 'react'

interface ListFiltersProps {
  children: ReactNode
  defaultCollapsed?: boolean
}

function isFilterAction(child: ReactNode) {
  if (!isValidElement(child)) return false
  const className = (child as ReactElement<{ className?: string }>).props.className
  return className?.split(/\s+/).includes('filter-actions') ?? false
}

/** 统一的列表筛选区：默认展示前三个字段和操作按钮，展开后展示全部字段。 */
export function ListFilters({ children, defaultCollapsed = true }: ListFiltersProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed)
  const allChildren = Children.toArray(children)
  const filterFields = allChildren.filter((child) => !isFilterAction(child))
  const actionChildren = allChildren.filter(isFilterAction)
  const hasMoreFilters = filterFields.length > 3
  const visibleChildren = expanded || !hasMoreFilters
    ? allChildren
    : [...filterFields.slice(0, 3), ...actionChildren]

  return (
    <section className={`list-filters${expanded ? ' is-expanded' : ' is-compact'}`} aria-label="筛选条件">
      <div className="list-filters-heading">
        <span className="list-filters-title">筛选条件</span>
        {hasMoreFilters && (
          <Button
            type="link"
            size="small"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            iconPosition="end"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '收起' : '展开'}
          </Button>
        )}
      </div>
      <div className="list-filter-grid">{visibleChildren}</div>
    </section>
  )
}
