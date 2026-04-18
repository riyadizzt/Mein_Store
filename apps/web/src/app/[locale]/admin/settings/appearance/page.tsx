'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { Palette, Image as ImageIcon, Type, Check, Loader2, LayoutGrid, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { toast } from '@/store/toast-store'

const LANGS = ['de', 'en', 'ar'] as const

export default function AppearancePage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const t3 = (d: string, a: string) => locale === 'ar' ? a : d
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [activeLang, setActiveLang] = useState<'de' | 'en' | 'ar'>('de')

  // Dirty-tracking: only keys the user actually edited get sent on save.
  // Without this, a full-form PATCH can overwrite untouched keys with
  // whatever the form currently holds — including empty strings from a
  // partial re-populate — silently wiping saved values (incident 17.04.2026,
  // Social-URL data loss).
  const dirtyRef = useRef<Set<string>>(new Set())

  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const { data } = await api.get('/admin/settings')
      // Also get all raw settings for hero banner fields
      const rows = await api.get('/settings/public')
      return { admin: data, public: rows.data }
    },
  })

  useEffect(() => {
    if (!settings) return
    const s = settings.admin
    const p = settings.public
    const fresh: Record<string, string> = {
      brandName: p?.brandName ?? s?.companyName ?? 'MALAK',
      logoUrl: s?.logoUrl ?? '',
      heroBannerImage: p?.heroBanner?.image ?? '',
      heroBannerTitle_de: p?.heroBanner?.title?.de ?? '',
      heroBannerTitle_en: p?.heroBanner?.title?.en ?? '',
      heroBannerTitle_ar: p?.heroBanner?.title?.ar ?? '',
      heroBannerSubtitle_de: p?.heroBanner?.subtitle?.de ?? '',
      heroBannerSubtitle_en: p?.heroBanner?.subtitle?.en ?? '',
      heroBannerSubtitle_ar: p?.heroBanner?.subtitle?.ar ?? '',
      heroBannerCta_de: p?.heroBanner?.cta?.de ?? '',
      heroBannerCta_en: p?.heroBanner?.cta?.en ?? '',
      heroBannerCta_ar: p?.heroBanner?.cta?.ar ?? '',
      heroBannerCtaLink: p?.heroBanner?.ctaLink ?? '/products',
      instagramUrl: p?.social?.instagram ?? '',
      facebookUrl: p?.social?.facebook ?? '',
      tiktokUrl: p?.social?.tiktok ?? '',
      homepage_design: p?.homepage_design ?? 'A',
    }
    // Preserve any in-progress user edits when settings refetches (window
    // focus, invalidate, etc.) — otherwise a background refresh would reset
    // the user's typing.
    setForm((prev) => {
      if (dirtyRef.current.size === 0) return fresh
      const merged = { ...fresh }
      for (const k of dirtyRef.current) {
        if (k in prev) merged[k] = prev[k]
      }
      return merged
    })
  }, [settings])

  const saveMutation = useMutation({
    // Build a PARTIAL payload from the dirty set. Sending the whole form
    // would overwrite fields the user didn't touch with whatever value the
    // form state happens to hold — which can be empty after a background
    // refetch or stale state. Dirty-tracking is the cheapest, safest guard.
    mutationFn: async () => {
      if (dirtyRef.current.size === 0) return { noop: true as const }
      const payload: Record<string, string> = {}
      for (const k of dirtyRef.current) payload[k] = form[k] ?? ''
      await api.patch('/admin/settings', payload)
      return { noop: false as const }
    },
    onSuccess: (result) => {
      if (result?.noop) {
        toast.success(t3('Keine Änderungen zu speichern', 'لا توجد تغييرات للحفظ'))
        return
      }
      // Clear dirty set BEFORE invalidate so the refetch doesn't skip
      // re-populating those keys in the useEffect merge path.
      dirtyRef.current.clear()
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      queryClient.invalidateQueries({ queryKey: ['shop-settings-public'] })
      setSaved(true)
      toast.success(t3('Erscheinung gespeichert', 'تم حفظ المظهر'))
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: any) => {
      // On failure, keep the dirty set so a retry still sends the changes.
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        t3('Speichern fehlgeschlagen', 'فشل الحفظ')
      toast.error(typeof msg === 'string' ? msg : t3('Speichern fehlgeschlagen', 'فشل الحفظ'))
    },
  })

  const u = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }))
    dirtyRef.current.add(key)
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('settings.title'), href: `/${locale}/admin/settings` }, { label: t3('Erscheinung', 'المظهر') }]} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Palette className="h-6 w-6" />{t3('Shop-Erscheinung', 'مظهر المتجر')}</h1>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? t3('Gespeichert ✓', 'تم الحفظ ✓') : t3('Speichern', 'حفظ')}
        </Button>
      </div>

      <div className="space-y-6">
        {/* Homepage Design Selector */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
            <LayoutGrid className="h-5 w-5" />
            {t3('Homepage-Design', 'تصميم الصفحة الرئيسية')}
          </h2>
          <p className="text-xs text-muted-foreground mb-5">
            {t3(
              'Wähle den Stil der Startseite. Änderungen sind sofort live.',
              'اختر تصميم الصفحة الرئيسية. التغييرات تُطبَّق فوراً.',
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                key: 'A',
                title: t3('Editorial Premium', 'فاخر تحريري'),
                desc: t3('Großzügig, asymmetrisch, viel Atemraum. Wie Zalando/COS.', 'فسيح، غير متناسق، يوحي بالأناقة. مثل Zalando/COS.'),
                gradient: 'from-amber-50 via-white to-amber-50',
                accent: '#d4a853',
              },
              {
                key: 'B',
                title: t3('Minimal High-End', 'بسيط راقٍ'),
                desc: t3('95% Weiß, kein Hero, sehr viel Weißraum. Wie Arket/Jil Sander.', '95% أبيض، بدون بانر، فراغ كبير. مثل Arket.'),
                gradient: 'from-white via-gray-50 to-white',
                accent: '#0f1419',
              },
              {
                key: 'C',
                title: t3('Dark Luxury', 'فخامة داكنة'),
                desc: t3('Komplett dark, Gold-Akzente. Wie Saint Laurent/Rains.', 'داكن بالكامل مع لمسات ذهبية. مثل Saint Laurent.'),
                gradient: 'from-[#0a0a14] via-[#1a1a2e] to-[#0a0a14]',
                accent: '#d4a853',
                dark: true,
              },
            ].map((opt) => {
              const selected = (form.homepage_design ?? 'A') === opt.key
              const previewUrl = `/${locale}/?preview=${opt.key}`
              return (
                <div
                  key={opt.key}
                  className={`relative rounded-xl border-2 p-4 transition-all ${
                    selected
                      ? 'border-[#d4a853] shadow-md'
                      : 'border-border hover:border-[#d4a853]/40'
                  }`}
                >
                  {/* Clickable area to select */}
                  <button
                    type="button"
                    onClick={() => u('homepage_design', opt.key)}
                    className="block w-full text-start"
                  >
                    {/* Mini preview */}
                    <div
                      className={`h-20 rounded-lg mb-3 bg-gradient-to-br ${opt.gradient} relative overflow-hidden border ${
                        opt.dark ? 'border-white/10' : 'border-black/5'
                      }`}
                    >
                      <div className="absolute inset-0 flex flex-col justify-end p-2 gap-1">
                        <div
                          className="h-1.5 w-2/3 rounded"
                          style={{ background: opt.accent, opacity: opt.dark ? 1 : 0.85 }}
                        />
                        <div
                          className="h-1 w-1/3 rounded"
                          style={{ background: opt.dark ? 'rgba(255,255,255,0.5)' : 'rgba(15,20,25,0.4)' }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono font-bold text-[#d4a853]">{opt.key}</span>
                      {selected && (
                        <div className="h-5 w-5 rounded-full bg-[#d4a853] flex items-center justify-center">
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <h3 className="text-sm font-bold mb-1">{opt.title}</h3>
                    <p className="text-[11px] text-muted-foreground leading-snug mb-3">{opt.desc}</p>
                  </button>

                  {/* Preview link — opens in new tab without saving */}
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#d4a853] hover:text-[#c49943] transition-colors mt-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t3('Live-Vorschau', 'معاينة مباشرة')}
                  </a>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 italic">
            {t3(
              'Standard: A. Alle Shop-Funktionen (Warenkorb, Suche, Kategorien, Bestseller, Kampagnen) funktionieren in jedem Design.',
              'الافتراضي: A. جميع وظائف المتجر (السلة، البحث، الفئات، الأكثر مبيعاً، الحملات) تعمل في كل تصميم.',
            )}
          </p>
        </div>

        {/* Brand */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4"><Type className="h-5 w-5" />{t3('Marke', 'العلامة التجارية')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('Markenname (Header)', 'اسم العلامة التجارية')}</label>
              <Input value={form.brandName ?? ''} onChange={(e) => u('brandName', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('Logo URL', 'رابط الشعار')}</label>
              <Input value={form.logoUrl ?? ''} onChange={(e) => u('logoUrl', e.target.value)} placeholder="https://..." dir="ltr" />
              {form.logoUrl && (
                <div className="mt-2 inline-flex items-center justify-center h-16 w-16 rounded-lg overflow-hidden bg-muted border">
                  <img
                    src={form.logoUrl}
                    alt="Logo preview"
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Hero Banner */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4"><ImageIcon className="h-5 w-5" />{t3('Hero-Banner', 'البانر الرئيسي')}</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('Bild-URL', 'رابط الصورة')}</label>
              <Input value={form.heroBannerImage ?? ''} onChange={(e) => u('heroBannerImage', e.target.value)} placeholder="https://images.unsplash.com/..." />
              {form.heroBannerImage && (
                <div className="mt-2 h-32 rounded-lg overflow-hidden bg-muted">
                  <img src={form.heroBannerImage} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>

            {/* Language tabs for texts */}
            <div className="flex gap-2 border-b pb-2">
              {LANGS.map((lang) => (
                <button key={lang} onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${activeLang === lang ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('Überschrift', 'العنوان')} ({activeLang.toUpperCase()})</label>
                <Input value={form[`heroBannerTitle_${activeLang}`] ?? ''} onChange={(e) => u(`heroBannerTitle_${activeLang}`, e.target.value)}
                  dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('Untertitel', 'العنوان الفرعي')} ({activeLang.toUpperCase()})</label>
                <Input value={form[`heroBannerSubtitle_${activeLang}`] ?? ''} onChange={(e) => u(`heroBannerSubtitle_${activeLang}`, e.target.value)}
                  dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('CTA-Button', 'زر الإجراء')} ({activeLang.toUpperCase()})</label>
                <Input value={form[`heroBannerCta_${activeLang}`] ?? ''} onChange={(e) => u(`heroBannerCta_${activeLang}`, e.target.value)}
                  dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3('CTA-Link', 'رابط الزر')}</label>
                <Input value={form.heroBannerCtaLink ?? ''} onChange={(e) => u('heroBannerCtaLink', e.target.value)} placeholder="/products" dir="ltr" />
              </div>
            </div>
          </div>
        </div>

        {/* Social Media */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">{t3('Social Media', 'وسائل التواصل الاجتماعي')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Instagram</label>
              <Input value={form.instagramUrl ?? ''} onChange={(e) => u('instagramUrl', e.target.value)} placeholder="https://instagram.com/..." />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Facebook</label>
              <Input value={form.facebookUrl ?? ''} onChange={(e) => u('facebookUrl', e.target.value)} placeholder="https://facebook.com/..." />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">TikTok</label>
              <Input value={form.tiktokUrl ?? ''} onChange={(e) => u('tiktokUrl', e.target.value)} placeholder="https://tiktok.com/@..." />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
