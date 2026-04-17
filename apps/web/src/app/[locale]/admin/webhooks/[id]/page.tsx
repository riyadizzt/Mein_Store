'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RotateCw,
  Webhook,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useConfirm } from '@/components/ui/confirm-modal'
import { toast } from '@/store/toast-store'
import { WebhookForm } from '../webhook-form'
import { t3, findEventDef, t3all } from '../event-catalog'

interface WebhookSubscription {
  id: string
  url: string
  secret: string
  events: string[]
  isActive: boolean
  description: string | null
  totalDeliveries: number
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  lastDeliveryAt: string | null
  createdAt: string
}

interface DeliveryLog {
  id: string
  subscriptionId: string
  eventType: string
  eventId: string
  status: 'pending' | 'success' | 'failed'
  httpStatus: number | null
  errorMessage: string | null
  attemptCount: number
  lastAttemptAt: string | null
  completedAt: string | null
  createdAt: string
}

export default function EditWebhookPage() {
  const locale = useLocale()
  const params = useParams()
  const router = useRouter()
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const id = params.id as string

  const { data: sub, isLoading } = useQuery<WebhookSubscription>({
    queryKey: ['admin-webhook', id],
    queryFn: async () => {
      const { data } = await api.get(`/admin/webhooks/${id}`)
      return data
    },
  })

  const [showSecret, setShowSecret] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all')

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/admin/webhooks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-webhooks'] })
      toast.success(t3(locale, 'Webhook gelöscht', 'تم حذف الويب هوك'))
      router.push(`/${locale}/admin/webhooks`)
    },
    onError: () => toast.error(t3(locale, 'Löschen fehlgeschlagen', 'فشل الحذف')),
  })

  const testMut = useMutation({
    mutationFn: () => api.post(`/admin/webhooks/${id}/test`),
    onSuccess: () => {
      toast.success(t3(locale, 'Test-Ereignis gesendet', 'تم إرسال حدث الاختبار'))
      qc.invalidateQueries({ queryKey: ['admin-webhook-logs', id] })
    },
    onError: () => toast.error(t3(locale, 'Test-Senden fehlgeschlagen', 'فشل إرسال الاختبار')),
  })

  const rotateMut = useMutation({
    mutationFn: () => api.post(`/admin/webhooks/${id}/rotate-secret`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-webhook', id] })
      toast.success(t3(locale, 'Neues Secret generiert', 'تم توليد سر جديد'))
    },
    onError: () => toast.error(t3(locale, 'Fehler beim Generieren', 'خطأ أثناء التوليد')),
  })

  if (isLoading || !sub) {
    return (
      <div className="max-w-4xl mx-auto">
        <AdminBreadcrumb
          items={[
            { label: t3(locale, 'Webhooks', 'الويب هوك'), href: `/${locale}/admin/webhooks` },
          ]}
        />
        <div className="h-96 rounded-xl border border-border/60 bg-background/60 animate-pulse mt-6" />
      </div>
    )
  }

  const hostname = (() => {
    try {
      return new URL(sub.url).hostname
    } catch {
      return sub.url
    }
  })()

  async function handleDelete() {
    const ok = await confirmDialog({
      title: t3(locale, 'Webhook löschen?', 'حذف الويب هوك؟'),
      description: t3(
        locale,
        'Diese Aktion kann nicht rückgängig gemacht werden. Delivery-Logs bleiben als Audit-Historie erhalten.',
        'لا يمكن التراجع عن هذا الإجراء. ستبقى سجلات التسليم كسجل تدقيق.',
      ),
      variant: 'destructive',
      confirmLabel: t3(locale, 'Löschen', 'حذف'),
      cancelLabel: t3(locale, 'Abbrechen', 'إلغاء'),
    })
    if (ok) deleteMut.mutate()
  }

  async function handleRotate() {
    const ok = await confirmDialog({
      title: t3(locale, 'Secret neu generieren?', 'توليد سر جديد؟'),
      description: t3(
        locale,
        'Das alte Secret wird sofort ungültig. Du musst das neue Secret in n8n/Zapier/… eintragen damit die Signatur-Prüfung weiter funktioniert.',
        'سيصبح السر القديم غير صالح فوراً. يجب إدخال السر الجديد في n8n/Zapier/… لكي يستمر التحقق من التوقيع.',
      ),
      variant: 'destructive',
      confirmLabel: t3(locale, 'Neu generieren', 'توليد جديد'),
      cancelLabel: t3(locale, 'Abbrechen', 'إلغاء'),
    })
    if (ok) rotateMut.mutate()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <AdminBreadcrumb
        items={[
          { label: t3(locale, 'Webhooks', 'الويب هوك'), href: `/${locale}/admin/webhooks` },
          { label: sub.description || hostname },
        ]}
      />

      <Link
        href={`/${locale}/admin/webhooks`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t3(locale, 'Zurück zur Liste', 'العودة للقائمة')}
      </Link>

      {/* ── Header card with stats + actions ───────────────── */}
      <section className="rounded-xl border border-border/60 bg-gradient-to-br from-[#d4a853]/5 via-background to-background p-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-[#d4a853]/15 flex items-center justify-center ring-1 ring-[#d4a853]/30 shrink-0">
            <Webhook className="h-6 w-6 text-[#d4a853]" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">
              {sub.description || hostname}
            </h1>
            <p dir="ltr" className="text-xs text-muted-foreground font-mono truncate mt-1">
              {sub.url}
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
              <Stat
                label={t3(locale, 'Erfolgsrate', 'نسبة النجاح')}
                value={
                  sub.totalDeliveries > 0
                    ? `${Math.round((sub.totalSuccesses / sub.totalDeliveries) * 100)}%`
                    : '—'
                }
              />
              <Stat label={t3(locale, 'Gesendet', 'تم الإرسال')} value={String(sub.totalDeliveries)} />
              <Stat label={t3(locale, 'Erfolge', 'نجاح')} value={String(sub.totalSuccesses)} tone="success" />
              <Stat label={t3(locale, 'Fehler', 'أخطاء')} value={String(sub.totalFailures)} tone={sub.totalFailures > 0 ? 'error' : 'default'} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-6">
          <Button
            type="button"
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending}
            className="gap-2"
          >
            {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t3(locale, 'Test-Webhook senden', 'إرسال ويب هوك تجريبي')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteMut.isPending}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {t3(locale, 'Löschen', 'حذف')}
          </Button>
        </div>
      </section>

      {/* ── Secret card ─────────────────────────────────────── */}
      <section className="rounded-xl border border-border/60 bg-background p-6">
        <h2 className="text-lg font-semibold mb-1">
          {t3(locale, 'Signatur-Schlüssel (Secret)', 'مفتاح التوقيع (Secret)')}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t3(
            locale,
            'Wird zur HMAC-SHA256-Signierung der Payloads genutzt (Header "X-Malak-Signature"). Trage diesen Wert in n8n ein um die Authentizität zu prüfen.',
            'يُستخدم لتوقيع الحمولات بخوارزمية HMAC-SHA256 (الهيدر "X-Malak-Signature"). أدخل هذه القيمة في n8n للتحقق من الأصالة.',
          )}
        </p>

        <div className="flex items-stretch gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40 font-mono text-sm overflow-hidden">
            <span dir="ltr" className="truncate">
              {showSecret ? sub.secret : '•'.repeat(40)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowSecret((s) => !s)}
            className="px-3 rounded-lg border border-border hover:border-[#d4a853]/60 transition-colors flex items-center gap-1.5 text-sm"
            aria-label={showSecret ? 'hide' : 'show'}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {showSecret ? t3(locale, 'Verbergen', 'إخفاء') : t3(locale, 'Anzeigen', 'عرض')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(sub.secret)
              toast.success(t3(locale, 'Secret kopiert', 'تم نسخ السر'))
            }}
            className="px-3 rounded-lg border border-border hover:border-[#d4a853]/60 transition-colors flex items-center gap-1.5 text-sm"
          >
            <Copy className="h-4 w-4" />
            <span className="hidden sm:inline">{t3(locale, 'Kopieren', 'نسخ')}</span>
          </button>
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotateMut.isPending}
            className="px-3 rounded-lg border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors flex items-center gap-1.5 text-sm font-medium disabled:opacity-50"
          >
            {rotateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">{t3(locale, 'Neu generieren', 'توليد جديد')}</span>
          </button>
        </div>
      </section>

      {/* ── Form ────────────────────────────────────────────── */}
      <WebhookForm
        mode="edit"
        locale={locale}
        initial={{
          id: sub.id,
          url: sub.url,
          description: sub.description ?? '',
          events: sub.events,
          isActive: sub.isActive,
        }}
      />

      {/* ── Delivery logs ───────────────────────────────────── */}
      <DeliveryLogs
        subscriptionId={id}
        locale={locale}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
      />
    </div>
  )
}

