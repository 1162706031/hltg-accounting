import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Modal, Space } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import { availableActions, OrderStatus } from '../utils/orderStatus'

interface Props {
  /** 订单 REST 路径前缀，例如 'smelting-orders' */
  resource: string
  orderId: number
  status: OrderStatus
  /** 当前用户角色，用于决定是否显示审核/反审核按钮 */
  role?: 'admin' | 'accountant' | 'reviewer' | 'viewer'
  /** 失效查询用的 queryKey 前缀 */
  invalidateKey: string
  onEdit?: () => void
}

/** 订单工作流操作按钮组（提交/审核/驳回/开工/完成/反审核/编辑/删除）。 */
export function OrderActions({ resource, orderId, status, role, invalidateKey, onEdit }: Props) {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const actions = availableActions(status)
  const canReview = role === 'reviewer' || role === 'admin'
  const isAdmin = role === 'admin'

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [invalidateKey] })

  const act = useMutation({
    mutationFn: async ({ action, body }: { action: string; body?: any }) =>
      api.post(`/${resource}/${orderId}/${action}`, body),
    onSuccess: () => {
      message.success('操作成功')
      invalidate()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '操作失败')
  })

  const del = useMutation({
    mutationFn: async () => api.delete(`/${resource}/${orderId}`),
    onSuccess: () => {
      message.success('已删除')
      invalidate()
    },
    onError: (e: any) => message.error(e.response?.data?.detail ?? '删除失败')
  })

  return (
    <Space size={0} wrap>
      {actions.editable && onEdit && (
        <Button type="link" size="small" onClick={onEdit}>
          编辑
        </Button>
      )}
      {actions.submit && (
        <Button type="link" size="small" onClick={() => act.mutate({ action: 'submit' })}>
          提交审核
        </Button>
      )}
      {actions.approve && canReview && (
        <Button type="link" size="small" onClick={() => act.mutate({ action: 'approve' })}>
          通过
        </Button>
      )}
      {actions.reject && canReview && (
        <Button type="link" size="small" danger onClick={() => setRejectOpen(true)}>
          驳回
        </Button>
      )}
      {actions.start && (
        <Button type="link" size="small" onClick={() => act.mutate({ action: 'start' })}>
          开工
        </Button>
      )}
      {actions.complete && (
        <Button type="link" size="small" onClick={() => act.mutate({ action: 'complete' })}>
          完成
        </Button>
      )}
      {actions.unaudit && isAdmin && (
        <Button
          type="link"
          size="small"
          onClick={() =>
            modal.confirm({
              title: '反审核将回滚该订单的库存联动，确认？',
              onOk: () => act.mutateAsync({ action: 'unaudit' })
            })
          }
        >
          反审核
        </Button>
      )}
      {actions.deletable && (
        <Button
          type="link"
          size="small"
          danger
          onClick={() => modal.confirm({ title: '确认删除该订单？', onOk: () => del.mutateAsync() })}
        >
          删除
        </Button>
      )}

      <Modal
        title="驳回订单"
        open={rejectOpen}
        onCancel={() => {
          setRejectOpen(false)
          setReason('')
        }}
        onOk={() => {
          if (!reason.trim()) {
            message.warning('请填写驳回原因')
            return
          }
          act.mutate({ action: 'reject', body: { reason: reason.trim() } })
          setRejectOpen(false)
          setReason('')
        }}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="驳回原因" />
      </Modal>
    </Space>
  )
}
