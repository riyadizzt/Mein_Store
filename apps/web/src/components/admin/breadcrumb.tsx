'use client'

import Link from 'next/link'
import { useLocale } from 'next-intl'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function AdminBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const locale = useLocale()

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 overflow-x-auto">
      <Link href={`/${locale}/admin/dashboard`} className="hover:text-foreground whitespace-nowrap">
        {locale === 'ar' ? 'لوحة التحكم' : locale === 'en' ? 'Dashboard' : 'Dashboard'}
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 rtl:rotate-180" />
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground whitespace-nowrap">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
