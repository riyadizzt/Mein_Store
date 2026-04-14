'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-modal'
import {
  Megaphone, Plus, Calendar, Copy, Trash2,
  Sparkles, Snowflake, PartyPopper, Sun, Star, Flame,
  Check, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminDatePicker } from '@/components/admin/date-picker'

const t3 = (locale: string, de: string, ar: string) => locale === 'ar' ? ar : de

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-white/10 text-white/60',
  scheduled: 'bg-yellow-500/15 text-yellow-400',
  active: 'bg-green-500/15 text-green-400',
  ended: 'bg-white/5 text-white/30',
}
const STATUS_LABEL: Record<string, Record<string, string>> = {
  draft: { de: 'Entwurf', ar: 'مسودة' },
  scheduled: { de: 'Geplant', ar: 'مجدول' },
  active: { de: 'Aktiv', ar: 'نشط' },
  ended: { de: 'Beendet', ar: 'منتهي' },
}
const TYPE_LABEL: Record<string, Record<string, string>> = {
  sale: { de: 'Sale', ar: 'تخفيض' },
  holiday: { de: 'Feiertag', ar: 'عيد' },
  new_collection: { de: 'Neue Kollektion', ar: 'مجموعة جديدة' },
  seasonal: { de: 'Saisonwechsel', ar: 'موسمي' },
  flash_sale: { de: 'Flash Sale', ar: 'عرض سريع' },
}
const TEMPLATES = [
  { id: 'black_friday', label: { de: 'Black Friday', ar: 'بلاك فرايدي' }, icon: Flame, colors: 'from-black to-[#d4a853]', heroBg: 'linear-gradient(135deg, #000 0%, #1a1a2e 50%, #d4a853 100%)' },
  { id: 'eid', label: { de: 'Eid al-Fitr', ar: 'عيد الفطر' }, icon: Star, colors: 'from-green-900 to-[#d4a853]', heroBg: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #d4a853 100%)' },
  { id: 'ramadan', label: { de: 'Ramadan', ar: 'رمضان' }, icon: Sparkles, colors: 'from-[#1e1b4b] to-[#d4a853]', heroBg: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #d4a853 100%)' },
  { id: 'summer', label: { de: 'Sommer', ar: 'صيف' }, icon: Sun, colors: 'from-orange-100 to-sky-100', heroBg: 'linear-gradient(135deg, #fff7ed 0%, #fef3c7 50%, #e0f2fe 100%)' },
  { id: 'christmas', label: { de: 'Weihnachten', ar: 'عيد الميلاد' }, icon: Snowflake, colors: 'from-red-900 to-green-900', heroBg: 'linear-gradient(135deg, #7f1d1d 0%, #14532d 50%, #d4a853 100%)' },
  { id: 'newyear', label: { de: 'Neujahr', ar: 'رأس السنة' }, icon: PartyPopper, colors: 'from-[#d4a853] to-gray-400', heroBg: 'linear-gradient(135deg, #d4a853 0%, #e8d5b8 50%, #9ca3af 100%)' },
  { id: 'custom', label: { de: 'Eigenes Design', ar: 'تصميم مخصص' }, icon: Sparkles, colors: 'from-[#1a1a2e] to-[#d4a853]', heroBg: '' },
]

export default function CampaignsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['admin-campaigns'],
    queryFn: async () => { const { data } = await api.get('/admin/campaigns'); return data },
    refetchInterval: 30000,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-campaigns'] }),
  })
  const dupMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/campaigns/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-campaigns'] }),
  })

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: t3(locale, 'Kampagne löschen', 'حذف الحملة'),
      description: t3(locale, `"${name}" wirklich löschen?`, `هل تريد حذف "${name}"؟`),
      variant: 'danger',
    })
    if (ok) deleteMut.mutate(id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#d4a853]/15 flex items-center justify-center">
              <Megaphone className="h-5 w-5 text-[#d4a853]" />
            </div>
            {t3(locale, 'Kampagnen', 'الحملات')}
          </h1>
          <p className="text-sm text-white/40 mt-1">{t3(locale, 'Erstelle und verwalte Marketing-Kampagnen', 'إنشاء وإدارة الحملات التسويقية')}</p>
        </div>
        <Button size="sm" className="gap-2 bg-[#d4a853] hover:bg-[#b8953f] text-white" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          {t3(locale, 'Neue Kampagne', 'حملة جديدة')}
        </Button>
      </div>

      {/* Campaign List */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-white/[0.03] rounded-2xl animate-pulse" />)}</div>
      ) : (campaigns ?? []).length === 0 && !creating ? (
        <div className="bg-[#1a1a2e] rounded-2xl border border-white/[0.06] p-12 text-center">
          <Megaphone className="h-12 w-12 text-[#d4a853]/20 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">{t3(locale, 'Keine Kampagnen', 'لا توجد حملات')}</h3>
          <p className="text-sm text-white/30 mb-6">{t3(locale, 'Erstelle deine erste Kampagne — z.B. Black Friday, Eid al-Fitr oder Sommerschlussverkauf', 'أنشئ حملتك الأولى — مثل بلاك فرايدي، عيد الفطر أو تخفيضات الصيف')}</p>
          <Button onClick={() => setCreating(true)} className="gap-2 bg-[#d4a853] hover:bg-[#b8953f] text-white">
            <Plus className="h-4 w-4" />
            {t3(locale, 'Erste Kampagne erstellen', 'إنشاء الحملة الأولى')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(campaigns ?? []).map((c: any) => (
            <div
              key={c.id}
              className={`bg-[#1a1a2e] rounded-2xl border border-white/[0.06] p-5 hover:border-white/[0.1] transition-colors cursor-pointer ${editing === c.id ? 'border-[#d4a853]/30' : ''}`}
              onClick={() => setEditing(editing === c.id ? null : c.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Template color dot */}
                  <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${TEMPLATES.find((t) => t.id === c.template)?.colors ?? 'from-[#1a1a2e] to-[#d4a853]'} flex items-center justify-center`}>
                    {(() => { const T = TEMPLATES.find((t) => t.id === c.template); return T ? <T.icon className="h-5 w-5 text-white" /> : <Megaphone className="h-5 w-5 text-white" /> })()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{c.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[c.status]}`}>
                        {STATUS_LABEL[c.status]?.[locale] ?? c.status}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(c.startAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')} — {new Date(c.endAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')}
                      </span>
                      <span>{TYPE_LABEL[c.type]?.[locale] ?? c.type}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-white/[0.08]" onClick={(e) => { e.stopPropagation(); dupMut.mutate(c.id) }} title={t3(locale, 'Duplizieren', 'نسخ')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 border-red-500/20 text-red-400 hover:bg-red-500/10" onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.name) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Expanded Editor */}
              {editing === c.id && (
                <div className="mt-5 pt-5 border-t border-white/[0.06]" onClick={(e) => e.stopPropagation()}>
                  <CampaignEditor campaign={c} locale={locale} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-campaigns'] }) }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create New Campaign */}
      {creating && (
        <div className="bg-[#1a1a2e] rounded-2xl border border-[#d4a853]/30 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">{t3(locale, 'Neue Kampagne erstellen', 'إنشاء حملة جديدة')}</h3>
          <CampaignEditor locale={locale} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['admin-campaigns'] }) }} onCancel={() => setCreating(false)} />
        </div>
      )}
    </div>
  )
}

