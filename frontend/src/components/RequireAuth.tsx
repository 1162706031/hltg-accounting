import { Spin } from 'antd'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'

export function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="login-shell">
        <Spin size="large" />
      </div>
    )
  }
  return user ? <Outlet /> : <Navigate to="/login" replace />
}
