'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { translateNotification } from '@/lib/notif-i18n'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import {
  Bell, ShoppingBag, RotateCcw, Users, X, Trash2, ShieldAlert, MessageSquare,
  Check, ChevronLeft, ChevronRight, Filter,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

const t3 = (locale: string, de: string, en: string, ar: string) =>
  locale === 'ar' ? ar : locale === 'en' ? en : de

// Supported notification types — see apps/web/src/lib/notif-i18n.ts for the
// canonical localization. Every type in TYPE_CONFIG below must have a case in
// translateNotification() so the admin never sees the raw persisted fallback.

const TYPE_CONFIG: Record<string, { Icon: typeof Bell; bg: string; fg: string; dot: string }> = {
  new_order: { Icon: ShoppingBag, bg: 'bg-blue-100', fg: 'text-blue-600', dot: 'bg-blue-500' },
  order_cancelled: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
  order_partial_cancelled: { Icon: X, bg: 'bg-orange-100', fg: 'text-orange-600', dot: 'bg-orange-500' },
  orders_auto_cancelled: { Icon: X, bg: 'bg-rose-100', fg: 'text-rose-600', dot: 'bg-rose-500' },
  return_submitted: { Icon: RotateCcw, bg: 'bg-yellow-100', fg: 'text-yellow-700', dot: 'bg-yellow-500' },
  return_approved: { Icon: RotateCcw, bg: 'bg-green-100', fg: 'text-green-600', dot: 'bg-green-500' },
  return_received: { Icon: RotateCcw, bg: 'bg-sky-100', fg: 'text-sky-600', dot: 'bg-sky-500' },
  return_refunded: { Icon: RotateCcw, bg: 'bg-emerald-100', fg: 'text-emerald-600', dot: 'bg-emerald-500' },
  payment_failed: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
  payment_disputed: { Icon: ShieldAlert, bg: 'bg-red-100', fg: 'text-red-700', dot: 'bg-red-600' },
  refund_failed: { Icon: X, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
  customer_registered: { Icon: Users, bg: 'bg-green-100', fg: 'text-green-600', dot: 'bg-green-500' },
  contact_message: { Icon: MessageSquare, bg: 'bg-indigo-100', fg: 'text-indigo-600', dot: 'bg-indigo-500' },
  account_deletion_requested: { Icon: ShieldAlert, bg: 'bg-red-100', fg: 'text-red-600', dot: 'bg-red-500' },
  admin_password_reset: { Icon: ShieldAlert, bg: 'bg-purple-100', fg: 'text-purple-600', dot: 'bg-purple-500' },
  maintenance_auto_ended: { Icon: Bell, bg: 'bg-teal-100', fg: 'text-teal-600', dot: 'bg-teal-500' },
  cron_crashed: { Icon: ShieldAlert, bg: 'bg-red-100', fg: 'text-red-700', dot: 'bg-red-700' },
  // NOTE: 'low_stock' removed — backend never emits this type.
}

// Filter-dropdown labels. Keep in sync with the types emitted by the backend;
// order here controls the order shown in the dropdown.
const TYPE_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  new_order: { de: 'Neue Bestellung', en: 'New Order', ar: 'طلب جديد' },
  order_cancelled: { de: 'Stornierung', en: 'Cancelled', ar: 'ملغى' },
  order_partial_cancelled: { de: 'Teilstornierung', en: 'Partial Cancellation', ar: 'إلغاء جزئي' },
  orders_auto_cancelled: { de: 'Auto-Stornierung', en: 'Auto Cancellation', ar: 'إلغاء تلقائي' },
  return_submitted: { de: 'Retoure', en: 'Return', ar: 'إرجاع' },
  return_approved: { de: 'Retoure genehmigt', en: 'Return Approved', ar: 'موافقة الإرجاع' },
  return_received: { de: 'Retoure eingegangen', en: 'Return Received', ar: 'استلام الإرجاع' },
  return_refunded: { de: 'Erstattet', en: 'Refunded', ar: 'مسترد' },
  payment_failed: { de: 'Zahlung fehlgeschlagen', en: 'Payment Failed', ar: 'فشل الدفع' },
  payment_disputed: { de: 'Zahlung bestritten', en: 'Payment Disputed', ar: 'نزاع على الدفع' },
  refund_failed: { de: 'Erstattung fehlgeschlagen', en: 'Refund Failed', ar: 'فشل الاسترداد' },
  customer_registered: { de: 'Neuer Kunde', en: 'New Customer', ar: 'عميل جديد' },
  contact_message: { de: 'Kontaktanfrage', en: 'Contact Request', ar: 'رسالة تواصل' },
  admin_password_reset: { de: 'Passwort zurückgesetzt', en: 'Password Reset', ar: 'إعادة تعيين كلمة المرور' },
  maintenance_auto_ended: { de: 'Wartungsende', en: 'Maintenance Ended', ar: 'نهاية الصيانة' },
  cron_crashed: { de: 'Cron abgestürzt', en: 'Cron Crashed', ar: 'توقف Cron' },
}

const LIMIT = 20

