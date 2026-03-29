'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { api } from '@/lib/api'

export default function GoogleCallbackPage() {
  const router = useRouter()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  useEffect(() => {
    const accessToken = searchParams.get('accessToken')

    if (accessToken) {
      // Store access token in memory (refresh token is in HttpOnly cookie)
      setAccessToken(accessToken)

      // Fetch user profile
      api.get('/auth/me').then(({ data }) => {
        setUser(data?.data ?? data)
        router.replace(`/${locale}/account`)
      }).catch(() => {
        router.replace(`/${locale}/auth/login`)
      })
    } else {
      router.replace(`/${locale}/auth/login`)
    }
  }, [searchParams, setUser, setAccessToken, router, locale])

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
