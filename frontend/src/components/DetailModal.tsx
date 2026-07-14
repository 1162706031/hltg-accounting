import { PrinterOutlined } from '@ant-design/icons'
import { Button, Descriptions, Modal, Spin, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useRef } from 'react'

export interface DetailField {
  label: string
  value: React.ReactNode
  /** Descriptions 列跨度，默认 1；整行用 2 */
  span?: number
}

export interface DetailTable {
  title: string
  columns: ColumnsType<any>
  dataSource: any[]
  rowKey?: string
}

/**
 * 通用只读详情弹窗：用 Descriptions 展示主字段 + 若干只读子表。
 * 纯展示组件，不含数据获取；调用方把行数据/详情映射成 fields/tables。
 */
export function DetailModal({
  open,
  onClose,
  title,
  loading = false,
  fields,
  tables = [],
  width = 1280
}: {
  open: boolean
  onClose: () => void
  title: string
  loading?: boolean
  fields: DetailField[]
  tables?: DetailTable[]
  width?: number
}) {
  const printRef = useRef<HTMLDivElement>(null)

  const printDetail = () => {
    const target = printRef.current
    if (!target || loading) return
    // 使用脱离 Modal 的副本打印，避免弹窗的 max-height/overflow/transform 截断跨页内容。
    const printPortal = target.cloneNode(true) as HTMLDivElement
    printPortal.classList.remove('detail-print-content')
    printPortal.classList.add('detail-print-portal')
    printPortal.querySelectorAll<HTMLElement>('.ant-table-content, .ant-table-body').forEach((element) => {
      element.scrollLeft = 0
      element.scrollTop = 0
    })
    document.body.appendChild(printPortal)
    document.body.classList.add('detail-print-mode')
    const cleanup = () => {
      document.body.classList.remove('detail-print-mode')
      printPortal.remove()
    }
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
    window.setTimeout(cleanup, 60_000)
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={<><Button onClick={onClose}>关闭</Button><Button type="primary" icon={<PrinterOutlined />} disabled={loading} onClick={printDetail}>打印详情</Button></>}
      width={width}
      destroyOnClose
    >
      <div ref={printRef} className="detail-print-content">
        <h1 className="detail-print-heading">{title}</h1>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <>
          <Descriptions column={2} bordered size="small">
            {fields.map((f, i) => (
              <Descriptions.Item key={i} label={f.label} span={f.span ?? 1}>
                {f.value ?? '—'}
              </Descriptions.Item>
            ))}
          </Descriptions>
          {tables.map((t, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{t.title}</div>
              <Table
                rowKey={t.rowKey ?? 'id'}
                size="small"
                columns={t.columns}
                dataSource={t.dataSource}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: '无明细' }}
              />
            </div>
          ))}
          </>
        )}
      </div>
    </Modal>
  )
}
