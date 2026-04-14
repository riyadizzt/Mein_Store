'use client'

import { API_BASE_URL } from '@/lib/env'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'

export function MaintenanceCheck() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const adminUser = useAuthStore((s) => s.adminUser)

  const { data: publicSettings } = useQuery({
    queryKey: ['public-settings-maintenance'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/settings/public`)
      return res.ok ? res.json() : {}
    },
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!publicSettings) return
    const isMaintenanceOn = publicSettings.maintenance_enabled === 'true'
    const isAdmin = !!adminUser
    const isAdminPage = pathname.includes('/admin')
    const isMaintenancePage = pathname.includes('/maintenance')
    const isAuthPage = pathname.includes('/auth')

    // Admin bypass — admins see the normal shop
    if (isAdmin || isAdminPage || isMaintenancePage || isAuthPage) return

    // Redirect customers to maintenance page
    if (isMaintenanceOn) {
      router.replace(`/${locale}/maintenance`)
    }
  }, [publicSettings, adminUser, pathname, locale, router])

  return null
}
