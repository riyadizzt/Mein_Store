'use client'

import Link from 'next/link'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Webhook, Plus, Zap, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { t3, t3all, WEBHOOK_EVENT_GROUPS } from './event-catalog'

interface WebhookSubscription {
  id: string
  url: string
  description: string | null
  events: string[]
  isActive: boolean
  totalDeliveries: number
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  lastDeliveryAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
}

export default function WebhooksListPage() {
  const locale = useLocale()

  const { data: subs, isLoading } = useQuery<WebhookSubscription[]>({
    queryKey: ['admin-webhooks'],
    queryFn: async () => {
      const { data } = await api.get('/admin/webhooks')
      return Array.isArray(data) ? data : []
    },
  })

  return (
    <div>
      <AdminBreadcrumb
        items={[{ label: t3(locale, 'Webhooks', 'الويب هوك') }]}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Webhook className="h-6 w-6 text-[#d4a853]" />
            {t3(locale, 'Webhooks', 'الويب هوك')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t3(
              locale,
              'Benachrichtige externe Systeme (n8n, Zapier, Slack, …) automatisch über Ereignisse in deinem Shop.',
              'أبلِغ الأنظمة الخارجية (n8n, Zapier, Slack, …) تلقائياً بالأحداث في متجرك.',
            )}
          </p>
        </div>
        {(subs?.length ?? 0) > 0 && (
          <Link href={`/${locale}/admin/webhooks/new`}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {t3(locale, 'Neuer Webhook', 'ويب هوك جديد')}
            </Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-40 rounded-xl border border-border/60 bg-background/60 animate-pulse"
            />
          ))}
        </div>
      ) : (subs?.length ?? 0) === 0 ? (
        <EmptyState locale={locale} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subs!.map((sub) => (
            <WebhookCard key={sub.id} sub={sub} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────

function EmptyState({ locale }: { locale: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-[#0f1419]/[0.02] via-background to-[#d4a853]/5 p-10 sm:p-14 text-center">
      <div className="mx-auto h-16 w-16 rounded-full bg-[#d4a853]/10 flex items-center justify-center ring-1 ring-[#d4a853]/30 mb-5">
        <Zap className="h-8 w-8 text-[#d4a853]" />
      </div>
      <h2 className="text-xl font-bold mb-2">
        {t3(locale, 'Noch keine Webhooks eingerichtet', 'لم يتم إعداد أي ويب هوك بعد')}
      </h2>
      <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-6 leading-relaxed">
        {t3(
          locale,
          'Webhooks sind automatische Benachrichtigungen, die dein Shop an andere Systeme sendet. Beispiele: Neue Bestellung auf Slack melden, neues Produkt auf Instagram posten, Retouren-Alarm an Airtable schicken.',
          'الويب هوك هي إشعارات تلقائية يرسلها متجرك إلى أنظمة أخرى. أمثلة: إشعار Slack بطلب جديد، نشر منتج جديد على إنستجرام، تنبيه Airtable بإرجاع.',
        )}
      </p>

      {/* Quick example chips */}
      <div className="flex flex-wrap gap-2 justify-center mb-8 max-w-xl mx-auto">
        {[
          { de: 'Neue Bestellung → Slack', ar: 'طلب جديد ← Slack' },
          { de: 'Neues Produkt → Instagram', ar: 'منتج جديد ← إنستجرام' },
          { de: 'Retoure → Airtable', ar: 'إرجاع ← Airtable' },
          { de: 'Zahlungsausfall → E-Mail', ar: 'فشل الدفع ← بريد إلكتروني' },
        ].map((ex, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background border border-border/60 text-xs font-medium"
          >
            <ArrowRight className="h-3 w-3 text-[#d4a853]" />
            {t3(locale, ex.de, ex.ar)}
          </span>
        ))}
      </div>

      <Link href={`/${locale}/admin/webhooks/new`}>
        <Button size="lg" className="gap-2">
          <Plus className="h-4 w-4" />
          {t3(locale, 'Ersten Webhook erstellen', 'أنشئ أول ويب هوك')}
        </Button>
      </Link>

      <p className="text-xs text-muted-foreground mt-6">
        {t3(
          locale,
          'Unterstützt jede URL, die HTTP-POST-Requests empfangen kann: n8n, Zapier, Make, eigene Server.',
          'يدعم أي عنوان URL يستقبل طلبات HTTP-POST: n8n, Zapier, Make, خوادم خاصة.',
        )}
      </p>
    </div>
  )
}

// ── Subscription card ────────────────────────────────────────

function WebhookCard({ sub, locale }: { sub: WebhookSubscription; locale: string }) {
  const successRate =
    sub.totalDeliveries > 0 ? Math.round((sub.totalSuccesses / sub.totalDeliveries) * 100) : null

  // Status semantics:
  //   - inactive: grey, "Pausiert"
  //   - active + no deliveries yet: gold neutral, "Bereit"
  //   - active + last was success: green, "Aktiv"
  //   - active + consecutive failures > 0: red warn
  const statusInfo = computeStatus(sub, locale)

  const hostname = (() => {
    try {
      return new URL(sub.url).hostname
    } catch {
      return sub.url
    }
  })()

  const eventGroupCounts = WEBHOOK_EVENT_GROUPS.map((g) => ({
    id: g.id,
    label: t3all(locale, g.label),
    count: g.events.filter((e) => sub.events.includes(e.type)).length,
  })).filter((g) => g.count > 0)

  return (
    <Link
      href={`/${locale}/admin/webhooks/${sub.id}`}
      className="group block rounded-xl border border-border/60 bg-background hover:border-[#d4a853]/60 hover:shadow-md transition-all p-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] truncate">
            {sub.description || hostname}
          </h3>
          <p dir="ltr" className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
            {hostname}
          </p>
        </div>
        <StatusPill info={statusInfo} />
      </div>

      {/* Event count chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {eventGroupCounts.slice(0, 4).map((g) => (
          <span
            key={g.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px] font-medium"
          >
            {g.label}
            <span className="text-[#d4a853] tabular-nums">{g.count}</span>
          </span>
        ))}
        {eventGroupCounts.length > 4 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-[11px]">
            +{eventGroupCounts.length - 4}
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/40">
        <Stat
          label={t3(locale, 'Erfolg', 'نجاح')}
          value={successRate === null ? '—' : `${successRate}%`}
          tone={successRate === null ? 'muted' : successRate >= 95 ? 'success' : successRate >= 70 ? 'warn' : 'error'}
        />
        <Stat
          label={t3(locale, 'Gesamt', 'الإجمالي')}
          value={String(sub.totalDeliveries)}
        />
        <Stat
          label={t3(locale, 'Letzter', 'آخر')}
          value={formatRelative(sub.lastDeliveryAt, locale)}
        />
      </div>
    </Link>
  )
}

type StatusTone = 'active' | 'ready' | 'failing' | 'paused'

interface StatusInfo {
  tone: StatusTone
  label: string
}

function computeStatus(sub: WebhookSubscription, locale: string): StatusInfo {
  if (!sub.isActive) {
    return { tone: 'paused', label: t3(locale, 'Pausiert', 'متوقف مؤقتاً') }
  }
  if (sub.consecutiveFailures >= 3) {
    return { tone: 'failing', label: t3(locale, 'Fehlerhaft', 'يفشل') }
  }
  if (sub.totalDeliveries === 0) {
    return { tone: 'ready', label: t3(locale, 'Bereit', 'جاهز') }
  }
  return { tone: 'active', label: t3(locale, 'Aktiv', 'نشط') }
}

function StatusPill({ info }: { info: StatusInfo }) {
  const classByTone: Record<StatusTone, { dot: string; bg: string; text: string }> = {
    active: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
    ready: { dot: 'bg-[#d4a853]', bg: 'bg-[#d4a853]/10', text: 'text-[#d4a853]' },
    failing: { dot: 'bg-red-500 animate-pulse', bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
    paused: { dot: 'bg-muted-foreground', bg: 'bg-muted', text: 'text-muted-foreground' },
  }
  const c = classByTone[info.tone]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${c.bg} ${c.text} shrink-0`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {info.label}
    </span>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'muted' | 'success' | 'warn' | 'error'
}) {
  const toneClass: Record<string, string> = {
    default: 'text-foreground',
    muted: 'text-muted-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    error: 'text-red-600 dark:text-red-400',
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums mt-0.5 ${toneClass[tone]}`}>
        {value}
      </div>
    </div>
  )
}

function formatRelative(iso: string | null, locale: string): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  if (diffMs < 60_000) return t3(locale, 'jetzt', 'الآن')
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return t3(locale, `vor ${mins}m`, `منذ ${mins}د`)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t3(locale, `vor ${hours}h`, `منذ ${hours}س`)
  const days = Math.floor(hours / 24)
  return t3(locale, `vor ${days}T`, `منذ ${days}ي`)
}
