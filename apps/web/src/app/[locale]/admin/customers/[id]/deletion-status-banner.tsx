'use client'

/**
 * GDPR deletion status banner for the customer detail page.
 *
 * Renders one of two prominent warnings (or nothing) based on the
 * customer's deletion state:
 *
 *  1. `anonymizedAt` set  → black/gray permanent badge "Anonymized (GDPR)"
 *  2. `scheduledDeletionAt` set in the future → red countdown warning
 *  3. Neither → renders nothing
 *
 * Fully localized in DE / EN / AR with RTL-safe Latin dates.
 * Kept in its own file so the detail page touches stay minimal.
 */

import { AlertTriangle, Ban } from 'lucide-react'

interface Props {
  scheduledDeletionAt?: string | null
  anonymizedAt?: string | null
  locale: string
}

const L: Record<string, {
  scheduledTitle: string
  scheduledBody: (dateStr: string, days: number) => string
  scheduledDaysLabel: (n: number) => string
  anonymizedTitle: string
  anonymizedBody: (dateStr: string) => string
}> = {
  de: {
    scheduledTitle: 'Kontolöschung beantragt',
    scheduledBody: (d, days) =>
      `Der Kunde hat die Löschung seines Kontos beantragt. Die automatische Anonymisierung (DSGVO Art. 17) erfolgt am ${d}${days > 0 ? ` — noch ${days} ${days === 1 ? 'Tag' : 'Tage'}.` : '.'}`,
    scheduledDaysLabel: (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`,
    anonymizedTitle: 'Anonymisiert (DSGVO Art. 17)',
    anonymizedBody: (d) =>
      `Dieser Kunde wurde am ${d} gemäß DSGVO anonymisiert. Personenbezogene Daten wurden gelöscht, Bestellungen bleiben aus GoBD-Gründen erhalten.`,
  },
  en: {
    scheduledTitle: 'Account deletion requested',
    scheduledBody: (d, days) =>
      `The customer has requested deletion of their account. Automatic anonymization (GDPR Art. 17) will run on ${d}${days > 0 ? ` — ${days} ${days === 1 ? 'day' : 'days'} remaining.` : '.'}`,
    scheduledDaysLabel: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
    anonymizedTitle: 'Anonymized (GDPR Art. 17)',
    anonymizedBody: (d) =>
      `This customer was anonymized on ${d} under GDPR. Personal data has been erased; orders are retained for accounting (GoBD).`,
  },
  ar: {
    scheduledTitle: 'طلب حذف الحساب',
    scheduledBody: (d, days) =>
      `طلب العميل حذف حسابه. سيتم الإخفاء التلقائي (المادة 17 من اللائحة العامة لحماية البيانات) في \u200E${d}\u200F${days > 0 ? ` — متبقي ${days} ${days === 1 ? 'يوم' : 'أيام'}.` : '.'}`,
    scheduledDaysLabel: (n) => `${n} ${n === 1 ? 'يوم' : 'أيام'}`,
    anonymizedTitle: 'تم الإخفاء (المادة 17 من اللائحة العامة لحماية البيانات)',
    anonymizedBody: (d) =>
      `تم إخفاء هذا العميل في \u200E${d}\u200F وفقاً للائحة العامة لحماية البيانات. تم حذف البيانات الشخصية مع الاحتفاظ بالطلبات لأغراض محاسبية (GoBD).`,
  },
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso)
    // Force Latin numerals even in Arabic — project rule
    const loc = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE'
    return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export function DeletionStatusBanner({ scheduledDeletionAt, anonymizedAt, locale }: Props) {
  const labels = L[locale] ?? L.de

  // State 1 — Anonymized (highest priority, permanent terminal state)
  if (anonymizedAt) {
    const dateStr = formatDate(anonymizedAt, locale)
    return (
      <div
        className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 text-gray-100 p-5 flex items-start gap-4"
        role="alert"
        aria-live="polite"
      >
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center">
          <Ban className="h-5 w-5 text-gray-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1">{labels.anonymizedTitle}</h3>
          <p className="text-xs leading-relaxed text-gray-300">{labels.anonymizedBody(dateStr)}</p>
        </div>
      </div>
    )
  }

  // State 2 — Deletion scheduled (30-day grace period)
  if (scheduledDeletionAt) {
    const dateStr = formatDate(scheduledDeletionAt, locale)
    const days = daysUntil(scheduledDeletionAt)
    return (
      <div
        className="mb-6 rounded-2xl border border-red-300 bg-red-50 text-red-900 p-5 flex items-start gap-4 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
        role="alert"
        aria-live="polite"
      >
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm mb-1">{labels.scheduledTitle}</h3>
          <p className="text-xs leading-relaxed">{labels.scheduledBody(dateStr, days)}</p>
        </div>
      </div>
    )
  }

  return null
}
