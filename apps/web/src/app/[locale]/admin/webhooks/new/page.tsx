'use client'

import { useLocale } from 'next-intl'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { WebhookForm } from '../webhook-form'
import { t3 } from '../event-catalog'

export default function NewWebhookPage() {
  const locale = useLocale()

  return (
    <div className="max-w-4xl mx-auto">
      <AdminBreadcrumb
        items={[
          {
            label: t3(locale, 'Webhooks', 'الويب هوك'),
            href: `/${locale}/admin/webhooks`,
          },
          { label: t3(locale, 'Neu', 'جديد') },
        ]}
      />

      <div className="mb-6">
        <Link
          href={`/${locale}/admin/webhooks`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t3(locale, 'Zurück zur Liste', 'العودة للقائمة')}
        </Link>
        <h1 className="text-2xl font-bold">
          {t3(locale, 'Neuer Webhook', 'ويب هوك جديد')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t3(
            locale,
            'Verbinde dein Shop mit n8n, Zapier, Slack oder jedem anderen System.',
            'اربط متجرك بـ n8n, Zapier, Slack أو أي نظام آخر.',
          )}
        </p>
      </div>

      <WebhookForm mode="create" locale={locale} />
    </div>
  )
}
