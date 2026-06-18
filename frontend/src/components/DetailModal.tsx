import { Descriptions, Modal, Spin, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'

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
  width = 760
}: {
  open: boolean
  onClose: () => void
  title: string
  loading?: boolean
  fields: DetailField[]
  tables?: DetailTable[]
  width?: number
}) {
  return (
    <Modal title={title} open={open} onCancel={onClose} footer={null} width={width} destroyOnClose>
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
    </Modal>
  )
}
