'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Construction, Power, Eye, Mail, Calendar, Type, FileText,
  Link2, Image, Loader2, Check, Download, AlertTriangle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

export default function AdminMaintenancePage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const t = (d: string, a: string) => locale === 'ar' ? a : d

  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState(false)

  // Load settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/settings'); return data },
  })

  // Load stats
  const { data: stats } = useQuery({
    queryKey: ['maintenance-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/maintenance/stats'); return data },
    refetchInterval: 15000,
  })

  // Load collected emails
  const { data: emails } = useQuery({
    queryKey: ['maintenance-emails'],
    queryFn: async () => { const { data } = await api.get('/admin/maintenance/emails'); return data },
  })

  // Sync form
  useEffect(() => {
    if (!settings) return
    setForm({
      maintenance_enabled: settings.maintenance_enabled ?? 'false',
      maintenance_title_de: settings.maintenance_title_de ?? '',
      maintenance_title_ar: settings.maintenance_title_ar ?? '',
      maintenance_desc_de: settings.maintenance_desc_de ?? '',
      maintenance_desc_ar: settings.maintenance_desc_ar ?? '',
      maintenance_countdown_enabled: settings.maintenance_countdown_enabled ?? 'false',
      maintenance_countdown_end: settings.maintenance_countdown_end ?? '',
      maintenance_email_collection: settings.maintenance_email_collection ?? 'true',
      maintenance_social_links: settings.maintenance_social_links ?? 'true',
      maintenance_bg_image: settings.maintenance_bg_image ?? '',
    })
  }, [settings])

  // Save settings
  const saveMut = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      await api.patch('/admin/settings', data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['public-settings-maintenance'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  // Toggle maintenance
  const toggleMut = useMutation({
    mutationFn: async () => {
      const enabling = form.maintenance_enabled !== 'true'
      const payload: Record<string, string> = {
        ...form,
        maintenance_enabled: enabling ? 'true' : 'false',
      }
      if (enabling) {
        payload.maintenance_activated_at = new Date().toISOString()
        payload.maintenance_views = '0'
      }
      await api.patch('/admin/settings', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['public-settings-maintenance'] })
      setConfirmToggle(false)
    },
  })

  const updateField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))
  const isEnabled = form.maintenance_enabled === 'true'

  if (isLoading) {
    return (
      <div>
        <AdminBreadcrumb items={[{ label: t('Wartungsmodus', 'وضع الصيانة') }]} />
        <div className="space-y-6">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-shimmer rounded-xl" />)}</div>
      </div>
    )
  }

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <AdminBreadcrumb items={[{ label: t('Wartungsmodus', 'وضع الصيانة') }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Construction className="h-6 w-6" />
          {t('Wartungsmodus', 'وضع الصيانة')}
        </h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending} className="gap-2">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {saved ? t('Gespeichert', 'تم الحفظ') : t('Speichern', 'حفظ')}
          </Button>
          <Button
            variant={isEnabled ? 'destructive' : 'default'}
            onClick={() => setConfirmToggle(true)}
            className="gap-2"
          >
            <Power className="h-4 w-4" />
            {isEnabled ? t('Deaktivieren', 'إيقاف') : t('Aktivieren', 'تفعيل')}
          </Button>
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirmToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmToggle(false)}>
          <div className="bg-background rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isEnabled ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {isEnabled ? <Power className="h-5 w-5 text-green-500" /> : <AlertTriangle className="h-5 w-5 text-red-500" />}
              </div>
              <div>
                <h3 className="font-semibold">
                  {isEnabled
                    ? t('Wartungsmodus deaktivieren?', 'إيقاف وضع الصيانة؟')
                    : t('Wartungsmodus aktivieren?', 'تفعيل وضع الصيانة؟')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isEnabled
                    ? t('Der Shop wird wieder für alle Kunden zugänglich.', 'سيعود المتجر متاحاً لجميع العملاء.')
                    : t('Kunden werden auf die Wartungsseite umgeleitet. Admins haben weiterhin Zugriff.', 'سيتم تحويل العملاء إلى صفحة الصيانة. المسؤولون لديهم صلاحية الوصول.')}
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setConfirmToggle(false)}>
                {t('Abbrechen', 'إلغاء')}
              </Button>
              <Button
                variant={isEnabled ? 'default' : 'destructive'}
                onClick={() => toggleMut.mutate()}
                disabled={toggleMut.isPending}
                className="gap-2"
              >
                {toggleMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEnabled ? t('Ja, deaktivieren', 'نعم، إيقاف') : t('Ja, aktivieren', 'نعم، تفعيل')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Status Card */}
      <div className={`rounded-xl border p-5 mb-6 ${isEnabled ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${isEnabled ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
            <span className="font-semibold">
              {isEnabled ? t('Wartungsmodus AKTIV', 'وضع الصيانة نشط') : t('Shop ist online', 'المتجر متاح')}
            </span>
          </div>
          {isEnabled && stats && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Eye className="h-4 w-4" /> {stats.views ?? 0} {t('Aufrufe', 'مشاهدة')}</span>
              <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" /> {stats.emails ?? 0} {t('E-Mails', 'بريد')}</span>
              {stats.activeSince && (
                <span className="text-xs text-muted-foreground/60">
                  {t('Seit', 'منذ')} {new Date(stats.activeSince).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Texts */}
          <div className="bg-background border rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Type className="h-5 w-5 text-muted-foreground" />
              {t('Texte', 'النصوص')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t('Titel (Deutsch)', 'العنوان (ألماني)')}</label>
                <Input value={form.maintenance_title_de ?? ''} onChange={(e) => updateField('maintenance_title_de', e.target.value)}
                  placeholder="Wir arbeiten an Verbesserungen" />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t('Titel (Arabisch)', 'العنوان (عربي)')}</label>
                <Input value={form.maintenance_title_ar ?? ''} onChange={(e) => updateField('maintenance_title_ar', e.target.value)}
                  placeholder="نعمل على تحسينات" dir="rtl" />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t('Beschreibung (Deutsch)', 'الوصف (ألماني)')}</label>
                <Input value={form.maintenance_desc_de ?? ''} onChange={(e) => updateField('maintenance_desc_de', e.target.value)}
                  placeholder="Unser Shop wird gerade aktualisiert." />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t('Beschreibung (Arabisch)', 'الوصف (عربي)')}</label>
                <Input value={form.maintenance_desc_ar ?? ''} onChange={(e) => updateField('maintenance_desc_ar', e.target.value)}
                  placeholder="متجرنا قيد التحديث. سنعود قريباً!" dir="rtl" />
              </div>
            </div>
          </div>

          {/* Background Image */}
          <div className="bg-background border rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Image className="h-5 w-5 text-muted-foreground" />
              {t('Hintergrundbild', 'صورة الخلفية')}
            </h2>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t('Bild-URL (optional)', 'رابط الصورة (اختياري)')}</label>
              <Input value={form.maintenance_bg_image ?? ''} onChange={(e) => updateField('maintenance_bg_image', e.target.value)}
                placeholder="https://..." />
              <p className="text-xs text-muted-foreground mt-1.5">
                {t('Leer lassen für den Standard-Gradient (dunkel + Gold-Akzente)', 'اتركه فارغاً للتدرج الافتراضي (داكن + ذهبي)')}
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="bg-background border rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-muted-foreground" />
              {t('Funktionen', 'الميزات')}
            </h2>
            <div className="space-y-3">
              {/* Countdown */}
              <ToggleRow
                label={t('Countdown anzeigen', 'عرض العد التنازلي')}
                enabled={form.maintenance_countdown_enabled === 'true'}
                onToggle={() => updateField('maintenance_countdown_enabled', form.maintenance_countdown_enabled === 'true' ? 'false' : 'true')}
              />
              {form.maintenance_countdown_enabled === 'true' && (
                <div className="ltr:pl-6 rtl:pr-6">
                  <label className="text-sm font-medium text-muted-foreground mb-3 block flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {t('Countdown-Enddatum', 'تاريخ نهاية العد التنازلي')}
                  </label>
                  <DateTimePicker
                    value={form.maintenance_countdown_end ?? ''}
                    onChange={(v) => updateField('maintenance_countdown_end', v)}
                    locale={locale}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('Wartungsmodus wird automatisch deaktiviert wenn der Countdown abläuft', 'سيتم إيقاف وضع الصيانة تلقائياً عند انتهاء العد التنازلي')}
                  </p>
                </div>
              )}

              {/* Email Collection */}
              <ToggleRow
                label={t('E-Mail-Sammlung anzeigen', 'عرض جمع البريد الإلكتروني')}
                enabled={form.maintenance_email_collection !== 'false'}
                onToggle={() => updateField('maintenance_email_collection', form.maintenance_email_collection === 'false' ? 'true' : 'false')}
              />

              {/* Social Links */}
              <ToggleRow
                label={t('Social-Media-Links anzeigen', 'عرض روابط التواصل الاجتماعي')}
                enabled={form.maintenance_social_links !== 'false'}
                onToggle={() => updateField('maintenance_social_links', form.maintenance_social_links === 'false' ? 'true' : 'false')}
              />
            </div>
          </div>

          {/* Preview Link */}
          <div className="bg-background border rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Link2 className="h-5 w-5 text-muted-foreground" />
              {t('Vorschau', 'معاينة')}
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              {t('Als Admin kannst du die Wartungsseite direkt aufrufen:', 'كمسؤول يمكنك زيارة صفحة الصيانة مباشرة:')}
            </p>
            <a href={`/${locale}/maintenance`} target="_blank" rel="noopener noreferrer"
              className="text-sm text-[#d4a853] hover:underline">
              /{locale}/maintenance
            </a>
          </div>
        </div>

        {/* Right: Collected Emails */}
        <div className="space-y-6">
          {/* Email List */}
          <div className="bg-background border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                {t('Gesammelte E-Mails', 'البريد الإلكتروني المجمع')}
              </h2>
              {emails?.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                  onClick={() => {
                    const csv = 'Email,Locale,Date\n' + (emails ?? []).map((e: any) =>
                      `${e.email},${e.locale},${new Date(e.createdAt).toISOString()}`
                    ).join('\n')
                    const blob = new Blob([csv], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `maintenance-emails-${new Date().toISOString().slice(0, 10)}.csv`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}>
                  <Download className="h-3 w-3" />
                  CSV
                </Button>
              )}
            </div>

            {!emails || emails.length === 0 ? (
              <div className="text-center py-8">
                <Mail className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">
                  {t('Noch keine E-Mails gesammelt', 'لم يتم جمع أي بريد إلكتروني بعد')}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {(emails ?? []).map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 text-sm group">
                    <div className="min-w-0">
                      <span className="truncate block">{e.email}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {e.locale?.toUpperCase()} · {new Date(e.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t text-center">
              <span className="text-xs text-muted-foreground">
                {(emails?.length ?? 0)} {t('E-Mails insgesamt', 'بريد إلكتروني إجمالاً')}
              </span>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-background border rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">{t('Statistiken', 'الإحصائيات')}</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Seitenaufrufe', 'مشاهدات الصفحة')}</span>
                <span className="font-semibold">{stats?.views ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('E-Mail-Anmeldungen', 'اشتراكات البريد')}</span>
                <span className="font-semibold">{stats?.emails ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('Konversionsrate', 'معدل التحويل')}</span>
                <span className="font-semibold">
                  {stats?.views > 0 ? ((stats.emails / stats.views) * 100).toFixed(1) : '0'}%
                </span>
              </div>
              {stats?.activeSince && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t('Aktiv seit', 'نشط منذ')}</span>
                  <span className="text-sm">
                    {new Date(stats.activeSince).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <button onClick={onToggle} className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-muted'}`}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform left-0.5"
          style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

