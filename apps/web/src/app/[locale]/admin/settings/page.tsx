'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { Settings, CreditCard, Mail, Building2, Check, Loader2, Gift, Bell, Shield, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { toast } from '@/store/toast-store'

type Tab = 'company' | 'payments' | 'marketing' | 'notifications' | 'email'

export default function AdminSettingsPage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('company')

  // Dirty-tracking: only keys the user actually edited get sent on save.
  // Without this, a full-form PATCH can overwrite untouched keys with
  // whatever the form currently holds — including empty strings from a
  // partial re-populate — silently wiping saved values (incident 17.04.2026).
  const dirtyRef = useRef<Set<string>>(new Set())
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/settings'); return data },
  })

  // Sync form with loaded settings
  useEffect(() => {
    if (!settings) return
    const fresh: Record<string, string> = {
      companyName: settings.companyName ?? '',
      companyAddress: settings.companyAddress ?? '',
      companyVatId: settings.companyVatId ?? '',
      companyCeo: settings.companyCeo ?? '',
      companyPhone: settings.companyPhone ?? '',
      companyEmail: settings.companyEmail ?? '',
      logoUrl: settings.logoUrl ?? '',
      freeShippingThreshold: settings.freeShippingThreshold ?? '100',
      stripeEnabled: String(settings.stripeEnabled ?? false),
      klarnaEnabled: String(settings.klarnaEnabled ?? false),
      paypalEnabled: String(settings.paypalEnabled ?? false),
      welcomePopupEnabled: String(settings.welcomePopupEnabled ?? 'true'),
      welcomeDiscountPercent: String(settings.welcomeDiscountPercent ?? '10'),
      notif_email_new_order: String(settings.notif_email_new_order ?? 'true'),
      notif_email_low_stock: String(settings.notif_email_low_stock ?? 'true'),
      notif_sound_enabled: String(settings.notif_sound_enabled ?? 'true'),
      notif_daily_summary: String(settings.notif_daily_summary ?? 'false'),
      notif_daily_summary_email: String(settings.notif_daily_summary_email ?? ''),
      notif_email_auto_cancel: String(settings.notif_email_auto_cancel ?? 'true'),
      returnsEnabled: String(settings.returnsEnabled ?? 'true'),
      addressAutocompleteEnabled: String(settings.addressAutocompleteEnabled ?? 'false'),
      vorkasse_enabled: String(settings.vorkasse_enabled ?? 'false'),
      vorkasse_account_holder: String(settings.vorkasse_account_holder ?? ''),
      vorkasse_iban: String(settings.vorkasse_iban ?? ''),
      vorkasse_bic: String(settings.vorkasse_bic ?? ''),
      vorkasse_bank_name: String(settings.vorkasse_bank_name ?? ''),
      vorkasse_deadline_days: String(settings.vorkasse_deadline_days ?? '7'),
      sumup_enabled: String(settings.sumup_enabled ?? 'false'),
      sumup_merchant_code: String(settings.sumup_merchant_code ?? ''),
      whatsapp_ai_enabled: String(settings.whatsapp_ai_enabled ?? 'false'),
    }
    // Preserve in-progress user edits across background refetches.
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
    // Only PATCH fields the user actually edited. Prevents silent
    // overwrites of untouched keys (see dirtyRef note above).
    mutationFn: async () => {
      if (dirtyRef.current.size === 0) return { noop: true as const }
      const payload: Record<string, string> = {}
      for (const k of dirtyRef.current) payload[k] = form[k] ?? ''
      await api.patch('/admin/settings', payload)
      return { noop: false as const }
    },
    onSuccess: (result) => {
      if (result?.noop) {
        toast.success(t3('Keine Änderungen zu speichern', 'No changes to save', 'لا توجد تغييرات للحفظ'))
        return
      }
      // Clear dirty BEFORE invalidate so the refetch re-populates cleanly.
      dirtyRef.current.clear()
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      setSaved(true)
      toast.success(t3('Einstellungen gespeichert', 'Settings saved', 'تم حفظ الإعدادات'))
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: any) => {
      // Keep dirty set so a retry still sends the changes.
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        t3('Speichern fehlgeschlagen', 'Save failed', 'فشل الحفظ')
      toast.error(typeof msg === 'string' ? msg : t3('Speichern fehlgeschlagen', 'Save failed', 'فشل الحفظ'))
    },
  })

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    dirtyRef.current.add(key)
  }
  const toggleField = (key: string) => {
    setForm((prev) => ({ ...prev, [key]: prev[key] === 'true' ? 'false' : 'true' }))
    dirtyRef.current.add(key)
  }

  if (isLoading) {
    return (
      <div>
        <AdminBreadcrumb items={[{ label: t('settings.title') }]} />
        <div className="space-y-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-shimmer rounded-xl" />)}</div>
      </div>
    )
  }

  const TABS: { key: Tab; icon: typeof Building2; label: string }[] = [
    { key: 'company', icon: Building2, label: t3('Firmendaten', 'Company', 'بيانات الشركة') },
    { key: 'payments', icon: CreditCard, label: t3('Zahlungen', 'Payments', 'طرق الدفع') },
    { key: 'marketing', icon: Gift, label: 'Marketing' },
    { key: 'notifications', icon: Bell, label: t3('Benachrichtigungen', 'Notifications', 'الإشعارات') },
    { key: 'email', icon: Mail, label: t3('E-Mail', 'Email', 'البريد') },
  ]

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('settings.title') }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-[#d4a853]" />
          </div>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white px-6 h-11 rounded-xl font-semibold shadow-sm">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? t('settings.saved') : t('settings.save')}
        </Button>
      </div>

      {saveMutation.isError && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
          {t3('Fehler beim Speichern', 'Error saving settings', 'خطأ في الحفظ')}
        </div>
      )}

      {/* Tracking Link */}
      <Link
        href={`/${locale}/admin/settings/tracking`}
        className="flex items-center gap-4 p-4 bg-gradient-to-r from-[#1a1a2e] to-[#1a1a2e]/90 border border-white/10 rounded-2xl hover:border-[#d4a853]/30 transition-all group mb-8"
      >
        <div className="h-11 w-11 rounded-xl bg-[#d4a853]/10 flex items-center justify-center group-hover:bg-[#d4a853]/20 transition-colors">
          <Shield className="h-5 w-5 text-[#d4a853]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">{t3('Tracking & Datenschutz', 'Tracking & Privacy', 'التتبع والخصوصية')}</p>
          <p className="text-xs text-white/40 mt-0.5">{t3('PostHog Analytics, Cookie-Banner, Marketing-Pixel', 'PostHog Analytics, Cookie Banner, Marketing Pixels', 'PostHog Analytics، بانر الكوكيز، بكسل التسويق')}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-white/20 group-hover:text-[#d4a853] transition-colors rtl:rotate-180" />
      </Link>

      {/* Tabs + Content */}
      <div className="flex gap-6">
        {/* Tab Navigation — Vertical */}
        <div className="w-56 flex-shrink-0 hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            {TABS.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-start ${
                  activeTab === key
                    ? 'bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20 shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Mobile Tab Bar */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t px-2 py-2 flex gap-1 overflow-x-auto">
          {TABS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === key ? 'bg-[#d4a853]/10 text-[#d4a853]' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Company */}
          {activeTab === 'company' && (
            <SettingsCard icon={Building2} title={t3('Firmendaten', 'Company Info', 'بيانات الشركة')}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label={t('settings.storeName')} value={form.companyName} onChange={(v) => updateField('companyName', v)} />
                <Field label={t3('E-Mail', 'Email', 'البريد')} value={form.companyEmail} onChange={(v) => updateField('companyEmail', v)} type="email" />
                <Field label={t3('Telefon', 'Phone', 'الهاتف')} value={form.companyPhone} onChange={(v) => updateField('companyPhone', v)} dir="ltr" />
                <Field label={t3('Adresse', 'Address', 'العنوان')} value={form.companyAddress} onChange={(v) => updateField('companyAddress', v)} />
                <Field label={t3('USt-IdNr.', 'VAT ID', 'الرقم الضريبي')} value={form.companyVatId} onChange={(v) => updateField('companyVatId', v)} dir="ltr" />
                <Field label={t3('Geschäftsführer', 'CEO', 'المدير العام')} value={form.companyCeo} onChange={(v) => updateField('companyCeo', v)} />
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">DHL API</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${settings?.dhlConfigured ? 'bg-green-500/15 text-green-600 ring-1 ring-green-500/20' : 'bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/20'}`}>
                    {settings?.dhlConfigured ? t3('Konfiguriert', 'Configured', 'مُفعّل') : t3('Manueller Modus', 'Manual Mode', 'وضع يدوي')}
                  </span>
                </div>
              </div>
            </SettingsCard>
          )}

          {/* Payments */}
          {activeTab === 'payments' && (
            <div className="space-y-6">
              <SettingsCard icon={CreditCard} title={t3('Zahlungsmethoden', 'Payment Methods', 'طرق الدفع')}>
                <div className="space-y-1">
                  <Toggle label="Stripe (Kreditkarte, Apple Pay, Google Pay)" enabled={form.stripeEnabled === 'true'} onToggle={() => toggleField('stripeEnabled')} />
                  <Toggle label="Klarna (Rechnung, Ratenzahlung)" enabled={form.klarnaEnabled === 'true'} onToggle={() => toggleField('klarnaEnabled')} />
                  <Toggle label="PayPal" enabled={form.paypalEnabled === 'true'} onToggle={() => toggleField('paypalEnabled')} />
                  <Toggle label={t3('Vorkasse (Banküberweisung)', 'Bank Transfer', 'الدفع المسبق (تحويل بنكي)')} enabled={form.vorkasse_enabled === 'true'} onToggle={() => updateField('vorkasse_enabled', form.vorkasse_enabled === 'true' ? 'false' : 'true')} />
                  <Toggle label={t3('SumUp (Kartenzahlung)', 'SumUp (Card Payment)', 'SumUp (بطاقة ائتمان)')} enabled={form.sumup_enabled === 'true'} onToggle={() => updateField('sumup_enabled', form.sumup_enabled === 'true' ? 'false' : 'true')} />
                </div>
              </SettingsCard>

              {form.vorkasse_enabled === 'true' && (
                <SettingsCard icon={Building2} title={t3('Bankverbindung', 'Bank Details', 'بيانات بنكية')} accent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label={t3('Kontoinhaber', 'Account Holder', 'صاحب الحساب')} value={form.vorkasse_account_holder} onChange={(v) => updateField('vorkasse_account_holder', v)} />
                    <Field label="IBAN" value={form.vorkasse_iban} onChange={(v) => updateField('vorkasse_iban', v)} dir="ltr" />
                    <Field label="BIC / SWIFT" value={form.vorkasse_bic} onChange={(v) => updateField('vorkasse_bic', v)} dir="ltr" />
                    <Field label={t3('Bankname', 'Bank Name', 'اسم البنك')} value={form.vorkasse_bank_name} onChange={(v) => updateField('vorkasse_bank_name', v)} />
                    <Field label={t3('Zahlungsfrist (Tage)', 'Payment Deadline (Days)', 'مهلة الدفع (أيام)')} value={form.vorkasse_deadline_days} onChange={(v) => updateField('vorkasse_deadline_days', v)} type="number" />
                  </div>
                </SettingsCard>
              )}

              {form.sumup_enabled === 'true' && (
                <SettingsCard icon={CreditCard} title="SumUp" accent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Merchant Code" value={form.sumup_merchant_code} onChange={(v) => updateField('sumup_merchant_code', v)} dir="ltr" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{t3('API Key wird in .env gesetzt (SUMUP_API_KEY)', 'API Key is set in .env (SUMUP_API_KEY)', 'مفتاح API يُضاف في ملف .env (SUMUP_API_KEY)')}</p>
                </SettingsCard>
              )}
            </div>
          )}

          {/* Marketing */}
          {activeTab === 'marketing' && (
            <SettingsCard icon={Gift} title="Marketing">
              <div className="space-y-1">
                <Toggle label={t3('Willkommens-Popup (Rabatt für Newsletter)', 'Welcome Popup (Newsletter Discount)', 'نافذة الترحيب (خصم للمشتركين)')} enabled={form.welcomePopupEnabled !== 'false'} onToggle={() => updateField('welcomePopupEnabled', form.welcomePopupEnabled === 'false' ? 'true' : 'false')} />
                {form.welcomePopupEnabled !== 'false' && (
                  <div className="ltr:pl-6 rtl:pr-6 pb-2">
                    <Field label={t3('Willkommensrabatt (%)', 'Welcome Discount (%)', 'نسبة خصم الترحيب (%)')} value={form.welcomeDiscountPercent || '10'} onChange={(v) => updateField('welcomeDiscountPercent', v)} type="number" />
                  </div>
                )}
                <Toggle label={t3('Retouren-System', 'Returns System', 'نظام الإرجاع')} enabled={form.returnsEnabled !== 'false'} onToggle={() => updateField('returnsEnabled', form.returnsEnabled === 'false' ? 'true' : 'false')} />
                <Toggle label={t3('Adress-Autovervollständigung', 'Address Autocomplete', 'الإكمال التلقائي للعناوين')} enabled={form.addressAutocompleteEnabled === 'true'} onToggle={() => updateField('addressAutocompleteEnabled', form.addressAutocompleteEnabled === 'true' ? 'false' : 'true')} />
                <Toggle label={t3('WhatsApp KI-Chat (Kunden-Anfragen automatisch beantworten)', 'WhatsApp AI Chat (Auto-reply to customers)', 'دردشة واتساب الذكية (الرد التلقائي على العملاء)')} enabled={form.whatsapp_ai_enabled === 'true'} onToggle={() => updateField('whatsapp_ai_enabled', form.whatsapp_ai_enabled === 'true' ? 'false' : 'true')} />
              </div>
            </SettingsCard>
          )}

          {/* Notifications */}
          {activeTab === 'notifications' && (
            <SettingsCard icon={Bell} title={t3('Benachrichtigungen', 'Notifications', 'الإشعارات')}>
              <div className="space-y-4">
                <Field label={t3('E-Mail für Benachrichtigungen', 'Notification Email', 'البريد الإلكتروني للإشعارات')} value={form.notif_daily_summary_email || ''} onChange={(v) => updateField('notif_daily_summary_email', v)} />
                <div className="border-t pt-4 space-y-1">
                  <Toggle label={t3('E-Mail bei neuer Bestellung', 'Email on New Order', 'إشعار عند طلب جديد')} enabled={form.notif_email_new_order !== 'false'} onToggle={() => updateField('notif_email_new_order', form.notif_email_new_order === 'false' ? 'true' : 'false')} />
                  <Toggle label={t3('E-Mail bei Mindestbestand', 'Email on Low Stock', 'إشعار عند نقص المخزون')} enabled={form.notif_email_low_stock !== 'false'} onToggle={() => updateField('notif_email_low_stock', form.notif_email_low_stock === 'false' ? 'true' : 'false')} />
                  <Toggle label={t3('E-Mail bei automatischer Stornierung', 'Email on Auto-Cancel', 'إشعار عند إلغاء تلقائي')} enabled={form.notif_email_auto_cancel !== 'false'} onToggle={() => updateField('notif_email_auto_cancel', form.notif_email_auto_cancel === 'false' ? 'true' : 'false')} />
                  <Toggle label={t3('Sound bei neuer Bestellung', 'Sound on New Order', 'صوت عند طلب جديد')} enabled={form.notif_sound_enabled !== 'false'} onToggle={() => updateField('notif_sound_enabled', form.notif_sound_enabled === 'false' ? 'true' : 'false')} />
                  <Toggle label={t3('Tägliche Zusammenfassung (08:00)', 'Daily Summary (08:00)', 'ملخص يومي (8:00 صباحاً)')} enabled={form.notif_daily_summary === 'true'} onToggle={() => updateField('notif_daily_summary', form.notif_daily_summary === 'true' ? 'false' : 'true')} />
                </div>
              </div>
            </SettingsCard>
          )}

          {/* Email */}
          {activeTab === 'email' && (
            <SettingsCard icon={Mail} title={t3('E-Mail Konfiguration', 'Email Configuration', 'إعدادات البريد الإلكتروني')}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t3('Absender', 'Sender', 'المرسل')}</span>
                  <p className="text-sm font-semibold" dir="ltr">{settings?.emailFrom || '—'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Provider</span>
                  <p className="text-sm font-semibold">Resend</p>
                </div>
              </div>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Reusable Components ─────────────────────────────

function SettingsCard({ icon: Icon, title, children, accent }: { icon: typeof Building2; title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`bg-background border rounded-2xl overflow-hidden ${accent ? 'border-[#d4a853]/20' : ''}`}>
      <div className={`px-6 py-4 border-b ${accent ? 'bg-[#d4a853]/5' : 'bg-muted/20'}`}>
        <h2 className="text-base font-bold flex items-center gap-2.5">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${accent ? 'bg-[#d4a853]/15' : 'bg-muted'}`}>
            <Icon className={`h-4 w-4 ${accent ? 'text-[#d4a853]' : 'text-muted-foreground'}`} />
          </div>
          {title}
        </h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, dir }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; dir?: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{label}</label>
      <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir={dir}
        className="h-11 rounded-xl border-border/50 focus:border-[#d4a853] focus:ring-[#d4a853]/20 transition-all" />
    </div>
  )
}

function Toggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl hover:bg-muted/30 transition-colors -mx-4">
      <span className="text-sm font-medium">{label}</span>
      <button onClick={onToggle} className={`relative h-7 w-12 rounded-full transition-all duration-200 ${enabled ? 'bg-[#d4a853]' : 'bg-muted'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200`}
          style={{ transform: enabled ? 'translateX(22px)' : 'translateX(3px)' }}
        />
      </button>
    </div>
  )
}
