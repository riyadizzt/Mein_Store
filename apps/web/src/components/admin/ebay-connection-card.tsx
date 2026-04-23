'use client'

/**
 * eBay Connection Card — admin widget (C10).
 *
 * Self-contained card rendered at the top of /admin/channels.
 * Shows connection status, exposes Connect/Disconnect buttons,
 * and — in sandbox mode only — the "Sandbox-Policies anlegen"
 * button that triggers our idempotent bootstrap.
 *
 * Design:
 *   - Null touch on existing Channels UI. Composable — parent
 *     just renders <EbayConnectionCard /> once.
 *   - All text lives in 3 languages (de / en / ar) — pattern
 *     consistent with other admin cards.
 *   - Post-OAuth-return: reads ?ebay=connected / ?ebay=error
 *     query params surfaced by the backend redirect and shows a
 *     transient toast / banner.
 *   - Calls go through shared `api` helper (auto-attaches admin
 *     JWT, credentials:'include').
 */

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  ShoppingBag,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Power,
  Wrench,
  KeyRound,
  Upload,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

const t3 = (l: string, d: string, e: string, a: string) =>
  l === 'ar' ? a : l === 'en' ? e : d

interface PublishEntry {
  listingId: string
  ok: boolean
  externalListingId?: string
  alreadyPublished?: boolean
  marginWarning?: boolean
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
}

interface PublishPendingSummary {
  requested: number
  published: number
  failed: number
  remaining: number
  results: PublishEntry[]
}

interface Status {
  mode: 'sandbox' | 'production'
  connected: boolean
  tokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  hasRefreshToken: boolean
  externalId: string | null
  policyIds?: {
    fulfillmentPolicyId?: string
    returnPolicyId?: string
    paymentPolicyId?: string
  }
  missingEnvVars: string[]
  masterKeyMissing: boolean
}

