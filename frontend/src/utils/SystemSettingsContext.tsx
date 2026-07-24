import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../api/client'

export interface SystemSettings {
  companyName: string
  systemName: string
  productTagline: string
  sidebarCollapsed: boolean
  density: 'comfortable' | 'compact'
  contentWidth: 'fluid' | 'contained'
  reducedMotion: boolean
}

const STORAGE_KEY = 'hltg_system_settings'

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  companyName: '旭峰新材料',
  systemName: '经营管理系统',
  productTagline: '让生产、库存与财务协同更清晰',
  sidebarCollapsed: false,
  density: 'comfortable',
  contentWidth: 'fluid',
  reducedMotion: false
}

interface SystemSettingsContextValue {
  settings: SystemSettings
  updateSettings: (next: Partial<SystemSettings>) => void
  resetSettings: () => void
  companyLogoUrl: string
  refreshCompanyLogo: () => void
}

const SystemSettingsContext = createContext<SystemSettingsContextValue | null>(null)

function loadSettings(): SystemSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? { ...DEFAULT_SYSTEM_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SYSTEM_SETTINGS
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return DEFAULT_SYSTEM_SETTINGS
  }
}

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SystemSettings>(loadSettings)
  const [logoVersion, setLogoVersion] = useState(() => Date.now())

  useEffect(() => {
    document.body.dataset.density = settings.density
    document.body.dataset.contentWidth = settings.contentWidth
    document.body.classList.toggle('reduce-motion', settings.reducedMotion)
    document.title = `${settings.companyName} · ${settings.systemName}`
  }, [settings])

  const value = useMemo<SystemSettingsContextValue>(() => ({
    settings,
    companyLogoUrl: `${API_BASE}/media/company-logo?v=${logoVersion}`,
    updateSettings(next) {
      setSettings((current) => {
        const updated = { ...current, ...next }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        return updated
      })
    },
    resetSettings() {
      localStorage.removeItem(STORAGE_KEY)
      setSettings(DEFAULT_SYSTEM_SETTINGS)
    },
    refreshCompanyLogo() {
      setLogoVersion(Date.now())
    }
  }), [settings, logoVersion])

  return <SystemSettingsContext.Provider value={value}>{children}</SystemSettingsContext.Provider>
}

export function useSystemSettings() {
  const context = useContext(SystemSettingsContext)
  if (!context) throw new Error('useSystemSettings must be used within SystemSettingsProvider')
  return context
}
