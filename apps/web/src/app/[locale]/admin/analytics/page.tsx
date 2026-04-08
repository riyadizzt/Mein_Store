'use client'

import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Search, TrendingUp, ExternalLink, AlertTriangle, Trash2, RefreshCw, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function AnalyticsPage() {
  const locale = useLocale()
  const t = (de: string, ar: string) => locale === 'ar' ? ar : de
  const queryClient = useQueryClient()

  const { data: searchData, isLoading, refetch } = useQuery({
    queryKey: ['admin-search-analytics'],
    queryFn: async () => { const { data } = await api.get('/admin/analytics/search'); return data },
    staleTime: 30000,
  })

  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/settings'); return data },
  })

  const clearMut = useMutation({
    mutationFn: () => api.delete('/admin/analytics/search'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-search-analytics'] })
    },
  })

  const posthogKey = settings?.posthog_key

  const topTerms = searchData?.topTerms ?? []
  const zeroResults = searchData?.zeroResults ?? []
  const maxCount = topTerms.length > 0 ? topTerms[0].count : 1

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#d4a853]/15 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-[#d4a853]" />
            </div>
            {t('Analytics & Suche', 'التحليلات والبحث')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t('Suchverhalten der Kunden und Shop-Performance', 'سلوك بحث العملاء وأداء المتجر')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 border-white/10" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('Aktualisieren', 'تحديث')}
          </Button>
          {posthogKey && (
            <a href="https://eu.posthog.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2 border-white/10">
                <ExternalLink className="h-3.5 w-3.5" />
                PostHog
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t('Suchen heute', 'عمليات البحث اليوم'), value: searchData?.totals?.today ?? 0, icon: Search, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: t('Suchen diese Woche', 'عمليات البحث هذا الأسبوع'), value: searchData?.totals?.week ?? 0, icon: TrendingUp, color: 'text-[#d4a853]', bg: 'bg-[#d4a853]/10' },
          { label: t('Suchen diesen Monat', 'عمليات البحث هذا الشهر'), value: searchData?.totals?.month ?? 0, icon: Zap, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
        ].map((kpi, i) => (
          <div key={i} className="bg-[#1a1a2e] rounded-2xl p-5 border border-white/[0.06] hover:border-white/[0.1] transition-colors">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 font-medium uppercase tracking-wider">{kpi.label}</p>
              <div className={`h-8 w-8 rounded-lg ${kpi.bg} flex items-center justify-center`}>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
            </div>
            <p className="text-3xl font-bold text-white tabular-nums">
              {isLoading ? <span className="inline-block h-8 w-16 bg-white/5 rounded animate-pulse" /> : kpi.value.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')}
            </p>
          </div>
        ))}
      </div>

      {/* ── Two columns: Top Terms + Zero Results ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Search Terms */}
        <div className="bg-[#1a1a2e] rounded-2xl border border-white/[0.06] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#d4a853]" />
              <h2 className="text-sm font-semibold text-white">{t('Top Suchbegriffe', 'أكثر الكلمات بحثاً')}</h2>
            </div>
            <span className="text-[10px] text-white/25 uppercase tracking-wider">{t('30 Tage', '30 يوم')}</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3.5"><div className="h-4 bg-white/5 rounded w-48 animate-pulse" /></div>
              ))
            ) : topTerms.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Search className="h-8 w-8 text-white/10 mx-auto mb-2" />
                <p className="text-sm text-white/25">{t('Noch keine Suchdaten', 'لا توجد بيانات بحث بعد')}</p>
              </div>
            ) : (
              topTerms.slice(0, 10).map((term: any, i: number) => (
                <div key={i} className="px-5 py-3 group hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-3">
                      <span className="text-white/20 tabular-nums text-xs w-5 text-end font-medium">{i + 1}</span>
                      <span className="text-sm text-white/80 font-medium">{term.query}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-white/30 tabular-nums">{term.avgResults} {t('Erg.', 'نتيجة')}</span>
                      <span className="text-sm text-white font-semibold tabular-nums">{term.count}×</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden ltr:ml-8 rtl:mr-8">
                    <div
                      className="h-full rounded-full bg-[#d4a853]/40 transition-all duration-500"
                      style={{ width: `${(term.count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Zero-Result Searches */}
        <div className="bg-[#1a1a2e] rounded-2xl border border-white/[0.06] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              <h2 className="text-sm font-semibold text-white">{t('Suchen ohne Ergebnis', 'عمليات بحث بدون نتائج')}</h2>
            </div>
            <span className="text-[10px] text-white/25 uppercase tracking-wider">{t('30 Tage', '30 يوم')}</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3.5"><div className="h-4 bg-white/5 rounded w-40 animate-pulse" /></div>
              ))
            ) : zeroResults.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="text-2xl mb-2">🎉</div>
                <p className="text-sm text-white/25">{t('Alle Suchen haben Ergebnisse', 'جميع عمليات البحث أعطت نتائج')}</p>
              </div>
            ) : (
              zeroResults.slice(0, 10).map((term: any, i: number) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between group hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <Search className="h-3.5 w-3.5 text-orange-400/40" />
                    <span className="text-sm text-white/70">{term.query}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-orange-400/10 text-orange-400 text-xs font-semibold tabular-nums">{term.count}×</span>
                </div>
              ))
            )}
          </div>
          {zeroResults.length > 0 && (
            <div className="px-5 py-3 border-t border-white/[0.04]">
              <p className="text-[11px] text-white/25 italic">
                {t('💡 Tipp: Füge diese Produkte hinzu oder erstelle Synonyme.', '💡 نصيحة: أضف هذه المنتجات أو أنشئ مرادفات.')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Actions Bar ── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#1a1a2e] rounded-2xl border border-white/[0.06] p-5">
        <div className="flex items-center gap-3">
          <Link href={`/${locale}/admin/settings/tracking`}>
            <Button variant="outline" size="sm" className="gap-2 border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/10">
              {t('Tracking-Einstellungen', 'إعدادات التتبع')}
            </Button>
          </Link>
          {posthogKey && (
            <a href="https://eu.posthog.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2 border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/10">
                <ExternalLink className="h-3.5 w-3.5" />
                PostHog
              </Button>
            </a>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          onClick={() => {
            if (confirm(t('Alle Such-Logs löschen? Diese Aktion kann nicht rückgängig gemacht werden.', 'حذف جميع سجلات البحث؟ لا يمكن التراجع عن هذا الإجراء.'))) {
              clearMut.mutate()
            }
          }}
          disabled={clearMut.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {clearMut.isPending ? t('Wird gelöscht...', 'جاري الحذف...') : t('Such-Logs zurücksetzen', 'إعادة تعيين سجلات البحث')}
        </Button>
      </div>

      {/* ── PostHog Hint ── */}
      {!posthogKey && (
        <div className="bg-gradient-to-br from-[#1a1a2e] to-[#1a1a2e]/80 rounded-2xl border border-white/[0.06] p-8 text-center">
          <div className="h-12 w-12 rounded-2xl bg-[#d4a853]/10 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="h-6 w-6 text-[#d4a853]/50" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">{t('PostHog nicht konfiguriert', 'PostHog غير مُفعّل')}</h3>
          <p className="text-sm text-white/35 max-w-md mx-auto mb-5">
            {t(
              'Für detaillierte Besucher-Analytics (Seitenaufrufe, Heatmaps, Session Replay) konfiguriere PostHog in den Einstellungen.',
              'لتحليلات الزوار التفصيلية (مشاهدات الصفحات، خرائط الحرارة، تسجيل الجلسات) قم بتفعيل PostHog في الإعدادات.'
            )}
          </p>
          <Link href={`/${locale}/admin/settings/tracking`}>
            <Button size="sm" className="gap-2 bg-[#d4a853] hover:bg-[#b8953f] text-white">
              {t('PostHog konfigurieren', 'تفعيل PostHog')}
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
