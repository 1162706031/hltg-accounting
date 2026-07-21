import { Button, Divider, Select } from 'antd'
import type { CSSProperties } from 'react'
import { useState } from 'react'
import { masterDataSelectOptions, useMasterDataOptions } from '../utils/lookups'
import { MasterDataCreateModal } from './MasterDataCreateModal'

interface ItemNameSelectProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  style?: CSSProperties
}

/** 物品名称只能从基础资料选择；找不到时通过下拉底部弹窗新增。 */
export function ItemNameSelect({
  value,
  onChange,
  placeholder = '搜索并选择已有物品名称',
  disabled,
  style
}: ItemNameSelectProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const namesQuery = useMasterDataOptions('item_name')

  return (
    <>
      <Select
        value={value || undefined}
        onChange={onChange}
        showSearch
        allowClear
        optionFilterProp="label"
        loading={namesQuery.isLoading}
        options={masterDataSelectOptions(namesQuery.data)}
        placeholder={placeholder}
        disabled={disabled}
        style={style ?? { width: '100%' }}
        notFoundContent="未找到名称，请点击下方新增"
        popupMatchSelectWidth={360}
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '4px 0' }} />
            <Button
              type="link"
              block
              style={{ textAlign: 'left' }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCreateOpen(true)}
            >
              + 新增物品名称
            </Button>
          </>
        )}
      />
      <MasterDataCreateModal
        category="item_name"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(option) => {
          onChange?.(option.name)
          setCreateOpen(false)
        }}
      />
    </>
  )
}