/* ── Campaign Editor (Create + Edit) ── */
function CampaignEditor({ campaign, locale, onSaved, onCancel }: {
  campaign?: any; locale: string; onSaved: () => void; onCancel?: () => void
}) {
  const isNew = !campaign
  const [form, setForm] = useState<Record<string, any>>(campaign ?? {
    name: '', type: 'sale', template: 'custom', status: 'draft',
    startAt: '', endAt: '',
    heroBannerEnabled: true, heroTitleDe: '', heroTitleEn: '', heroTitleAr: '',
    heroSubtitleDe: '', heroSubtitleEn: '', heroSubtitleAr: '',
    heroCtaDe: 'Jetzt shoppen', heroCtaEn: 'Shop now', heroCtaAr: 'تسوق الآن',
    heroCtaLink: '/products', heroCountdown: true, heroAnimation: 'none',
    heroBgColor: '',
    announcementEnabled: true, announcementTextDe: '', announcementTextEn: '', announcementTextAr: '',
    announcementBgColor: '#d4a853', announcementTextColor: '#ffffff',
    popupEnabled: false, popupTrigger: 'delay_5s', popupOncePerVisitor: true,
    popupImageUrl: '', popupTextDe: '', popupTextEn: '', popupTextAr: '', popupCouponCode: '',
    saleBadgeEnabled: true, saleBadgeColor: 'red',
  })

  const updateForm = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }))

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form }
      if (form.startAt && typeof form.startAt === 'string' && !form.startAt.includes('T')) {
        payload.startAt = form.startAt + 'T00:00:00.000Z'
      }
      if (form.endAt && typeof form.endAt === 'string' && !form.endAt.includes('T')) {
        payload.endAt = form.endAt + 'T23:59:59.000Z'
      }
      if (isNew) {
        await api.post('/admin/campaigns', payload)
      } else {
        await api.patch(`/admin/campaigns/${campaign.id}`, payload)
      }
    },
    onSuccess: onSaved,
  })

  const applyTemplate = (templateId: string) => {
    const tmpl = TEMPLATES.find((t) => t.id === templateId)
    if (!tmpl) return
    updateForm('template', templateId)
    updateForm('heroBgColor', tmpl.heroBg)
    // Pre-fill texts based on template
    if (templateId === 'black_friday') {
      updateForm('heroTitleDe', 'BLACK FRIDAY'); updateForm('heroTitleAr', 'بلاك فرايدي'); updateForm('heroTitleEn', 'BLACK FRIDAY')
      updateForm('heroSubtitleDe', 'Bis zu 50% Rabatt auf alles'); updateForm('heroSubtitleAr', 'خصم يصل إلى 50% على كل شيء'); updateForm('heroSubtitleEn', 'Up to 50% off everything')
      updateForm('announcementTextDe', '🔥 BLACK FRIDAY — 50% auf alles!'); updateForm('announcementTextAr', '🔥 بلاك فرايدي — 50% على كل شيء!'); updateForm('announcementTextEn', '🔥 BLACK FRIDAY — 50% off everything!')
      updateForm('announcementBgColor', '#000000'); updateForm('heroAnimation', 'glitter')
    } else if (templateId === 'eid') {
      updateForm('heroTitleDe', 'Eid Mubarak'); updateForm('heroTitleAr', 'عيد مبارك'); updateForm('heroTitleEn', 'Eid Mubarak')
      updateForm('heroSubtitleDe', 'Exklusive Eid-Angebote'); updateForm('heroSubtitleAr', 'عروض حصرية للعيد'); updateForm('heroSubtitleEn', 'Exclusive Eid offers')
      updateForm('announcementTextDe', '🌙 Eid Mubarak — Sonderangebote!'); updateForm('announcementTextAr', '🌙 عيد مبارك — عروض خاصة!'); updateForm('announcementTextEn', '🌙 Eid Mubarak — Special offers!')
      updateForm('announcementBgColor', '#065f46'); updateForm('heroAnimation', 'stars')
    } else if (templateId === 'ramadan') {
      updateForm('heroTitleDe', 'Ramadan Kareem'); updateForm('heroTitleAr', 'رمضان كريم'); updateForm('heroTitleEn', 'Ramadan Kareem')
      updateForm('heroSubtitleDe', 'Besondere Ramadan-Kollektion'); updateForm('heroSubtitleAr', 'مجموعة رمضان المميزة'); updateForm('heroSubtitleEn', 'Special Ramadan collection')
      updateForm('announcementBgColor', '#1e1b4b'); updateForm('heroAnimation', 'stars')
    } else if (templateId === 'summer') {
      updateForm('heroTitleDe', 'SUMMER SALE'); updateForm('heroTitleAr', 'تخفيضات الصيف'); updateForm('heroTitleEn', 'SUMMER SALE')
      updateForm('heroSubtitleDe', 'Bis zu 70% Rabatt'); updateForm('heroSubtitleAr', 'خصم يصل إلى 70%'); updateForm('heroSubtitleEn', 'Up to 70% off')
      updateForm('announcementBgColor', '#f59e0b'); updateForm('heroAnimation', 'none')
    }
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Name + Type + Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-white/70 mb-1.5 block">{t3(locale, 'Name', 'الاسم')}</label>
          <Input value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="z.B. Black Friday 2026" className="bg-white/[0.05] border-white/[0.08] text-white" />
        </div>
        <div>
          <label className="text-sm font-medium text-white/70 mb-1.5 block">{t3(locale, 'Typ', 'النوع')}</label>
          <select value={form.type} onChange={(e) => updateForm('type', e.target.value)} className="w-full h-10 px-3 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white text-sm">
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v[locale] ?? v.de}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm font-medium text-white/70 mb-1.5 block">{t3(locale, 'Zeitraum', 'الفترة الزمنية')}</label>
          <div className="grid grid-cols-2 gap-3">
            <AdminDatePicker
              value={form.startAt}
              onChange={(v) => updateForm('startAt', v)}
              placeholder={locale === 'ar' ? 'تاريخ البدء' : 'Startdatum'}
              withTime
            />
            <AdminDatePicker
              value={form.endAt}
              onChange={(v) => updateForm('endAt', v)}
              placeholder={locale === 'ar' ? 'تاريخ الانتهاء' : 'Enddatum'}
              withTime
            />
          </div>
        </div>
      </div>

      {/* Templates */}
      <div>
        <label className="text-sm font-medium text-white/70 mb-2 block">{t3(locale, 'Vorlage wählen', 'اختر قالب')}</label>
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => applyTemplate(tmpl.id)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                form.template === tmpl.id ? 'border-[#d4a853] bg-[#d4a853]/10' : 'border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${tmpl.colors} flex items-center justify-center`}>
                <tmpl.icon className="h-4 w-4 text-white" />
              </div>
              <span className="text-[10px] text-white/50 text-center leading-tight">{tmpl.label[locale as 'de' | 'ar'] ?? tmpl.label.de}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-white/[0.02] rounded-xl p-4 space-y-4">
        <h4 className="text-sm font-semibold text-white/80">{t3(locale, 'Hero Banner', 'البانر الرئيسي')}</h4>

        {/* Image Upload */}
        <div>
          <label className="text-xs text-white/40 mb-1.5 block">{t3(locale, 'Banner-Bild (optional)', 'صورة البانر (اختياري)')}</label>
          {form.heroImageUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-white/[0.06] group">
              <img src={form.heroImageUrl} alt="" className="w-full h-40 object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <button onClick={() => updateForm('heroImageUrl', '')} className="px-4 py-2 rounded-lg bg-red-500/80 text-white text-xs font-medium hover:bg-red-500">{t3(locale, 'Entfernen', 'حذف')}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={form.heroImageUrl ?? ''}
                onChange={(e) => updateForm('heroImageUrl', e.target.value)}
                placeholder="https://..."
                className="bg-white/[0.05] border-white/[0.08] text-white text-sm"
              />
              <p className="text-[10px] text-white/25">
                {t3(locale,
                  '📐 Empfohlene Größe: 1920×800px (Querformat). JPG oder WebP, max. 500KB. Ohne Bild wird der Farbverlauf der Vorlage verwendet.',
                  '📐 الحجم الموصى: 1920×800 بكسل (أفقي). JPG أو WebP، حد أقصى 500 كيلوبايت. بدون صورة سيتم استخدام التدرج اللوني للقالب.'
                )}
              </p>
            </div>
          )}
        </div>

        {/* Texts */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input value={form.heroTitleDe} onChange={(e) => updateForm('heroTitleDe', e.target.value)} placeholder="Titel DE" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
          <Input value={form.heroTitleEn} onChange={(e) => updateForm('heroTitleEn', e.target.value)} placeholder="Title EN" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
          <Input value={form.heroTitleAr} onChange={(e) => updateForm('heroTitleAr', e.target.value)} placeholder="العنوان AR" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" dir="rtl" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input value={form.heroSubtitleDe} onChange={(e) => updateForm('heroSubtitleDe', e.target.value)} placeholder="Untertitel DE" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
          <Input value={form.heroSubtitleEn} onChange={(e) => updateForm('heroSubtitleEn', e.target.value)} placeholder="Subtitle EN" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
          <Input value={form.heroSubtitleAr} onChange={(e) => updateForm('heroSubtitleAr', e.target.value)} placeholder="العنوان الفرعي AR" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" dir="rtl" />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" checked={form.heroCountdown} onChange={(e) => updateForm('heroCountdown', e.target.checked)} className="rounded" />
            {t3(locale, 'Countdown-Timer', 'عداد تنازلي')}
          </label>
          <select value={form.heroAnimation} onChange={(e) => updateForm('heroAnimation', e.target.value)} className="h-8 px-2 rounded bg-white/[0.05] border border-white/[0.08] text-white text-xs">
            <option value="none">{t3(locale, 'Keine Animation', 'بدون رسوم')}</option>
            <option value="confetti">{t3(locale, 'Konfetti', 'قصاصات')}</option>
            <option value="snow">{t3(locale, 'Schnee', 'ثلج')}</option>
            <option value="glitter">{t3(locale, 'Glitzer', 'بريق')}</option>
            <option value="stars">{t3(locale, 'Sterne', 'نجوم')}</option>
          </select>
        </div>
      </div>

      {/* Announcement Bar */}
      <div className="bg-white/[0.02] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white/80">{t3(locale, 'Announcement Bar', 'شريط الإعلانات')}</h4>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={form.announcementEnabled} onChange={(e) => updateForm('announcementEnabled', e.target.checked)} className="rounded" />
            {t3(locale, 'Aktiviert', 'مُفعّل')}
          </label>
        </div>
        {form.announcementEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input value={form.announcementTextDe} onChange={(e) => updateForm('announcementTextDe', e.target.value)} placeholder="Text DE" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
            <Input value={form.announcementTextEn} onChange={(e) => updateForm('announcementTextEn', e.target.value)} placeholder="Text EN" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
            <Input value={form.announcementTextAr} onChange={(e) => updateForm('announcementTextAr', e.target.value)} placeholder="النص AR" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" dir="rtl" />
          </div>
        )}
      </div>

      {/* Popup */}
      <div className="bg-white/[0.02] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white/80">{t3(locale, 'Popup', 'النافذة المنبثقة')}</h4>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={form.popupEnabled} onChange={(e) => updateForm('popupEnabled', e.target.checked)} className="rounded" />
            {t3(locale, 'Aktiviert', 'مُفعّل')}
          </label>
        </div>
        {form.popupEnabled && (
          <div className="space-y-3">
            {/* Image URL */}
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">{t3(locale, 'Bild-URL (optional)', 'رابط الصورة (اختياري)')}</label>
              <Input
                value={form.popupImageUrl ?? ''}
                onChange={(e) => updateForm('popupImageUrl', e.target.value)}
                placeholder="https://..."
                className="bg-white/[0.05] border-white/[0.08] text-white text-sm"
              />
            </div>

            {/* Texts in 3 languages */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input value={form.popupTextDe ?? ''} onChange={(e) => updateForm('popupTextDe', e.target.value)} placeholder="Text DE" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
              <Input value={form.popupTextEn ?? ''} onChange={(e) => updateForm('popupTextEn', e.target.value)} placeholder="Text EN" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" />
              <Input value={form.popupTextAr ?? ''} onChange={(e) => updateForm('popupTextAr', e.target.value)} placeholder="النص AR" className="bg-white/[0.05] border-white/[0.08] text-white text-sm" dir="rtl" />
            </div>

            {/* Coupon Code + Trigger + Once-per-visitor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">{t3(locale, 'Gutschein-Code (optional)', 'رمز القسيمة (اختياري)')}</label>
                <Input
                  value={form.popupCouponCode ?? ''}
                  onChange={(e) => updateForm('popupCouponCode', e.target.value.toUpperCase())}
                  placeholder="z.B. WELCOME10"
                  className="bg-white/[0.05] border-white/[0.08] text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-white/40 mb-1.5 block">{t3(locale, 'Trigger', 'المشغل')}</label>
                <select
                  value={form.popupTrigger}
                  onChange={(e) => updateForm('popupTrigger', e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white text-sm"
                >
                  <option value="immediate">{t3(locale, 'Sofort', 'فوراً')}</option>
                  <option value="delay_5s">{t3(locale, 'Nach 5 Sekunden', 'بعد 5 ثوانٍ')}</option>
                  <option value="delay_10s">{t3(locale, 'Nach 10 Sekunden', 'بعد 10 ثوانٍ')}</option>
                  <option value="exit_intent">{t3(locale, 'Beim Verlassen (Exit Intent)', 'عند الخروج')}</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={form.popupOncePerVisitor}
                onChange={(e) => updateForm('popupOncePerVisitor', e.target.checked)}
                className="rounded"
              />
              {t3(locale, 'Nur einmal pro Besucher anzeigen', 'إظهارها مرة واحدة فقط لكل زائر')}
            </label>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !form.name || !form.startAt || !form.endAt}
          className="gap-2 bg-[#d4a853] hover:bg-[#b8953f] text-white"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {isNew ? t3(locale, 'Kampagne erstellen', 'إنشاء الحملة') : t3(locale, 'Speichern', 'حفظ')}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="border-white/15 text-white/70 hover:bg-white/5">
            {t3(locale, 'Abbrechen', 'إلغاء')}
          </Button>
        )}
        {saveMut.isSuccess && <span className="text-xs text-green-400 flex items-center gap-1"><Check className="h-3.5 w-3.5" />{t3(locale, 'Gespeichert', 'تم الحفظ')}</span>}
        {saveMut.isError && <span className="text-xs text-red-400">{t3(locale, 'Fehler beim Speichern', 'خطأ في الحفظ')}</span>}
      </div>
    </div>
  )
}
