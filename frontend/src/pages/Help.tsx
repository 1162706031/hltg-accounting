import { ExportOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'

const manualUrl = '/employee-manual/README.html'

export function Help() {
  return (
    <div className="page help-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">帮助中心</h1>
          <Typography.Text type="secondary">旭峰新材料 ERP 员工操作手册</Typography.Text>
        </div>
        <Button
          icon={<ExportOutlined />}
          onClick={() => window.open(manualUrl, '_blank', 'noopener,noreferrer')}
        >
          新窗口打开
        </Button>
      </div>
      <iframe
        className="help-manual-frame"
        src={manualUrl}
        title="旭峰新材料 ERP 员工操作手册"
      />
    </div>
  )
}
