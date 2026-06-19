import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, DatePicker, Form, FormInstance, Input, InputNumber, Select, Space } from 'antd'
import { InventoryStockOption } from '../utils/lookups'

interface InventoryLineListProps {
  /** 所属 Form 实例，用于在选中库存项后回填隐藏字段。 */
  form: FormInstance
  /** Form.List 字段名（如 items / feed_lines / alloy_lines）。 */
  name: string
  /** 区块标题。 */
  title: string
  /** 现存库存行（来自 useInventoryStock）。 */
  stock?: InventoryStockOption[]
  /** 可选的库存行过滤器，例如合金只取本厂库存。 */
  filter?: (row: InventoryStockOption) => boolean
  /** 「添加」按钮文案。 */
  addLabel?: string
  /** 库存下拉宽度。 */
  selectWidth?: number
  /** 每行日期字段名（如 date / out_date）。传入则每行显示一个日期选择器。 */
  dateField?: string
  /** 每行日期列标题。 */
  dateLabel?: string
  /** 总体日期的 Form 字段名（如 feed_date / out_date）；新增行时以它的值作默认日期。 */
  defaultDateField?: string
  /** 禁用整组明细，用于已经扣减库存后锁定原始出库内容。 */
  disabled?: boolean
  /** 禁用时展示在标题后的说明。 */
  disabledReason?: string
}

/**
 * 通用「从现存库存中选择」明细列表。
 *
 * 选中某条库存后自动回填该行的 item_id / spec / unit / owner_id（隐藏字段），
 * 数量按库存结余封顶，单价用户可自定义、也可留空。销售明细、冶炼来料/投料、
 * 补加合金共用此组件。
 */
export function InventoryLineList({
  form,
  name,
  title,
  stock,
  filter,
  addLabel = '添加明细',
  selectWidth = 320,
  dateField,
  dateLabel = '日期',
  defaultDateField,
  disabled = false,
  disabledReason
}: InventoryLineListProps) {
  const rows = (stock ?? []).filter((r) => (filter ? filter(r) : true))
  const byId = new Map<number, InventoryStockOption>(rows.map((r) => [r.id, r]))
  const options = rows.map((r) => {
    const parts = [r.item?.name ?? '未知物品']
    if (r.spec) parts.push(r.spec)
    const owner = r.owner?.name ? `（${r.owner.name}）` : ''
    return { value: r.id, label: `${parts.join(' · ')}${owner} 结余 ${r.current_quantity}${r.unit}` }
  })

  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>
            {title}
            {disabled && disabledReason ? (
              <span style={{ marginLeft: 8, color: '#8c8c8c', fontWeight: 400 }}>{disabledReason}</span>
            ) : null}
          </div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" wrap>
              {/* item_id / spec / unit / owner_id 由所选库存项自动带出，隐藏存储用于提交 */}
              <Form.Item {...field} name={[field.name, 'item_id']} hidden>
                <Input />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'spec']} hidden>
                <Input />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'unit']} hidden>
                <Input />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'owner_id']} hidden>
                <Input />
              </Form.Item>
              {dateField && (
                <Form.Item {...field} name={[field.name, dateField]} label={dateLabel}>
                  <DatePicker style={{ width: 140 }} disabled={disabled} />
                </Form.Item>
              )}
              <Form.Item
                {...field}
                name={[field.name, 'inventory_id']}
                label="库存项"
                rules={[{ required: true, message: '请选择库存项' }]}
              >
                <Select
                  style={{ width: selectWidth }}
                  showSearch
                  optionFilterProp="label"
                  placeholder="从现存库存中选择"
                  options={options}
                  disabled={disabled}
                  onChange={(invId: number) => {
                    const inv = byId.get(invId)
                    form.setFieldValue([name, field.name, 'item_id'], inv?.item_id ?? null)
                    form.setFieldValue([name, field.name, 'spec'], inv?.spec ?? null)
                    form.setFieldValue([name, field.name, 'unit'], inv?.unit ?? '吨')
                    form.setFieldValue([name, field.name, 'owner_id'], inv?.owner?.id ?? null)
                    if (inv) {
                      const maxQty = Number(inv.current_quantity)
                      const curQty = form.getFieldValue([name, field.name, 'quantity'])
                      if (Number(curQty) > maxQty) {
                        form.setFieldValue([name, field.name, 'quantity'], maxQty)
                      }
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prev, cur) =>
                  prev[name]?.[field.name]?.inventory_id !== cur[name]?.[field.name]?.inventory_id
                }
              >
                {({ getFieldValue }) => {
                  const inv = byId.get(getFieldValue([name, field.name, 'inventory_id']))
                  const maxQty = inv ? Number(inv.current_quantity) : undefined
                  const unit = inv?.unit ?? ''
                  return (
                    <Form.Item
                      {...field}
                      name={[field.name, 'quantity']}
                      label={maxQty != null ? `数量(${unit}，≤${maxQty})` : '数量'}
                      rules={[
                        { required: true },
                        {
                          validator: (_, v) =>
                            maxQty != null && Number(v) > maxQty
                              ? Promise.reject(new Error(`不能超过结余 ${maxQty}`))
                              : Promise.resolve()
                        }
                      ]}
                    >
                      <InputNumber style={{ width: 150 }} min={0} max={maxQty} step={0.001} disabled={disabled} />
                    </Form.Item>
                  )
                }}
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'unit_price']} label="单价(可选)">
                <InputNumber style={{ width: 110 }} min={0} placeholder="可不填" disabled={disabled} />
              </Form.Item>
              <MinusCircleOutlined
                style={disabled ? { color: '#bfbfbf', cursor: 'not-allowed' } : undefined}
                onClick={() => {
                  if (!disabled) remove(field.name)
                }}
              />
            </Space>
          ))}
          <Button
            type="dashed"
            disabled={disabled}
            onClick={() => {
              const row: Record<string, unknown> = { quantity: 0 }
              if (dateField && defaultDateField) {
                row[dateField] = form.getFieldValue(defaultDateField) ?? null
              }
              add(row)
            }}
            icon={<PlusOutlined />}
          >
            {addLabel}
          </Button>
        </div>
      )}
    </Form.List>
  )
}
