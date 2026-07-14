import { DeleteOutlined } from '@ant-design/icons'
import { useMutation } from '@tanstack/react-query'
import { App as AntApp, Button } from 'antd'
import type { Key } from 'react'
import { api } from '../api/client'

interface BatchDeleteResult {
  deleted_count?: number
  skipped?: Array<{ id: number; reason: string }>
}

interface BatchDeleteButtonProps {
  selectedKeys: Key[]
  endpoint: string
  entityName: string
  onSuccess: () => void
}

/** 使用各业务已有的批量删除接口，并统一展示删除/跳过结果。 */
export function BatchDeleteButton({ selectedKeys, endpoint, entityName, onSuccess }: BatchDeleteButtonProps) {
  const { message, modal } = AntApp.useApp()
  const mutation = useMutation({
    mutationFn: () => api.post<BatchDeleteResult>(endpoint, { ids: selectedKeys }).then((response) => response.data),
    onSuccess: (result) => {
      const deleted = result.deleted_count ?? selectedKeys.length
      const skipped = result.skipped?.length ?? 0
      if (deleted) message.success(`已删除 ${deleted} 条${entityName}`)
      if (skipped) message.warning(`${skipped} 条因状态或关联数据限制已跳过`)
      onSuccess()
    },
    onError: (error: any) => message.error(error.response?.data?.detail ?? '批量删除失败')
  })

  return (
    <Button
      danger
      icon={<DeleteOutlined />}
      disabled={!selectedKeys.length}
      loading={mutation.isPending}
      onClick={() => modal.confirm({
        title: `确认删除选中的 ${selectedKeys.length} 条${entityName}？`,
        content: '不符合删除条件的记录会自动跳过。',
        okButtonProps: { danger: true },
        onOk: () => mutation.mutateAsync()
      })}
    >
      批量删除
    </Button>
  )
}
