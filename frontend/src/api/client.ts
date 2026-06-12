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
    return Promise.reject(error)
  }
)

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
