import { PlusOutlined } from '@ant-design/icons'
import { Button, Divider, FormInstance, Select, SelectProps } from 'antd'
import { ReactNode, useState } from 'react'
import { MasterDataOption } from '../utils/lookups'
import { MasterDataCreateModal } from './MasterDataCreateModal'

interface SpecificationSelectProps extends Omit<SelectProps<string>, 'popupRender'> {
  onAddSpecification: () => void
}

export function SpecificationSelect({
  className,
  onAddSpecification,
  onOpenChange,
  open,
  popupClassName,
  popupMatchSelectWidth,
  ...props
}: SpecificationSelectProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    setDropdownOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const renderPopup = (menu: ReactNode) => (
    <>
      {menu}
      <Divider style={{ margin: '6px 0' }} />
      <Button
        type="text"
        block
        className="specification-select-add"
        icon={<PlusOutlined />}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setDropdownOpen(false)
          onAddSpecification()
        }}
      >
        新增规格
      </Button>
    </>
  )

  return (
    <Select
      {...props}
      className={['specification-select', className].filter(Boolean).join(' ')}
      open={open ?? dropdownOpen}
      onOpenChange={handleOpenChange}
      popupClassName={['specification-select-popup', popupClassName].filter(Boolean).join(' ')}
      popupMatchSelectWidth={popupMatchSelectWidth ?? 360}
      popupRender={renderPopup}
    />
  )
}

export function useSpecificationCreator(form: FormInstance) {
  const [targetField, setTargetField] = useState<(string | number)[] | null>(null)

  return {
    openSpecificationCreator: (field: (string | number)[]) => setTargetField(field),
    specificationCreatorModal: (
      <MasterDataCreateModal
        category="specification"
        open={targetField !== null}
        onClose={() => setTargetField(null)}
        onCreated={(option: MasterDataOption) => {
          if (targetField) form.setFieldValue(targetField, option.code)
        }}
      />
    )
  }
}
