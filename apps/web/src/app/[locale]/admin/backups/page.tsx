'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Database, Download, Play, Loader2, CheckCircle2, AlertTriangle, Archive, HardDrive, Info, Calendar, User } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

// ── Types ─────────────────────────────────────────────────────

type BackupRow = {
  id: string
  type: 'DAILY' | 'MONTHLY' | 'MANUAL'
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'EXPIRED'
  startedAt: string
  completedAt: string | null
  sizeBytes: string | null
  storageKey: string | null
  sha256: string | null
  errorMessage: string | null
  triggeredByUserId: string | null
}

type HealthRow = {
  r2Configured: boolean
  objectCount: number | null
  error?: string
}

// ── Labels / formatting ───────────────────────────────────────

const t3 = (l: string, de: string, en: string, ar: string) => (l === 'ar' ? ar : l === 'en' ? en : de)

const TYPE_LABEL: Record<BackupRow['type'], { de: string; en: string; ar: string; badge: string }> = {
  DAILY:   { de: 'Täglich',      en: 'Daily',   ar: 'يومي',  badge: 'bg-blue-500/15 text-blue-300' },
  MONTHLY: { de: 'Monatlich',    en: 'Monthly', ar: 'شهري',  badge: 'bg-violet-500/15 text-violet-300' },
  MANUAL:  { de: 'Manuell',      en: 'Manual',  ar: 'يدوي', badge: 'bg-amber-500/15 text-amber-300' },
}

const STATUS_LABEL: Record<BackupRow['status'], { de: string; en: string; ar: string; badge: string; Icon: any }> = {
  RUNNING: { de: 'Läuft',         en: 'Running', ar: 'قيد التشغيل', badge: 'bg-slate-500/15 text-slate-300', Icon: Loader2 },
  SUCCESS: { de: 'Erfolgreich',   en: 'Success', ar: 'ناجح',        badge: 'bg-emerald-500/15 text-emerald-300', Icon: CheckCircle2 },
  FAILED:  { de: 'Fehlgeschlagen', en: 'Failed', ar: 'فشل',          badge: 'bg-red-500/15 text-red-300', Icon: AlertTriangle },
  EXPIRED: { de: 'Abgelaufen',    en: 'Expired', ar: 'منتهي',        badge: 'bg-neutral-500/15 text-neutral-300', Icon: Archive },
}

