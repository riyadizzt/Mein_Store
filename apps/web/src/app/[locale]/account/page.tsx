'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

export default function AccountPage() {
  const locale = useLocale()
  const router = useRouter()

  useEffect(() => {
    router.replace(`/${locale}/account/orders`)
  }, [router, locale])

  return null
}
