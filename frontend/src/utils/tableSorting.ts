import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ColumnType, ColumnsType } from 'antd/es/table'

type SortValue = string | number | boolean | Date | null | undefined

const collator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

function getValue(record: object, dataIndex: ColumnType<any>['dataIndex']): unknown {
  if (dataIndex == null) return undefined
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex]
  return path.reduce<unknown>((value, key) => {
    if (value == null || typeof value !== 'object') return undefined
    return (value as Record<string | number, unknown>)[key]
  }, record)
}

function nodeText(node: ReactNode | { children?: ReactNode }): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(' ')
  if (isValidElement(node)) {
    return nodeText((node as ReactElement<{ children?: ReactNode }>).props.children)
  }
  if (typeof node === 'object' && 'children' in node) return nodeText(node.children)
  return ''
}

function recordValue<T extends object>(column: ColumnType<T>, record: T): SortValue {
  const rawValue = getValue(record, column.dataIndex)

  if (column.render) {
    try {
      const rendered = column.render(rawValue, record, 0)
      const renderedText = nodeText(rendered as ReactNode | { children?: ReactNode }).trim()
      if (renderedText && renderedText !== '—' && renderedText !== '-') return renderedText
    } catch {
      // 自定义渲染器异常时退回原始字段值，不影响表格正常展示。
    }
  }

  if (rawValue instanceof Date) return rawValue
  if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') return rawValue
  if (rawValue && typeof rawValue === 'object') {
    const objectValue = rawValue as Record<string, unknown>
    for (const key of ['label', 'short_name', 'name', 'title', 'code', 'id']) {
      const value = objectValue[key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    }
  }
  return undefined
}

function numericValue(value: string): number | null {
  const normalized = value.trim().replace(/[￥¥$,\s]/g, '').replace(/%$/, '')
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null
  const digits = normalized.replace(/[^\d]/g, '')
  if (!normalized.includes('.') && digits.length > 15) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function compareValues(left: SortValue, right: SortValue): number {
  const leftMissing = left == null || left === ''
  const rightMissing = right == null || right === ''
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1

  if (left instanceof Date || right instanceof Date) {
    return new Date(left as string | number | Date).getTime() - new Date(right as string | number | Date).getTime()
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') return Number(left) - Number(right)
  if (typeof left === 'number' && typeof right === 'number') return left - right

  const leftText = String(left)
  const rightText = String(right)
  const leftNumber = numericValue(leftText)
  const rightNumber = numericValue(rightText)
  if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber
  return collator.compare(leftText, rightText)
}

function isOperationColumn<T extends object>(column: ColumnType<T>) {
  return column.key === 'operation'
    || column.key === 'action'
    || (column.title === '操作' && column.fixed === 'right')
}

/**
 * 为所有数据列补充 Ant Design 的升序/降序控件。
 * 有显式 sorter 配置的列保持原配置；固定在右侧的业务操作列不参与排序。
 */
export function makeSortableColumns<T extends object>(columns: ColumnsType<T>): ColumnsType<T> {
  return columns.map((column) => {
    if ('children' in column && column.children) {
      return { ...column, children: makeSortableColumns(column.children) }
    }

    const leaf = column as ColumnType<T>
    if (isOperationColumn(leaf) || leaf.sorter !== undefined) return leaf
    return {
      ...leaf,
      sorter: (left, right) => compareValues(recordValue(leaf, left), recordValue(leaf, right))
    }
  })
}