function formatSize(bytes: string | null): string {
  if (!bytes) return '—'
  const n = Number(bytes)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso)
  // Latin numerals even for AR per project convention.
  const loc = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE'
  return d.toLocaleString(loc, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

// ══════════════════════════════════════════════════════════════
// Page
// ══════════════════════════════════════════════════════════════

export default function AdminBackupsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const [errorDetail, setErrorDetail] = useState<BackupRow | null>(null)

  const { data: backups, isLoading } = useQuery<BackupRow[]>({
    queryKey: ['admin-backups'],
    queryFn: async () => {
      const { data } = await api.get('/admin/backups')
      return Array.isArray(data) ? data : []
    },
    refetchInterval: 15_000, // auto-refresh while a backup is RUNNING
  })

  const { data: health } = useQuery<HealthRow>({
    queryKey: ['admin-backups-health'],
    queryFn: async () => {
      const { data } = await api.get('/admin/backups/health')
      return data
    },
  })

  const triggerManual = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/backups/manual')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-backups'] }),
  })

  const download = async (id: string) => {
    try {
      const { data } = await api.get(`/admin/backups/${id}/download-url`)
      if (data?.url) window.open(data.url, '_blank', 'noopener')
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Download-URL konnte nicht erstellt werden')
    }
  }

  const runningCount = (backups ?? []).filter((b) => b.status === 'RUNNING').length

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'Backups', 'Backups', 'النسخ الاحتياطية') }]} />

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-[#d4a853]" />
            {t3(locale, 'Backups', 'Backups', 'النسخ الاحتياطية')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t3(
              locale,
              'Automatische DB-Backups laufen täglich um 03:00 UTC. Manuelle Snapshots sind jederzeit möglich. Download erzeugt einen signierten Link (15 Min gültig).',
              'Automatic DB backups run daily at 03:00 UTC. Manual snapshots can be created at any time. Download generates a signed link (valid for 15 minutes).',
              'النسخ الاحتياطية التلقائية تعمل يومياً الساعة 03:00 UTC. يمكن إنشاء لقطات يدوية في أي وقت. التنزيل يولد رابطاً موقعاً (صالح لـ 15 دقيقة).',
            )}
          </p>
        </div>
        <Button
          onClick={() => triggerManual.mutate()}
          disabled={triggerManual.isPending || runningCount > 0}
          className="gap-2"
        >
          {triggerManual.isPending || runningCount > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {t3(locale, 'Manueller Backup', 'Manual Backup', 'نسخة يدوية')}
        </Button>
      </div>

      {/* Health strip */}
      {health && (
        <div className="mb-4 rounded-xl border border-border bg-card p-3 flex items-center gap-3 flex-wrap">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          {health.r2Configured ? (
            <>
              <span className="text-sm">
                <span className="text-muted-foreground">
                  {t3(locale, 'R2 verbunden', 'R2 connected', 'R2 متصل')} ·{' '}
                </span>
                <span className="font-semibold">{health.objectCount ?? '—'}</span>{' '}
                <span className="text-muted-foreground">
                  {t3(locale, 'Objekte', 'objects', 'كائنات')}
                </span>
              </span>
              {health.error && (
                <span className="text-xs text-amber-400">· {health.error}</span>
              )}
            </>
          ) : (
            <span className="text-sm text-red-400">
              ⚠ {t3(locale, 'R2 nicht konfiguriert — setze R2_BACKUP_* Env-Variablen', 'R2 not configured — set R2_BACKUP_* env vars', 'R2 غير مهيأ — حدد متغيرات البيئة R2_BACKUP_*')}
            </span>
          )}
        </div>
      )}

      {/* Info banner */}
      <div className="mb-4 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed">
          {t3(
            locale,
            'Retention: 30 tägliche + 12 monatliche + 14 Tage manuelle Backups. Wiederherstellung erfolgt manuell via SSH — Anleitung unter docs/admin-runbook/backup-wiederherstellung.md.',
            'Retention: 30 daily + 12 monthly + 14-day manual backups. Restore is done manually via SSH — see docs/admin-runbook/backup-wiederherstellung.md.',
            'الاحتفاظ: 30 يومي + 12 شهري + 14 يوم يدوي. الاستعادة يدوية عبر SSH — راجع docs/admin-runbook/backup-wiederherstellung.md.',
          )}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : (backups ?? []).length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-muted-foreground text-sm">
            {t3(locale, 'Noch keine Backups erstellt', 'No backups yet', 'لم يتم إنشاء نسخ احتياطية بعد')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_120px_100px_100px_130px_120px] gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
            <div>{t3(locale, 'Gestartet', 'Started', 'بدأ في')}</div>
            <div>{t3(locale, 'Typ', 'Type', 'النوع')}</div>
            <div>{t3(locale, 'Status', 'Status', 'الحالة')}</div>
            <div className="text-end">{t3(locale, 'Dauer', 'Duration', 'المدة')}</div>
            <div className="text-end">{t3(locale, 'Größe', 'Size', 'الحجم')}</div>
            <div>{t3(locale, 'Auslöser', 'Trigger', 'المُطلق')}</div>
            <div className="text-end">{t3(locale, 'Aktion', 'Action', 'إجراء')}</div>
          </div>
          {(backups ?? []).map((b) => {
            const TypeMeta = TYPE_LABEL[b.type]
            const StatusMeta = STATUS_LABEL[b.status]
            const StatusIcon = StatusMeta.Icon
            return (
              <div
                key={b.id}
                className="grid grid-cols-[1fr_100px_120px_100px_100px_130px_120px] gap-2 px-4 py-3 text-sm border-b border-border last:border-b-0 items-center hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium truncate" dir="ltr">{formatDateTime(b.startedAt, locale)}</span>
                </div>
                <div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TypeMeta.badge}`}>
                    {TypeMeta[locale as 'de' | 'en' | 'ar'] ?? TypeMeta.de}
                  </span>
                </div>
                <div>
                  <button
                    onClick={() => b.status === 'FAILED' ? setErrorDetail(b) : undefined}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${StatusMeta.badge} ${b.status === 'FAILED' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  >
                    <StatusIcon className={`h-3 w-3 ${b.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                    {StatusMeta[locale as 'de' | 'en' | 'ar'] ?? StatusMeta.de}
                  </button>
                </div>
                <div className="text-end text-muted-foreground tabular-nums" dir="ltr">
                  {formatDuration(b.startedAt, b.completedAt)}
                </div>
                <div className="text-end text-muted-foreground tabular-nums" dir="ltr">
                  {formatSize(b.sizeBytes)}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                  {b.triggeredByUserId ? (
                    <>
                      <User className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{t3(locale, 'Admin', 'Admin', 'أدمن')}</span>
                    </>
                  ) : (
                    <span className="truncate">{t3(locale, 'Automatisch', 'Auto', 'تلقائي')}</span>
                  )}
                </div>
                <div className="text-end">
                  {b.status === 'SUCCESS' && (
                    <button
                      onClick={() => download(b.id)}
                      className="inline-flex items-center gap-1 text-[#d4a853] hover:text-[#c49b45] text-xs font-medium"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t3(locale, 'Download', 'Download', 'تنزيل')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error detail modal */}
      {errorDetail && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setErrorDetail(null)}
        >
          <div
            className="bg-card border border-red-500/30 rounded-2xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <h3 className="font-semibold">
                  {t3(locale, 'Backup-Fehler', 'Backup error', 'خطأ النسخ الاحتياطي')}
                </h3>
              </div>
              <button
                onClick={() => setErrorDetail(null)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-2" dir="ltr">
              {formatDateTime(errorDetail.startedAt, locale)}
            </p>
            <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {errorDetail.errorMessage ?? '(keine Details verfügbar)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
