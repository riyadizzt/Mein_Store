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
} from 'lucide-react'

const t3 = (l: string, d: string, e: string, a: string) =>
  l === 'ar' ? a : l === 'en' ? e : d

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
      const msg = e?.message
      setBanner({
        kind: 'error',
        text:
          (typeof msg === 'object' ? msg[locale] ?? msg.de : msg) ??
          t3(locale, 'Policy-Bootstrap fehlgeschlagen', 'Policy bootstrap failed', 'فشل إعداد السياسات'),
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
      </div>
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
