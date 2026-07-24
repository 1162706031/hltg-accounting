import { useEffect, useState } from 'react'
import { useSystemSettings } from '../utils/SystemSettingsContext'

export function BrandMark({ className = '' }: { className?: string }) {
  const { companyLogoUrl } = useSystemSettings()
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [companyLogoUrl])

  return (
    <span className={`brand-symbol ${className}`.trim()} aria-hidden="true">
      {failed
        ? 'XF'
        : <img src={companyLogoUrl} alt="" onError={() => setFailed(true)} />}
    </span>
  )
}
