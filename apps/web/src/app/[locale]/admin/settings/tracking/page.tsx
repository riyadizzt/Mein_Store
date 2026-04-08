'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Cookie, ExternalLink, Check, Loader2, Shield, Info } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

/* ── Admin Toggle (dark theme, RTL-safe) ── */
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/90">{label}</p>
        {hint && <p className="text-xs text-white/30 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors duration-200 flex-shrink-0 ${checked ? 'bg-[#d4a853]' : 'bg-white/15'}`}
        dir="ltr"
      >
        <span
          className="absolute top-1 block h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200"
          style={{ left: checked ? '26px' : '4px' }}
        />
      </button>
    </div>
  )
}

/* ── Admin Input (dark theme) ── */
function DarkInput({ label, value, onChange, onBlur, placeholder, mono = false }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; mono?: boolean
}) {
  return (
    <div>
      <label className="text-xs text-white/40 mb-1.5 block font-medium uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full h-10 px-4 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/20 focus:outline-none focus:border-[#d4a853]/40 focus:ring-1 focus:ring-[#d4a853]/20 transition-all ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

export default function TrackingSettingsPage() {
  const locale = useLocale()
  const t = (de: string, ar: string) => locale === 'ar' ? ar : de
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/settings'); return data },
  })

  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const saveMut = useMutation({
    mutationFn: async (patch: Record<string, string>) => { await api.patch('/admin/settings', patch) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-settings'] }),
  })

  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    saveMut.mutate({ [key]: value })
  }

  if (isLoading) {
    return (
      <div className="space-y-5 max-w-2xl">
        {[1, 2].map((i) => <div key={i} className="h-48 bg-white/[0.03] rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#d4a853]/15 flex items-center justify-center">
              <Shield className="h-5 w-5 text-[#d4a853]" />
            </div>
            {t('Tracking & Datenschutz', 'التتبع والخصوصية')}
          </h1>
          <p className="text-sm text-white/40 mt-1.5">
            {t('PostHog Analytics und Cookie-Banner verwalten', 'إدارة PostHog Analytics وبانر الكوكيز')}
          </p>
        </div>
        {saveMut.isSuccess && (
          <span className="text-xs text-green-400 flex items-center gap-1.5 bg-green-400/10 px-3 py-1.5 rounded-full">
            <Check className="h-3.5 w-3.5" />
            {t('Gespeichert', 'تم الحفظ')}
          </span>
        )}
        {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin text-white/30" />}
      </div>

      {/* ═══ Cookie Banner ═══ */}
      <section className="bg-[#1a1a2e] rounded-2xl border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-5 border-b border-white/[0.06] flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#d4a853]/10 flex items-center justify-center">
            <Cookie className="h-4 w-4 text-[#d4a853]" />
          </div>
          <h2 className="text-base font-semibold text-white">{t('Cookie-Banner', 'بانر الكوكيز')}</h2>
        </div>
        <div className="p-6 space-y-4">
          <Toggle
            checked={form.cookie_banner_enabled !== 'false'}
            onChange={(v) => update('cookie_banner_enabled', v ? 'true' : 'false')}
            label={t('Cookie-Banner aktiviert', 'بانر الكوكيز مُفعّل')}
            hint={t('DSGVO-Pflicht — Deaktivierung nur zu Testzwecken', 'واجب قانوني (DSGVO) — التعطيل فقط للاختبار')}
          />
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
            <Info className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-white/40 leading-relaxed">
              {t(
                'Der Banner zeigt 3 Optionen: "Alle akzeptieren", "Nur notwendige" und "Einstellungen". Besucher können Analyse- und Marketing-Cookies einzeln steuern.',
                'يعرض البانر 3 خيارات: "قبول الكل"، "الضرورية فقط" و"الإعدادات". يمكن للزوار التحكم في كوكيز التحليل والتسويق بشكل فردي.'
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ═══ PostHog Analytics ═══ */}
      <section className="bg-[#1a1a2e] rounded-2xl border border-white/[0.06] overflow-hidden">
        <div className="px-6 py-5 border-b border-white/[0.06] flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#d4a853]/10 flex items-center justify-center">
            <BarChart3 className="h-4 w-4 text-[#d4a853]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">PostHog Analytics</h2>
            <p className="text-xs text-white/30">{t('EU-Server · DSGVO-konform', 'خوادم أوروبية · متوافق مع DSGVO')}</p>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <Toggle
            checked={form.posthog_enabled === 'true'}
            onChange={(v) => update('posthog_enabled', v ? 'true' : 'false')}
            label={t('PostHog aktivieren', 'تفعيل PostHog')}
            hint={t('Seitenaufrufe, Heatmaps, Session Replay', 'مشاهدات الصفحات، خرائط الحرارة، تسجيل الجلسات')}
          />

          <div className="h-px bg-white/[0.04]" />

          <div className="grid grid-cols-1 gap-4">
            <DarkInput
              label="API Key"
              value={form.posthog_key ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, posthog_key: v }))}
              onBlur={() => form.posthog_key !== undefined && saveMut.mutate({ posthog_key: form.posthog_key })}
              placeholder="phc_xxxxxxxxxxxxxxxxx"
              mono
            />
            <DarkInput
              label={t('Host (EU-Server)', 'المضيف (خادم أوروبي)')}
              value={form.posthog_host ?? 'https://eu.i.posthog.com'}
              onChange={(v) => setForm((f) => ({ ...f, posthog_host: v }))}
              onBlur={() => form.posthog_host && saveMut.mutate({ posthog_host: form.posthog_host })}
              placeholder="https://eu.i.posthog.com"
              mono
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a href="https://eu.posthog.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2 border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/10">
                <ExternalLink className="h-3.5 w-3.5" />
                {t('PostHog öffnen', 'فتح PostHog')}
              </Button>
            </a>
            <Link href={`/${locale}/admin/analytics`}>
              <Button size="sm" className="gap-2 bg-[#d4a853] hover:bg-[#b8953f] text-white">
                <BarChart3 className="h-3.5 w-3.5" />
                {t('Such-Analytics', 'تحليلات البحث')}
              </Button>
            </Link>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#d4a853]/5 border border-[#d4a853]/10">
            <Info className="h-4 w-4 text-[#d4a853] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-white/35 leading-relaxed">
              {t(
                'PostHog wird NUR geladen wenn der Besucher Analyse-Cookies akzeptiert hat. Ohne Consent: kein Tracking.',
                'يتم تحميل PostHog فقط عندما يوافق الزائر على كوكيز التحليل. بدون موافقة: لا يوجد تتبع.'
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
