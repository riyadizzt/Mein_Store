'use client'

import { useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

export default function UsersRedirect() {
  const locale = useLocale()
  const router = useRouter()
  useEffect(() => { router.replace(`/${locale}/admin/customers`) }, [locale, router])
  return null
}
