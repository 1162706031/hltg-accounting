import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { API_BASE, api } from '../api/client'

export interface CurrentUser {
  id: number
  username: string
  real_name?: string | null
  role: 'admin' | 'accountant' | 'reviewer' | 'viewer'
  is_active: boolean
  created_at?: string
}

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  avatarUrl?: string
  refreshAvatar: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarVersion, setAvatarVersion] = useState(() => Date.now())

  useEffect(() => {
    const token = localStorage.getItem('hltg_access_token')
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get<CurrentUser>('/auth/me')
      .then((res) => setUser(res.data))
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      avatarUrl: user ? `${API_BASE}/media/avatars/${user.id}?v=${avatarVersion}` : undefined,
      async login(username, password) {
        const res = await api.post('/auth/login', { username, password })
        localStorage.setItem('hltg_access_token', res.data.access_token)
        localStorage.setItem('hltg_refresh_token', res.data.refresh_token)
        setUser(res.data.user)
      },
      logout() {
        localStorage.removeItem('hltg_access_token')
        localStorage.removeItem('hltg_refresh_token')
        setUser(null)
      },
      async refreshUser() {
        const res = await api.get<CurrentUser>('/auth/me')
        setUser(res.data)
      },
      refreshAvatar() {
        setAvatarVersion(Date.now())
      }
    }),
    [user, loading, avatarVersion]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