// ── Delivery logs component ──────────────────────────────────

function DeliveryLogs({
  subscriptionId,
  locale,
  statusFilter,
  onStatusFilter,
}: {
  subscriptionId: string
  locale: string
  statusFilter: 'all' | 'success' | 'failed' | 'pending'
  onStatusFilter: (v: 'all' | 'success' | 'failed' | 'pending') => void
}) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ rows: DeliveryLog[]; total: number }>({
    queryKey: ['admin-webhook-logs', subscriptionId, statusFilter],
    queryFn: async () => {
      const qs = new URLSearchParams({ subscriptionId })
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      const { data } = await api.get(`/admin/webhooks/deliveries/logs?${qs.toString()}`)
      return data
    },
    refetchInterval: 10_000, // keep live
  })

  const retryMut = useMutation({
    mutationFn: (logId: string) => api.post(`/admin/webhooks/deliveries/logs/${logId}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-webhook-logs', subscriptionId] })
      toast.success(t3(locale, 'Wird erneut gesendet', 'جارٍ إعادة الإرسال'))
    },
    onError: () => toast.error(t3(locale, 'Retry fehlgeschlagen', 'فشل إعادة الإرسال')),
  })

  const statusCounts = data?.rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    },
    { pending: 0, success: 0, failed: 0 } as Record<string, number>,
  ) ?? { pending: 0, success: 0, failed: 0 }

  return (
    <section className="rounded-xl border border-border/60 bg-background p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold">
            {t3(locale, 'Letzte Aufrufe', 'آخر الاستدعاءات')}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t3(
              locale,
              'Live-Aktualisierung alle 10 Sekunden. Klick auf einen Eintrag für Details.',
              'تحديث مباشر كل 10 ثوانٍ. انقر على إدخال للتفاصيل.',
            )}
          </p>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'success', 'failed', 'pending'] as const).map((s) => {
          const labels = {
            all: { de: 'Alle', ar: 'الكل' },
            success: { de: 'Erfolg', ar: 'نجاح' },
            failed: { de: 'Fehler', ar: 'فشل' },
            pending: { de: 'Ausstehend', ar: 'قيد الانتظار' },
          }
          const active = statusFilter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => onStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                active
                  ? 'bg-[#0f1419] text-white dark:bg-[#d4a853] dark:text-[#0f1419]'
                  : 'bg-muted hover:bg-muted/70 text-foreground'
              }`}
            >
              {t3(locale, labels[s].de, labels[s].ar)}
              {s !== 'all' && (
                <span className={`ms-1.5 tabular-nums ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {statusCounts[s] ?? 0}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="h-40 rounded-lg bg-muted/40 animate-pulse" />
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border/60 rounded-lg">
          {statusFilter === 'all'
            ? t3(
                locale,
                'Noch keine Aufrufe. Klick "Test-Webhook senden" um einen zu erzeugen.',
                'لا توجد استدعاءات بعد. انقر "إرسال ويب هوك تجريبي" لإنشاء واحد.',
              )
            : t3(locale, 'Keine Einträge mit diesem Status.', 'لا توجد إدخالات بهذه الحالة.')}
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {data.rows.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              locale={locale}
              onRetry={() => retryMut.mutate(log.id)}
              retrying={retryMut.isPending && retryMut.variables === log.id}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function LogRow({
  log,
  locale,
  onRetry,
  retrying,
}: {
  log: DeliveryLog
  locale: string
  onRetry: () => void
  retrying: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const ev = findEventDef(log.eventType)
  const evLabel = ev ? t3all(locale, ev.label) : log.eventType

  const badge = (() => {
    if (log.status === 'success') {
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        label: t3(locale, 'Erfolg', 'نجاح'),
        class: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      }
    }
    if (log.status === 'failed') {
      return {
        icon: <XCircle className="h-3.5 w-3.5" />,
        label: t3(locale, 'Fehlgeschlagen', 'فشل'),
        class: 'bg-red-500/10 text-red-600 dark:text-red-400',
      }
    }
    return {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: t3(locale, 'Ausstehend', 'قيد الانتظار'),
      class: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    }
  })()

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-3 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-start"
      >
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${badge.class}`}>
          {badge.icon}
          {badge.label}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-medium text-sm truncate">{evLabel}</span>
          <span className="block text-[11px] text-muted-foreground">
            {log.httpStatus && `HTTP ${log.httpStatus} · `}
            {t3(locale, 'Versuch', 'محاولة')} {log.attemptCount}
            {log.lastAttemptAt && ` · ${new Date(log.lastAttemptAt).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE')}`}
          </span>
        </span>
        {log.status === 'failed' && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-border bg-background hover:border-[#d4a853]/60 transition-colors cursor-pointer"
            role="button"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            {t3(locale, 'Erneut senden', 'إعادة الإرسال')}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-4 space-y-2">
          {log.errorMessage && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-200 dark:border-red-900/50">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-red-700 dark:text-red-300">
                  {t3(locale, 'Fehlermeldung', 'رسالة الخطأ')}
                </div>
                <div dir="ltr" className="font-mono text-red-600 dark:text-red-300 mt-0.5 break-all">
                  {log.errorMessage}
                </div>
              </div>
            </div>
          )}
          <div dir="ltr" className="text-[11px] font-mono text-muted-foreground">
            Event-ID: {log.eventId}
          </div>
        </div>
      )}
    </li>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'error'
}) {
  const toneClass: Record<string, string> = {
    default: 'text-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${toneClass[tone]}`}>
        {value}
      </div>
    </div>
  )
}