function DateTimePicker({ value, onChange, locale }: { value: string; onChange: (v: string) => void; locale: string }) {
  const t = (d: string, a: string) => locale === 'ar' ? a : d

  // Parse value into date and time
  const parsed = value ? new Date(value) : null
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsed && !isNaN(parsed.getTime()) ? parsed : null)
  const [hour, setHour] = useState(parsed ? String(parsed.getHours()).padStart(2, '0') : '12')
  const [minute, setMinute] = useState(parsed ? String(parsed.getMinutes()).padStart(2, '0') : '00')
  const [viewDate, setViewDate] = useState(parsed && !isNaN(parsed.getTime()) ? new Date(parsed.getFullYear(), parsed.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1))

  const emitChange = (date: Date | null, h: string, m: string) => {
    if (!date) return
    const d = new Date(date)
    d.setHours(parseInt(h) || 0, parseInt(m) || 0, 0, 0)
    // Format as datetime-local value
    const pad = (n: number) => String(n).padStart(2, '0')
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }

  const handleDateClick = (day: number) => {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
    setSelectedDate(d)
    emitChange(d, hour, minute)
  }

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))

  // Calendar grid
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = (firstDay + 6) % 7 // Monday = 0

  const today = new Date()
  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate()
  const isSelected = (day: number) => selectedDate && year === selectedDate.getFullYear() && month === selectedDate.getMonth() && day === selectedDate.getDate()

  const monthNames = locale === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

  const dayNames = locale === 'ar'
    ? ['اث', 'ث', 'أر', 'خ', 'ج', 'س', 'أح']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

  return (
    <div className="border rounded-xl overflow-hidden bg-background">
      {/* Calendar Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
        <button onClick={prevMonth} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors">
          <span className={locale === 'ar' ? 'rotate-180' : ''}>&#8249;</span>
        </button>
        <span className="text-sm font-semibold">{monthNames[month]} {year}</span>
        <button onClick={nextMonth} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors">
          <span className={locale === 'ar' ? 'rotate-180' : ''}>&#8250;</span>
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 px-3 pt-2">
        {dayNames.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Day Grid */}
      <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
        {Array.from({ length: startOffset }).map((_, i) => <div key={`empty-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const sel = isSelected(day)
          const tod = isToday(day)
          const past = new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
          return (
            <button
              key={day}
              onClick={() => !past && handleDateClick(day)}
              disabled={past}
              className={`h-8 w-8 mx-auto rounded-lg text-xs font-medium transition-all
                ${sel ? 'bg-[#d4a853] text-white shadow-md' : ''}
                ${tod && !sel ? 'ring-1 ring-[#d4a853] text-[#d4a853] font-bold' : ''}
                ${past ? 'text-muted-foreground/30 cursor-not-allowed' : ''}
                ${!sel && !tod && !past ? 'hover:bg-muted' : ''}
              `}
            >
              {day}
            </button>
          )
        })}
      </div>

      {/* Time Picker */}
      <div className="border-t px-4 py-3 flex items-center justify-between bg-muted/20">
        <span className="text-xs font-medium text-muted-foreground">{t('Uhrzeit', 'الوقت')}</span>
        <div className="flex items-center gap-1.5" dir="ltr">
          <select value={hour} onChange={(e) => { setHour(e.target.value); emitChange(selectedDate, e.target.value, minute) }}
            className="h-8 w-14 rounded-lg border bg-background text-center text-sm font-mono appearance-none cursor-pointer hover:border-[#d4a853] transition-colors">
            {Array.from({ length: 24 }).map((_, i) => (
              <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
            ))}
          </select>
          <span className="text-lg font-bold text-muted-foreground">:</span>
          <select value={minute} onChange={(e) => { setMinute(e.target.value); emitChange(selectedDate, hour, e.target.value) }}
            className="h-8 w-14 rounded-lg border bg-background text-center text-sm font-mono appearance-none cursor-pointer hover:border-[#d4a853] transition-colors">
            {['00', '15', '30', '45'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected Preview */}
      {selectedDate && (
        <div className="border-t px-4 py-2 bg-[#d4a853]/5 text-center">
          <span className="text-xs font-medium text-[#d4a853]">
            {selectedDate.toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' '}{t('um', 'الساعة')} {hour}:{minute}
          </span>
        </div>
      )}
    </div>
  )
}