export default function NotificationsPage() {
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-notifications-page', filter, typeFilter, page],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(LIMIT), offset: String((page - 1) * LIMIT) }
      if (filter === 'unread') params.isRead = 'false'
      if (typeFilter) params.type = typeFilter
      const { data } = await api.get('/admin/notifications', { params })
      return data
    },
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/admin/notifications/read/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-notifications-page'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => api.post('/admin/notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-notifications-page'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] })
    },
  })

  const items = (data?.data ?? []) as any[]
  const total = data?.meta?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))


  const handleClick = (n: any) => {
    if (!n.isRead) markRead.mutate(n.id)
    const link = n.entityType === 'order' ? `/${locale}/admin/orders/${n.entityId}`
      : n.entityType === 'return' ? `/${locale}/admin/returns`
      : n.entityType === 'inventory' ? `/${locale}/admin/inventory`
      : `/${locale}/admin/dashboard`
    router.push(link)
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'Benachrichtigungen', 'Notifications', 'الإشعارات') }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6" />
          {t3(locale, 'Benachrichtigungen', 'Notifications', 'الإشعارات')}
        </h1>
        <button
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
          className="flex items-center gap-1.5 text-sm font-medium text-[#d4a853] hover:text-[#c49943] transition-colors disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {t3(locale, 'Alle als gelesen markieren', 'Mark all as read', 'تحديد الكل كمقروء')}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex rounded-lg border bg-background overflow-hidden">
          {(['all', 'unread'] as const).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setPage(1) }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${filter === f ? 'bg-[#d4a853] text-white' : 'hover:bg-muted'}`}>
              {f === 'all' ? t3(locale, 'Alle', 'All', 'الكل') : t3(locale, 'Ungelesen', 'Unread', 'غير مقروء')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
            className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[180px]">
            <option value="">{t3(locale, 'Alle Typen', 'All Types', 'جميع الأنواع')}</option>
            {Object.entries(TYPE_LABELS).map(([key, labels]) => (
              <option key={key} value={key}>{t3(locale, labels.de, labels.en, labels.ar)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-4 p-4 bg-background border rounded-xl animate-pulse">
              <div className="h-10 w-10 rounded-xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="py-20 text-center bg-background border rounded-xl">
            <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground/15" />
            <p className="text-muted-foreground text-sm">
              {t3(locale, 'Keine Benachrichtigungen', 'No notifications', 'لا توجد إشعارات')}
            </p>
          </div>
        ) : items.map((n: any) => {
          const cfg = TYPE_CONFIG[n.type] ?? { Icon: Bell, bg: 'bg-muted', fg: 'text-muted-foreground', dot: 'bg-muted-foreground' }
          const Icon = cfg.Icon
          // Shared translator — same source of truth as the bell dropdown,
          // so new notification types automatically render in the admin's
          // locale on both surfaces.
          const translated = translateNotification(n, locale)
          const timeAgo = (() => {
            const s = Math.floor((Date.now() - new Date(n.createdAt).getTime()) / 1000)
            const t = (de: string, en: string, ar: string) => locale === 'ar' ? ar : locale === 'en' ? en : de
            if (s < 60) return t('gerade eben', 'just now', 'الآن')
            if (s < 3600) return `${t('vor', '', 'منذ')} ${Math.floor(s / 60)} ${t('Min.', 'min ago', 'د')}`
            if (s < 86400) return `${t('vor', '', 'منذ')} ${Math.floor(s / 3600)} ${t('Std.', 'h ago', 'س')}`
            return `${t('vor', '', 'منذ')} ${Math.floor(s / 86400)} ${t('Tagen', 'd ago', 'ي')}`
          })()
          return (
            <button key={n.id} type="button" onClick={() => handleClick(n)}
              className={`group w-full flex items-center gap-3 px-4 py-3 bg-background border rounded-xl text-start transition-all hover:shadow-md hover:border-[#d4a853]/30 ${!n.isRead ? 'border-s-[3px] border-s-[#d4a853]' : ''}`}>
              <div className={`h-10 w-10 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-5 w-5 ${cfg.fg}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm leading-tight truncate ${!n.isRead ? 'font-bold' : 'font-medium'}`}>{translated.title}</p>
                  {!n.isRead && <span className={`h-2 w-2 rounded-full flex-shrink-0 ${cfg.dot}`} />}
                </div>
                {translated.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{translated.body}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{timeAgo}</span>
              <button onClick={async (e) => {
                e.stopPropagation()
                // Optimistic: remove from cache instantly
                qc.setQueryData(['admin-notifications-page', filter, typeFilter, page], (old: any) => {
                  if (!old) return old
                  return { ...old, data: (old.data ?? []).filter((x: any) => x.id !== n.id), meta: { ...old.meta, total: Math.max(0, (old.meta?.total ?? 1) - 1) } }
                })
                // Then delete on server
                api.delete(`/admin/notifications/${n.id}`).then(() => { qc.invalidateQueries({ queryKey: ['admin-notifications-unread'] }) })
              }}
                className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-100 text-muted-foreground/40 hover:text-red-500 transition-all flex-shrink-0"
                title={locale === 'ar' ? 'حذف' : 'Löschen'}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-muted-foreground">
            {t3(locale,
              `Seite ${page} von ${totalPages} (${total} gesamt)`,
              `Page ${page} of ${totalPages} (${total} total)`,
              `صفحة ${page} من ${totalPages} (${total} إجمالي)`
            )}
          </p>
          <div className="flex gap-2" dir="ltr">
            <button onClick={() => setPage(page - 1)} disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
              {t3(locale, 'Zurück', 'Previous', 'السابق')}
            </button>
            <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors disabled:opacity-40">
              {t3(locale, 'Weiter', 'Next', 'التالي')}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
