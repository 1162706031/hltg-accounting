import {
  AppstoreOutlined,
  AuditOutlined,
  DesktopOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { App as AntApp, Button, Card, Form, Input, Radio, Space, Switch, Tag, Typography, Upload } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getErrorMessage } from '../api/client'
import { BrandMark } from '../components/BrandMark'
import {
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettings,
  useSystemSettings
} from '../utils/SystemSettingsContext'

type SettingsFormValues = Pick<
  SystemSettings,
  'companyName' | 'systemName' | 'productTagline' | 'sidebarCollapsed' | 'density' | 'contentWidth' | 'reducedMotion'
>

export function Settings() {
  const { message, modal } = AntApp.useApp()
  const navigate = useNavigate()
  const { settings, updateSettings, resetSettings, refreshCompanyLogo } = useSystemSettings()
  const [form] = Form.useForm<SettingsFormValues>()
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const uploadCompanyLogo = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    setUploadingLogo(true)
    try {
      await api.post('/media/company-logo', formData)
      refreshCompanyLogo()
      message.success('企业 Logo 已更新')
    } catch (error) {
      message.error(getErrorMessage(error, '企业 Logo 上传失败'))
    } finally {
      setUploadingLogo(false)
    }
    return Upload.LIST_IGNORE
  }

  const save = async () => {
    const values = await form.validateFields()
    updateSettings(values)
    message.success('系统设置已保存并生效')
  }

  const reset = () => {
    modal.confirm({
      title: '恢复默认设置？',
      content: '企业名称、系统名称和界面偏好将恢复为初始值。',
      okText: '恢复默认',
      cancelText: '取消',
      onOk: () => {
        resetSettings()
        form.setFieldsValue(DEFAULT_SYSTEM_SETTINGS)
        message.success('已恢复默认设置')
      }
    })
  }

  return (
    <div className="page settings-page">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <span className="settings-title-icon"><SettingOutlined /></span>
            <div>
              <h1 className="page-title">系统设置</h1>
              <Typography.Text type="secondary">管理系统品牌信息与当前设备的界面偏好</Typography.Text>
            </div>
          </div>
        </div>
        <Tag color="blue">仅管理员可见</Tag>
      </div>

      <div className="settings-overview-grid">
        <Card className="settings-overview-card">
          <span className="settings-overview-icon blue"><DesktopOutlined /></span>
          <div><strong>当前终端</strong><span>Web 管理端 · 设置已同步</span></div>
        </Card>
        <Card className="settings-overview-card">
          <span className="settings-overview-icon green"><SafetyCertificateOutlined /></span>
          <div><strong>访问控制</strong><span>管理员权限 · 操作受保护</span></div>
        </Card>
        <Card className="settings-overview-card">
          <span className="settings-overview-icon gold"><AppstoreOutlined /></span>
          <div><strong>界面模式</strong><span>{settings.density === 'compact' ? '紧凑布局' : '舒适布局'} · {settings.contentWidth === 'fluid' ? '自适应宽度' : '居中宽度'}</span></div>
        </Card>
      </div>

      <Form form={form} layout="vertical" initialValues={settings} onFinish={save}>
        <div className="settings-layout">
          <div className="settings-main-column">
            <Card className="settings-card" title={<span><AppstoreOutlined /> 品牌信息</span>}>
              <Typography.Paragraph type="secondary" className="settings-card-intro">
                以下名称会展示在登录页、侧边导航和浏览器标题中。
              </Typography.Paragraph>
              <div className="settings-logo-uploader">
                <BrandMark className="settings-logo-mark" />
                <div>
                  <strong>企业 Logo</strong>
                  <span>建议使用正方形透明底图片，支持 JPG、PNG、WebP，最大 2MB。</span>
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    showUploadList={false}
                    beforeUpload={uploadCompanyLogo}
                  >
                    <Button icon={<UploadOutlined />} loading={uploadingLogo}>上传 Logo</Button>
                  </Upload>
                </div>
              </div>
              <div className="settings-form-grid">
                <Form.Item
                  name="companyName"
                  label="企业名称"
                  rules={[{ required: true, message: '请输入企业名称' }, { max: 24, message: '最多输入 24 个字符' }]}
                >
                  <Input placeholder="例如：旭峰新材料" />
                </Form.Item>
                <Form.Item
                  name="systemName"
                  label="系统名称"
                  rules={[{ required: true, message: '请输入系统名称' }, { max: 24, message: '最多输入 24 个字符' }]}
                >
                  <Input placeholder="例如：经营管理系统" />
                </Form.Item>
                <Form.Item
                  className="settings-form-span"
                  name="productTagline"
                  label="系统标语"
                  rules={[{ required: true, message: '请输入系统标语' }, { max: 48, message: '最多输入 48 个字符' }]}
                >
                  <Input placeholder="用于登录页的产品说明" />
                </Form.Item>
              </div>
            </Card>

            <Card className="settings-card" title={<span><DesktopOutlined /> 界面偏好</span>}>
              <div className="settings-option-row">
                <div><strong>内容密度</strong><span>控制页面控件和内容区域的间距</span></div>
                <Form.Item name="density" noStyle>
                  <Radio.Group optionType="button" buttonStyle="solid">
                    <Radio.Button value="comfortable">舒适</Radio.Button>
                    <Radio.Button value="compact">紧凑</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </div>
              <div className="settings-option-row">
                <div><strong>内容宽度</strong><span>宽屏场景可限制阅读区域，提升信息聚焦</span></div>
                <Form.Item name="contentWidth" noStyle>
                  <Radio.Group optionType="button" buttonStyle="solid">
                    <Radio.Button value="fluid">自适应</Radio.Button>
                    <Radio.Button value="contained">居中</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </div>
              <div className="settings-option-row">
                <div><strong>默认收起侧边栏</strong><span>节省横向空间，适合较小尺寸的办公屏幕</span></div>
                <Form.Item name="sidebarCollapsed" valuePropName="checked" noStyle>
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </div>
              <div className="settings-option-row">
                <div><strong>减少界面动效</strong><span>关闭不必要的过渡效果，保持操作稳定</span></div>
                <Form.Item name="reducedMotion" valuePropName="checked" noStyle>
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
              </div>
            </Card>
          </div>

          <aside className="settings-side-column">
            <Card className="settings-card settings-security-card" title={<span><SafetyCertificateOutlined /> 安全与审计</span>}>
              <div className="settings-security-status">
                <SafetyCertificateOutlined />
                <div><strong>安全策略已启用</strong><span>账号权限与操作记录由服务端统一管理</span></div>
              </div>
              <Button block icon={<TeamOutlined />} onClick={() => navigate('/users')}>管理用户与角色</Button>
              <Button block icon={<AuditOutlined />} onClick={() => navigate('/operation-logs')}>查看操作日志</Button>
            </Card>
            <Card className="settings-card settings-note-card">
              <strong>关于设置</strong>
              <Typography.Paragraph type="secondary">
                企业 Logo 保存在服务器上传目录并对全系统生效；界面偏好保存在当前浏览器，用户、权限与业务数据仍由服务器统一管理。
              </Typography.Paragraph>
            </Card>
          </aside>
        </div>

        <div className="settings-action-bar">
          <Typography.Text type="secondary">修改后点击保存，界面将立即更新。</Typography.Text>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reset}>恢复默认</Button>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>保存设置</Button>
          </Space>
        </div>
      </Form>
    </div>
  )
}
