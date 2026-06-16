export type UserRole = 'admin' | 'accountant' | 'reviewer' | 'viewer'

export function canManageData(role?: UserRole) {
  return role === 'admin' || role === 'accountant'
}

export function canReview(role?: UserRole) {
  return role === 'admin' || role === 'reviewer'
}

export function isAdmin(role?: UserRole) {
  return role === 'admin'
}
