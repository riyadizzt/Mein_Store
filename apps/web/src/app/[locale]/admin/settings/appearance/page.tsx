'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { Palette, Image as ImageIcon, Type, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const LANGS = ['de', 'en', 'ar'] as const

export default function AppearancePage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const t3 = (d: string, a: string) => locale === 'ar' ? a : d
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [activeLang, setActiveLang] = useState<'de' | 'en' | 'ar'>('de')

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
    setForm({
      brandName: p?.brandName ?? s?.companyName ?? 'MALAK',
      logoUrl: s?.logoUrl ?? '',
      faviconUrl: '',
      accentColor: '',
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
    })
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/admin/settings', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      queryClient.invalidateQueries({ queryKey: ['shop-settings-public'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const u = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

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
              <Input value={form.logoUrl ?? ''} onChange={(e) => u('logoUrl', e.target.value)} placeholder="https://..." />
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
                <Input value={form.heroBannerCtaLink ?? ''} onChange={(e) => u('heroBannerCtaLink', e.target.value)} placeholder="/products" />
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
