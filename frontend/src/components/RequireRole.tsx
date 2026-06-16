import { Navigate } from 'react-router-dom'
import { useAuth } from '../utils/AuthContext'
import type { UserRole } from '../utils/permissions'
import type { ReactNode } from 'react'

export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return children
}
