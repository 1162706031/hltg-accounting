import { PrinterOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Checkbox, Popover, Space, Table, Typography } from 'antd'
import type { Key, ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnType, TableProps } from 'antd/es/table'
import { makeSortableColumns } from '../utils/tableSorting'

type BusinessTableProps<T extends object> = TableProps<T> & {
  tableId: string
  toolbarActions?: ReactNode
  selectable?: boolean
}

function columnId<T extends object>(column: ColumnType<T>, index: number) {
  if (column.key != null) return String(column.key)
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join('.')
  if (column.dataIndex != null) return String(column.dataIndex)
  if (typeof column.title === 'string') return column.title
  return `column-${index}`
}

function isOperationColumn<T extends object>(column: ColumnType<T>) {
  return column.key === 'operation' || column.key === 'action' || (column.title === '操作' && column.fixed === 'right')
}

function readSavedColumns(storageKey: string): string[] | null {
  try {
    const value = localStorage.getItem(storageKey)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

/**
 * ERP 列表表格：行操作集中到表格上方，单行操作只在恰好选择一行时出现，
 * 同时提供可持久化的列显示设置。
 */
export function BusinessTable<T extends object>({
  tableId,
  toolbarActions,
  selectable,
  columns = [],
  rowSelection,
  dataSource,
  rowKey = 'key',
  ...tableProps
}: BusinessTableProps<T>) {
  const workspaceRef = useRef<HTMLElement>(null)
  const storageKey = `business-table-columns:${tableId}`
  const normalizedColumns = columns as ColumnType<T>[]
  const operationColumn = normalizedColumns.find(isOperationColumn)
  const configurableColumns = normalizedColumns.filter((column) => !isOperationColumn(column))
  const columnEntries = useMemo(
    () => configurableColumns.map((column, index) => ({ column, id: columnId(column, index) })),
    [columns]
  )
  const allColumnIds = useMemo(() => columnEntries.map((entry) => entry.id), [columnEntries])
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => readSavedColumns(storageKey) ?? allColumnIds)
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<Key[]>([])
  const selectedKeys = rowSelection?.selectedRowKeys ?? internalSelectedKeys

  useEffect(() => {
    setVisibleColumnIds((current) => {
      const stillValid = current.filter((id) => allColumnIds.includes(id))
      const newIds = allColumnIds.filter((id) => !current.includes(id))
      return [...stillValid, ...newIds]
    })
  }, [allColumnIds.join('|')])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleColumnIds))
    } catch {
      // 浏览器禁用存储时仍可在当前页面正常使用。
    }
  }, [storageKey, visibleColumnIds])

  const resolveKey = (record: T): Key => {
    if (typeof rowKey === 'function') return rowKey(record)
    return (record as Record<string, Key>)[rowKey as string]
  }
  const singleSelectedKey = selectedKeys.length === 1 ? selectedKeys[0] : null
  const selectedIndex = singleSelectedKey == null
    ? -1
    : (dataSource ?? []).findIndex((record) => String(resolveKey(record)) === String(singleSelectedKey))
  const selectedRecord = selectedIndex >= 0 ? (dataSource ?? [])[selectedIndex] : undefined
  // 顶层业务表始终允许多选；是否能执行某个操作由按钮自身根据选择数量判断。
  const enableSelection = selectable ?? true
  const mergedRowSelection = enableSelection
    ? {
        ...rowSelection,
        type: rowSelection?.type ?? 'checkbox',
        selectedRowKeys: selectedKeys,
        onChange: (keys: Key[], rows: T[], info: any) => {
          setInternalSelectedKeys(keys)
          rowSelection?.onChange?.(keys, rows, info)
        }
      }
    : undefined
  const visibleColumns = makeSortableColumns(
    columnEntries
      .filter((entry) => visibleColumnIds.includes(entry.id))
      .map((entry) => entry.column)
  )

  const operationButtons =
    singleSelectedKey != null && selectedRecord && operationColumn?.render
      ? (
          <Fragment key={`selected-operation-${String(singleSelectedKey)}`}>
            {operationColumn.render(undefined, selectedRecord, selectedIndex) as unknown as ReactNode}
          </Fragment>
        )
      : null

  const printSelected = () => {
    const workspace = workspaceRef.current
    if (!workspace || !selectedKeys.length) return
    const selected = new Set(selectedKeys.map(String))
    const rows = workspace.querySelectorAll<HTMLElement>('tr[data-row-key]')
    const scrollContainers = Array.from(
      workspace.querySelectorAll<HTMLElement>('.ant-table-content, .ant-table-body')
    ).map((element) => ({ element, scrollLeft: element.scrollLeft }))
    scrollContainers.forEach(({ element }) => { element.scrollLeft = 0 })
    rows.forEach((row) => row.classList.toggle('is-print-selected', selected.has(row.dataset.rowKey ?? '')))
    document.body.classList.add('business-print-mode')
    workspace.classList.add('is-print-target')
    const cleanup = () => {
      document.body.classList.remove('business-print-mode')
      workspace.classList.remove('is-print-target')
      rows.forEach((row) => row.classList.remove('is-print-selected'))
      scrollContainers.forEach(({ element, scrollLeft }) => { element.scrollLeft = scrollLeft })
    }
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
    window.setTimeout(cleanup, 60_000)
  }

  const columnSettings = (
    <div className="column-settings-panel">
      <div className="column-settings-heading">
        <Typography.Text strong>显示列</Typography.Text>
        <Button type="link" size="small" onClick={() => setVisibleColumnIds(allColumnIds)}>恢复默认</Button>
      </div>
      <Checkbox.Group
        value={visibleColumnIds}
        onChange={(values) => {
          const next = values as string[]
          if (next.length) setVisibleColumnIds(next)
        }}
      >
        <div className="column-settings-list">
          {columnEntries.map(({ column, id }) => (
            <Checkbox key={id} value={id}>
              {typeof column.title === 'string' ? column.title : id}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </div>
  )

  return (
    <section ref={workspaceRef} className="business-table-workspace">
      <div className="business-table-toolbar">
        <div className="business-table-actions">
          <Space wrap size={8}>
            {toolbarActions}
            {operationButtons}
          </Space>
          {enableSelection && (
            <Typography.Text type="secondary" className="selection-summary">
              {selectedKeys.length ? `已选择 ${selectedKeys.length} 项` : '请选择记录后操作'}
              {selectedKeys.length > 1 && operationColumn ? '；单条操作仅支持选择一项' : ''}
            </Typography.Text>
          )}
        </div>
        <Space>
          <Button icon={<PrinterOutlined />} disabled={!selectedKeys.length} onClick={printSelected}>打印所选</Button>
          <Popover content={columnSettings} trigger="click" placement="bottomRight">
            <Button icon={<SettingOutlined />}>列设置</Button>
          </Popover>
        </Space>
      </div>
      <Table<T>
        {...tableProps}
        rowKey={rowKey}
        dataSource={dataSource}
        rowSelection={mergedRowSelection}
        columns={visibleColumns}
      />
    </section>
  )
}
