import { Card, Typography } from 'antd'

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
      </div>
      <Card>
        <Typography.Text type="secondary">该模块的后端基础已预留，完整业务流程将在下一阶段接入。</Typography.Text>
      </Card>
    </div>
  )
}
