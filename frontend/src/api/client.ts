import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hltg_access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** 把后端返回的 detail（可能是字符串 / Pydantic 校验错误数组 / 对象）规整成可读字符串。 */
function normalizeDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI 422：[{ loc: [...], msg: '...', type: '...' }, ...]
    return detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = Array.isArray((d as any).loc) ? (d as any).loc.slice(1).join('.') : ''
          return loc ? `${loc}: ${(d as any).msg}` : (d as any).msg
        }
        return typeof d === 'string' ? d : JSON.stringify(d)
      })
      .join('；')
  }
  if (typeof detail === 'object' && 'msg' in (detail as any)) return String((detail as any).msg)
  return JSON.stringify(detail)
}

/** 从 Axios、React Query 或普通 Error 中提取适合直接展示给用户的信息。 */
export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  const candidate = error as any
  const detail = normalizeDetail(candidate?.response?.data?.detail)
  if (detail) return detail

  const responseData = candidate?.response?.data
  if (typeof responseData === 'string' && responseData.trim() && responseData !== 'Internal Server Error') {
    return responseData.trim()
  }

  if (!candidate?.response && typeof candidate?.message === 'string' && candidate.message.trim()) {
    return candidate.message === 'Network Error' ? '网络连接失败，请检查网络或服务状态' : candidate.message
  }
  return fallback
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('hltg_access_token')
      localStorage.removeItem('hltg_refresh_token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    // 统一把 detail 规整为字符串，避免组件把数组/对象当作 ReactNode 渲染导致白屏
    if (error.response?.data && typeof error.response.data === 'object') {
      const normalized = normalizeDetail(error.response.data.detail)
      if (normalized !== undefined) {
        error.response.data.detail = normalized
      }
    }
    return Promise.reject(error)
  }
)

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
