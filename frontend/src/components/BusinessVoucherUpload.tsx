import {
  CompressOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  InboxOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Modal, Space, Spin, Upload } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { api, getErrorMessage } from '../api/client'

export type BusinessEntityType =
  | 'steelmaking_record'
  | 'smelting_order'
  | 'outsource_order'
  | 'procurement_order'
  | 'sales_order'

export interface BusinessAttachment {
  id: number
  entity_type: BusinessEntityType
  entity_id: number
  original_name: string
  content_type: string
  file_size: number
  uploaded_by: number | null
  uploader_name: string | null
  created_at: string
  url: string
}

interface BusinessVoucherUploadProps {
  entityType: BusinessEntityType
  entityId?: number | null
  pendingFiles?: File[]
  onPendingFilesChange?: (files: File[]) => void
  readOnly?: boolean
  disabled?: boolean
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 20
const MIN_PREVIEW_SCALE = 25
const MAX_PREVIEW_SCALE = 300
const PREVIEW_SCALE_STEP = 25
const { Dragger } = Upload

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function uploadBusinessVouchers(
  entityType: BusinessEntityType,
  entityId: number,
  files: File[]
): Promise<{ uploaded: number; failures: string[] }> {
  const failures: string[] = []
  let uploaded = 0
  for (const file of files) {
    const body = new FormData()
    body.append('file', file)
    try {
      await api.post(`/media/business-attachments/${entityType}/${entityId}`, body)
      uploaded += 1
    } catch (error) {
      failures.push(`${file.name}：${getErrorMessage(error, '上传失败')}`)
    }
  }
  return { uploaded, failures }
}

export function BusinessVoucherUpload({
  entityType,
  entityId,
  pendingFiles = [],
  onPendingFilesChange,
  readOnly = false,
  disabled = false
}: BusinessVoucherUploadProps) {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('凭证预览')
  const [previewDownloadName, setPreviewDownloadName] = useState('凭证.webp')
  const [previewScale, setPreviewScale] = useState(100)
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<number | null>(null)

  const query = useQuery({
    queryKey: ['business-attachments', entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: async () =>
      (await api.get<BusinessAttachment[]>(`/media/business-attachments/${entityType}/${entityId}`)).data
  })
  const attachments = query.data ?? []

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) => api.delete(`/media/business-attachments/${attachmentId}`),
    onSuccess: () => {
      message.success('凭证已删除')
      queryClient.invalidateQueries({ queryKey: ['business-attachments', entityType, entityId] })
    },
    onError: (error) => message.error(getErrorMessage(error, '删除凭证失败'))
  })

  const uploadFiles = useMemo<UploadFile[]>(
    () => pendingFiles.map((file, index) => ({
      uid: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      type: file.type,
      originFileObj: file as UploadFile['originFileObj']
    })),
    [pendingFiles]
  )

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewScale(100)
  }

  const getDownloadName = (title: string, contentType: string) => {
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp'
    const stem = title.replace(/\.[^./\\]+$/, '') || '凭证'
    return `${stem}.${extension}`
  }

  const downloadBlobUrl = (url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const showFilePreview = (file: Blob, title: string) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewTitle(title)
    setPreviewDownloadName(getDownloadName(title, file.type))
    setPreviewScale(100)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const showAttachmentPreview = async (attachment: BusinessAttachment) => {
    try {
      const response = await api.get<Blob>(attachment.url, { responseType: 'blob' })
      showFilePreview(response.data, attachment.original_name)
    } catch (error) {
      message.error(getErrorMessage(error, '加载凭证失败'))
    }
  }

  const downloadAttachment = async (attachment: BusinessAttachment) => {
    setDownloadingAttachmentId(attachment.id)
    try {
      const response = await api.get<Blob>(attachment.url, { responseType: 'blob' })
      const objectUrl = URL.createObjectURL(response.data)
      downloadBlobUrl(objectUrl, getDownloadName(attachment.original_name, response.data.type))
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (error) {
      message.error(getErrorMessage(error, '下载凭证失败'))
    } finally {
      setDownloadingAttachmentId(null)
    }
  }

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      message.error(`${file.name}：仅支持 JPG、PNG 或 WebP 图片`)
      return Upload.LIST_IGNORE
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name}：图片大小不能超过 10MB`)
      return Upload.LIST_IGNORE
    }
    if (attachments.length + pendingFiles.length >= MAX_FILES) {
      message.error(`每张单据最多上传 ${MAX_FILES} 张凭证`)
      return Upload.LIST_IGNORE
    }
    return false
  }

  const handleUploadChange: UploadProps['onChange'] = ({ fileList }) => {
    const files = fileList.flatMap((file) => file.originFileObj ? [file.originFileObj as File] : [])
    onPendingFilesChange?.(files.slice(0, Math.max(0, MAX_FILES - attachments.length)))
  }

  return (
    <div className="business-voucher-upload">
      {!readOnly && (
        <Dragger
          accept="image/jpeg,image/png,image/webp"
          beforeUpload={beforeUpload}
          disabled={disabled}
          fileList={uploadFiles}
          listType="picture"
          maxCount={Math.max(0, MAX_FILES - attachments.length)}
          multiple
          onChange={handleUploadChange}
          onPreview={(file) => file.originFileObj && showFilePreview(file.originFileObj as File, file.name)}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">拖拽凭证图片到这里，或点击选择文件</p>
          <p className="ant-upload-hint">支持 JPG、PNG、WebP，单张最大 10MB；服务端统一转为 WebP 保存</p>
        </Dragger>
      )}

      <Spin spinning={query.isLoading}>
        {attachments.length > 0 ? (
          <div className="business-voucher-list">
            {attachments.map((attachment) => (
              <div className="business-voucher-item" key={attachment.id}>
                <FileImageOutlined />
                <div className="business-voucher-meta">
                  <strong title={attachment.original_name}>{attachment.original_name}</strong>
                  <span>
                    {formatBytes(attachment.file_size)}
                    {attachment.uploader_name ? ` · ${attachment.uploader_name}` : ''}
                  </span>
                </div>
                <Space size={4}>
                  <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => showAttachmentPreview(attachment)}>查看</Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={downloadingAttachmentId === attachment.id}
                    onClick={() => downloadAttachment(attachment)}
                  >
                    下载
                  </Button>
                  {!readOnly && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={deleteMutation.isPending && deleteMutation.variables === attachment.id}
                      onClick={() => modal.confirm({
                        title: '确认删除这张凭证？',
                        content: attachment.original_name,
                        okButtonProps: { danger: true },
                        onOk: () => deleteMutation.mutateAsync(attachment.id)
                      })}
                    >
                      删除
                    </Button>
                  )}
                </Space>
              </div>
            ))}
          </div>
        ) : readOnly && !query.isLoading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无上传凭证" />
        ) : null}
      </Spin>

      <Modal
        className="business-voucher-preview-modal"
        open={Boolean(previewUrl)}
        title={previewTitle}
        footer={(
          <div className="business-voucher-preview-footer">
            <Space.Compact>
              <Button
                icon={<ZoomOutOutlined />}
                disabled={previewScale <= MIN_PREVIEW_SCALE}
                onClick={() => setPreviewScale((scale) => Math.max(MIN_PREVIEW_SCALE, scale - PREVIEW_SCALE_STEP))}
              >
                缩小
              </Button>
              <Button icon={<CompressOutlined />} onClick={() => setPreviewScale(100)}>
                适应窗口 {previewScale}%
              </Button>
              <Button
                icon={<ZoomInOutlined />}
                disabled={previewScale >= MAX_PREVIEW_SCALE}
                onClick={() => setPreviewScale((scale) => Math.min(MAX_PREVIEW_SCALE, scale + PREVIEW_SCALE_STEP))}
              >
                放大
              </Button>
            </Space.Compact>
            <Space>
              <Button onClick={closePreview}>关闭</Button>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                disabled={!previewUrl}
                onClick={() => previewUrl && downloadBlobUrl(previewUrl, previewDownloadName)}
              >
                下载图片
              </Button>
            </Space>
          </div>
        )}
        onCancel={closePreview}
        width={900}
        centered
        destroyOnClose
      >
        {previewUrl && (
          <div className="business-voucher-preview-stage">
            <div
              className={`business-voucher-preview-canvas${previewScale === 100 ? '' : ' is-scaled'}`}
              style={{ width: `${Math.max(100, previewScale)}%` }}
            >
              <img
                src={previewUrl}
                alt={previewTitle}
                style={previewScale === 100 ? undefined : {
                  width: previewScale < 100 ? `${previewScale}%` : '100%',
                  maxWidth: 'none',
                  maxHeight: 'none'
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
