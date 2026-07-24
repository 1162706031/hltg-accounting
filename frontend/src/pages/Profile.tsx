import {
  CheckCircleFilled,
  CameraOutlined,
  IdcardOutlined,
  KeyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  UserOutlined
} from '@ant-design/icons'
import { App as AntApp, Avatar, Button, Card, Form, Input, Tag, Typography, Upload } from 'antd'
import { useEffect, useState } from 'react'
import { api, getErrorMessage } from '../api/client'
import { useAuth } from '../utils/AuthContext'

const ROLE_META: Record<string, { label: string; color: string }> = {
  admin: { label: '系统管理员', color: 'red' },
  accountant: { label: '会计', color: 'blue' },
  reviewer: { label: '审核员', color: 'green' },
  viewer: { label: '只读用户', color: 'default' }
}

interface ProfileValues {
  real_name?: string
}

interface PasswordValues {
  current_password: string
  new_password: string
  confirm_password: string
}

export function Profile() {
  const { message } = AntApp.useApp()
  const { user, refreshUser, avatarUrl, refreshAvatar } = useAuth()
  const [profileForm] = Form.useForm<ProfileValues>()
  const [passwordForm] = Form.useForm<PasswordValues>()
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    profileForm.setFieldsValue({ real_name: user?.real_name ?? '' })
  }, [profileForm, user?.real_name])

  const saveProfile = async (values: ProfileValues) => {
    setSavingProfile(true)
    try {
      await api.put('/auth/me', { real_name: values.real_name?.trim() || null })
      await refreshUser()
      message.success('个人资料已更新')
    } catch (error) {
      message.error(getErrorMessage(error, '个人资料更新失败'))
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (values: PasswordValues) => {
    setSavingPassword(true)
    try {
      await api.post('/auth/change-password', {
        current_password: values.current_password,
        new_password: values.new_password
      })
      passwordForm.resetFields()
      message.success('密码已修改，请在下次登录时使用新密码')
    } catch (error) {
      message.error(getErrorMessage(error, '密码修改失败'))
    } finally {
      setSavingPassword(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    setUploadingAvatar(true)
    try {
      await api.post('/media/me/avatar', formData)
      refreshAvatar()
      message.success('个人头像已更新')
    } catch (error) {
      message.error(getErrorMessage(error, '头像上传失败'))
    } finally {
      setUploadingAvatar(false)
    }
    return Upload.LIST_IGNORE
  }

  const displayName = user?.real_name || user?.username || '用户'
  const role = ROLE_META[user?.role ?? ''] ?? { label: user?.role || '用户', color: 'default' }

  return (
    <div className="page profile-page">
      <div className="profile-page-header">
        <div>
          <h1 className="page-title">个人中心</h1>
          <Typography.Text type="secondary">管理您的个人资料与登录密码</Typography.Text>
        </div>
        <Tag color="green" icon={<CheckCircleFilled />}>账号正常</Tag>
      </div>

      <Card className="profile-hero-card">
        <div className="profile-identity">
          <Avatar size={72} src={avatarUrl} icon={<UserOutlined />}>{displayName.slice(0, 1)}</Avatar>
          <div>
            <h2>{displayName}</h2>
            <div className="profile-identity-meta">
              <span>@{user?.username}</span>
              <Tag color={role.color}>{role.label}</Tag>
            </div>
            <Upload
              accept="image/jpeg,image/png,image/webp"
              showUploadList={false}
              beforeUpload={uploadAvatar}
            >
              <Button
                className="profile-avatar-upload"
                size="small"
                icon={<CameraOutlined />}
                loading={uploadingAvatar}
              >
                更换头像
              </Button>
            </Upload>
          </div>
        </div>
        <div className="profile-security-state">
          <SafetyCertificateOutlined />
          <span><strong>账户受保护</strong><small>密码与权限由系统安全管理</small></span>
        </div>
      </Card>

      <div className="profile-content-grid">
        <Card className="profile-card" title={<span><IdcardOutlined /> 基本资料</span>}>
          <Typography.Paragraph type="secondary" className="profile-card-intro">
            显示姓名会用于工作台问候、操作人和业务记录展示。
          </Typography.Paragraph>
          <Form form={profileForm} layout="vertical" onFinish={saveProfile} requiredMark={false}>
            <Form.Item label="登录账号">
              <Input value={user?.username} disabled prefix={<UserOutlined />} />
            </Form.Item>
            <Form.Item
              name="real_name"
              label="显示姓名"
              rules={[{ max: 50, message: '最多输入 50 个字符' }]}
            >
              <Input placeholder="请输入您的姓名" prefix={<IdcardOutlined />} />
            </Form.Item>
            <div className="profile-readonly-row">
              <span>当前角色</span>
              <Tag color={role.color}>{role.label}</Tag>
            </div>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingProfile}>
              保存资料
            </Button>
          </Form>
        </Card>

        <Card className="profile-card" title={<span><KeyOutlined /> 修改密码</span>}>
          <Typography.Paragraph type="secondary" className="profile-card-intro">
            新密码至少 6 位。为保护账户安全，请勿与他人共享密码。
          </Typography.Paragraph>
          <Form form={passwordForm} layout="vertical" onFinish={changePassword} requiredMark={false}>
            <Form.Item
              name="current_password"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="请输入当前密码" />
            </Form.Item>
            <Form.Item
              name="new_password"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '新密码至少 6 位' },
                { max: 128, message: '新密码最多 128 位' }
              ]}
            >
              <Input.Password prefix={<KeyOutlined />} autoComplete="new-password" placeholder="请输入新密码" />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label="确认新密码"
              dependencies={['new_password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || getFieldValue('new_password') === value
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次输入的新密码不一致'))
                  }
                })
              ]}
            >
              <Input.Password prefix={<KeyOutlined />} autoComplete="new-password" placeholder="请再次输入新密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<KeyOutlined />} loading={savingPassword}>
              修改密码
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  )
}