export function EbayConnectionCard() {
  const locale = useLocale()
  const qc = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [publishSummary, setPublishSummary] = useState<PublishPendingSummary | null>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  // Surface ?ebay=connected / ?ebay=error from OAuth redirect.
  useEffect(() => {
    const flag = searchParams.get('ebay')
    if (flag === 'connected') {
      setBanner({
        kind: 'success',
        text: t3(locale, 'eBay erfolgreich verbunden.', 'eBay connected successfully.', 'تم ربط eBay بنجاح.'),
      })
    } else if (flag === 'error') {
      const code = searchParams.get('code') ?? 'unknown'
      setBanner({
        kind: 'error',
        text:
          t3(
            locale,
            `Verbindungsfehler: ${code}. Bitte erneut versuchen.`,
            `Connection error: ${code}. Please retry.`,
            `خطأ في الاتصال: ${code}. يرجى المحاولة مرة أخرى.`,
          ),
      })
    }
    // Clean the query params so a refresh doesn't re-show the banner.
    if (flag) {
      router.replace(pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: status, isLoading } = useQuery<Status>({
    queryKey: ['admin', 'marketplaces', 'ebay', 'status'],
    queryFn: async () => (await api.get('/admin/marketplaces/ebay/status')).data as Status,
    refetchInterval: 60_000,
  })

  const connectMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/marketplaces/ebay/connect')).data as { url: string },
    onSuccess: (d) => {
      window.location.href = d.url
    },
    onError: (e: any) => {
      setBanner({
        kind: 'error',
        text: e?.message?.[locale] ?? e?.message?.de ?? t3(locale, 'Verbindung fehlgeschlagen', 'Connect failed', 'فشل الاتصال'),
      })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/marketplaces/ebay/disconnect')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'marketplaces', 'ebay'] }),
  })

  const bootstrapMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/admin/marketplaces/ebay/bootstrap-sandbox-policies')).data as {
        fulfillmentPolicyId: string
        returnPolicyId: string
        paymentPolicyId: string
        alreadyExisted: any
      },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'marketplaces', 'ebay'] })
      setBanner({
        kind: 'success',
        text: t3(
          locale,
          'Sandbox-Policies erfolgreich bereitgestellt.',
          'Sandbox policies provisioned successfully.',
          'تم إعداد سياسات Sandbox بنجاح.',
        ),
      })
    },
    onError: (e: any) => {
      // 3-lang message is preserved in e.response.data.message by the
      // shared api.ts handler. e.message is the Error-constructor
      // toString() of the same object — looks like "[object Object]" —
      // so we always prefer the structured source.
      const msg = e?.response?.data?.message ?? e?.message
      setBanner({
        kind: 'error',
        text:
          (typeof msg === 'object' ? msg[locale] ?? msg.de : msg) ??
          t3(locale, 'Policy-Bootstrap fehlgeschlagen', 'Policy bootstrap failed', 'فشل إعداد السياسات'),
      })
    },
  })

  // Pending count — only fetched when connected (endpoint requires auth
  // and the count is meaningless without a live eBay connection).
  const pendingQuery = useQuery<{ count: number }>({
    queryKey: ['admin', 'marketplaces', 'ebay', 'pending-count'],
    queryFn: async () => (await api.get('/admin/marketplaces/ebay/pending-count')).data as { count: number },
    enabled: !!status?.connected,
    refetchInterval: 60_000,
  })

  const publishMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/admin/marketplaces/ebay/publish-pending', {})).data as PublishPendingSummary,
    onSuccess: (d) => {
      // Backend now throws HttpException on token-level failures, so any
      // response reaching onSuccess is guaranteed to be a real summary.
      const s = d
      setPublishSummary(s)
      setSummaryExpanded(false)
      qc.invalidateQueries({ queryKey: ['admin', 'marketplaces', 'ebay', 'pending-count'] })
      qc.invalidateQueries({ queryKey: ['ebay', 'listings'] })
      if (s.published > 0 && s.failed === 0) {
        setBanner({
          kind: 'success',
          text: t3(
            locale,
            `${s.published} Angebote veröffentlicht.`,
            `${s.published} listings published.`,
            `تم نشر ${s.published} من العروض.`,
          ),
        })
      } else if (s.published > 0 && s.failed > 0) {
        setBanner({
          kind: 'error',
          text: t3(
            locale,
            `${s.published} veröffentlicht, ${s.failed} fehlgeschlagen.`,
            `${s.published} published, ${s.failed} failed.`,
            `تم نشر ${s.published}، وفشل ${s.failed}.`,
          ),
        })
      } else if (s.failed > 0) {
        setBanner({
          kind: 'error',
          text: t3(
            locale,
            `Alle ${s.failed} Versuche fehlgeschlagen. Details unten.`,
            `All ${s.failed} attempts failed. Details below.`,
            `فشلت جميع المحاولات ${s.failed}. التفاصيل أدناه.`,
          ),
        })
      }
    },
    onError: (e: any) => {
      // Structured 3-lang message lives in e.response.data.message. The
      // Error-constructor toString()s the object into e.message, so
      // prefer the structured source.
      const msg = e?.response?.data?.message ?? e?.message
      setBanner({
        kind: 'error',
        text:
          (typeof msg === 'object' ? msg[locale] ?? msg.de : msg) ??
          t3(locale, 'Veröffentlichung fehlgeschlagen', 'Publish failed', 'فشل النشر'),
      })
    },
  })

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6 mb-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const s = status!
  const pendingCount = pendingQuery.data?.count ?? 0

  return (
    <div className="rounded-xl border bg-card p-6 mb-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-yellow-500/10">
          <ShoppingBag className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base">eBay</h3>
          <p className="text-xs text-muted-foreground">
            {t3(locale, 'Marketplace-Integration (Phase 2)', 'Marketplace integration (Phase 2)', 'تكامل المتجر (المرحلة 2)')}
          </p>
        </div>
        <ModeBadge mode={s.mode} />
      </div>

      {/* Transient banner */}
      {banner && (
        <div
          className={
            'rounded-lg p-3 text-sm flex items-start gap-2 ' +
            (banner.kind === 'success'
              ? 'bg-green-500/10 text-green-800 dark:text-green-300'
              : 'bg-amber-500/10 text-amber-900 dark:text-amber-200')
          }
        >
          {banner.kind === 'success' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Env diagnostics */}
      {s.missingEnvVars.length > 0 && (
        <DiagnosticBanner
          kind="error"
          icon={<KeyRound className="h-4 w-4" />}
          title={t3(locale, 'eBay-Zugangsdaten unvollständig', 'eBay credentials incomplete', 'بيانات اعتماد eBay غير مكتملة')}
          body={
            t3(
              locale,
              'Bitte setze in apps/api/.env: ',
              'Please set in apps/api/.env: ',
              'يرجى ضبط في apps/api/.env: ',
            ) + s.missingEnvVars.join(', ')
          }
        />
      )}
      {s.masterKeyMissing && (
        <DiagnosticBanner
          kind="error"
          icon={<KeyRound className="h-4 w-4" />}
          title={t3(locale, 'Master-Key fehlt', 'Master key missing', 'المفتاح الرئيسي مفقود')}
          body={t3(
            locale,
            'CHANNEL_TOKEN_MASTER_KEY ist nicht gesetzt. Siehe docs/admin-runbook/master-key-management.md.',
            'CHANNEL_TOKEN_MASTER_KEY is not set. See docs/admin-runbook/master-key-management.md.',
            'لم يتم ضبط CHANNEL_TOKEN_MASTER_KEY. راجع docs/admin-runbook/master-key-management.md.',
          )}
        />
      )}

      {/* Connection state */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatusTile
          label={t3(locale, 'Status', 'Status', 'الحالة')}
          value={
            s.connected
              ? t3(locale, 'Verbunden', 'Connected', 'متصل')
              : t3(locale, 'Nicht verbunden', 'Not connected', 'غير متصل')
          }
          tone={s.connected ? 'good' : 'muted'}
        />
        <StatusTile
          label={t3(locale, 'Token läuft ab', 'Token expires', 'انتهاء الرمز')}
          value={
            s.tokenExpiresAt
              ? new Date(s.tokenExpiresAt).toLocaleString(locale)
              : '—'
          }
          tone="muted"
        />
        <StatusTile
          label={t3(locale, 'Shipping-Policy', 'Shipping policy', 'سياسة الشحن')}
          value={s.policyIds?.fulfillmentPolicyId ?? '—'}
          tone={s.policyIds?.fulfillmentPolicyId ? 'good' : 'muted'}
          mono
        />
        <StatusTile
          label={t3(locale, 'Return-Policy', 'Return policy', 'سياسة الإرجاع')}
          value={s.policyIds?.returnPolicyId ?? '—'}
          tone={s.policyIds?.returnPolicyId ? 'good' : 'muted'}
          mono
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t">
        {!s.connected && (
          <Button
            size="sm"
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending || s.missingEnvVars.length > 0 || s.masterKeyMissing}
          >
            {connectMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            {t3(locale, 'eBay verbinden', 'Connect eBay', 'ربط eBay')}
          </Button>
        )}

        {s.connected && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm(t3(locale, 'eBay-Verbindung wirklich trennen?', 'Really disconnect eBay?', 'هل تريد قطع اتصال eBay حقا؟'))) {
                disconnectMutation.mutate()
              }
            }}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Power className="h-4 w-4 mr-2" />
            )}
            {t3(locale, 'Trennen', 'Disconnect', 'قطع الاتصال')}
          </Button>
        )}

        {s.mode === 'sandbox' && s.connected && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => bootstrapMutation.mutate()}
            disabled={bootstrapMutation.isPending}
            title={t3(
              locale,
              'Erstellt die 3 Sandbox-Policies idempotent',
              'Creates the 3 sandbox policies idempotently',
              'ينشئ سياسات Sandbox الثلاث بشكل idempotent',
            )}
          >
            {bootstrapMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Wrench className="h-4 w-4 mr-2" />
            )}
            {t3(locale, 'Sandbox-Policies anlegen', 'Bootstrap sandbox policies', 'إعداد سياسات Sandbox')}
          </Button>
        )}

        {s.connected && pendingCount > 0 && (
          <Button
            size="sm"
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            title={t3(
              locale,
              'Veröffentlicht alle ausstehenden eBay-Angebote (max. 25 pro Durchgang)',
              'Publishes all pending eBay listings (max 25 per run)',
              'ينشر جميع عروض eBay المعلقة (بحد أقصى 25 لكل تشغيل)',
            )}
          >
            {publishMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {t3(
              locale,
              `Veröffentlichen (${pendingCount})`,
              `Publish (${pendingCount})`,
              `نشر (${pendingCount})`,
            )}
          </Button>
        )}
      </div>

      {/* Publish-result summary (sticky until user clears or reruns). */}
      {publishSummary && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="text-muted-foreground">
                {t3(locale, 'Versucht', 'Attempted', 'تم المحاولة')}:{' '}
                <span className="font-medium text-foreground">{publishSummary.requested}</span>
              </span>
              <span className="text-green-700 dark:text-green-400">
                {t3(locale, 'Veröffentlicht', 'Published', 'تم النشر')}:{' '}
                <span className="font-medium">{publishSummary.published}</span>
              </span>
              <span className="text-amber-700 dark:text-amber-400">
                {t3(locale, 'Fehlgeschlagen', 'Failed', 'فشل')}:{' '}
                <span className="font-medium">{publishSummary.failed}</span>
              </span>
              <span className="text-muted-foreground">
                {t3(locale, 'Verbleibend', 'Remaining', 'متبقي')}:{' '}
                <span className="font-medium text-foreground">{publishSummary.remaining}</span>
              </span>
            </div>
            {publishSummary.results.length > 0 && (
              <button
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0"
                type="button"
              >
                {summaryExpanded
                  ? t3(locale, 'Details ausblenden', 'Hide details', 'إخفاء التفاصيل')
                  : t3(locale, 'Details anzeigen', 'Show details', 'عرض التفاصيل')}
                {summaryExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>

          {summaryExpanded && publishSummary.results.length > 0 && (
            <div className="pt-2 border-t space-y-1.5">
              {publishSummary.results.map((r) => (
                <PublishResultRow key={r.listingId} entry={r} locale={locale} sandbox={s.mode === 'sandbox'} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: 'sandbox' | 'production' }) {
  const isProd = mode === 'production'
  return (
    <span
      className={
        'text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full ' +
        (isProd
          ? 'bg-red-500/10 text-red-700 dark:text-red-400'
          : 'bg-amber-500/10 text-amber-800 dark:text-amber-300')
      }
    >
      {mode}
    </span>
  )
}

function StatusTile({
  label,
  value,
  tone,
  mono,
}: {
  label: string
  value: string
  tone: 'good' | 'muted'
  mono?: boolean
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          'text-sm mt-1 ' +
          (mono ? 'font-mono text-xs break-all ' : '') +
          (tone === 'good' ? 'text-green-700 dark:text-green-400' : '')
        }
      >
        {value}
      </div>
    </div>
  )
}

function PublishResultRow({
  entry,
  locale,
  sandbox,
}: {
  entry: PublishEntry
  locale: string
  sandbox: boolean
}) {
  const itemUrlBase = sandbox ? 'https://sandbox.ebay.de/itm/' : 'https://www.ebay.de/itm/'
  if (entry.ok) {
    return (
      <div className="flex items-start gap-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-muted-foreground truncate">{entry.listingId}</span>
            {entry.externalListingId && (
              <a
                href={itemUrlBase + entry.externalListingId}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-[11px]"
              >
                {entry.externalListingId}
                <ExternalLink className="inline h-3 w-3 ltr:ml-1 rtl:mr-1" />
              </a>
            )}
            {entry.alreadyPublished && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300">
                {t3(locale, 'bereits veröffentlicht', 'already published', 'منشور مسبقًا')}
              </span>
            )}
            {entry.marginWarning && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300"
                title={t3(
                  locale,
                  'eBay-Preis liegt unter Shop-Preis × 1,15 — Provision könnte nicht gedeckt sein.',
                  'eBay price is below shop price × 1.15 — commission may not be covered.',
                  'سعر eBay أقل من سعر المتجر × 1.15 — قد لا تتم تغطية العمولة.',
                )}
              >
                {t3(locale, 'Margen-Warnung', 'Margin warning', 'تحذير الهامش')}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-muted-foreground truncate">{entry.listingId}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 font-mono">
            {entry.errorCode}
          </span>
          {entry.retryable && (
            <span className="text-[10px] text-muted-foreground">
              {t3(locale, 'wird erneut versucht', 'will retry', 'ستتم إعادة المحاولة')}
            </span>
          )}
        </div>
        {entry.errorMessage && (
          <div className="mt-1 text-muted-foreground break-words">{entry.errorMessage}</div>
        )}
      </div>
    </div>
  )
}

function DiagnosticBanner({
  kind,
  icon,
  title,
  body,
}: {
  kind: 'error' | 'warn'
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div
      className={
        'rounded-lg p-3 text-sm flex items-start gap-2 ' +
        (kind === 'error'
          ? 'bg-amber-500/10 text-amber-900 dark:text-amber-200'
          : 'bg-blue-500/10 text-blue-900 dark:text-blue-200')
      }
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs mt-1 opacity-90">{body}</div>
      </div>
    </div>
  )
}
