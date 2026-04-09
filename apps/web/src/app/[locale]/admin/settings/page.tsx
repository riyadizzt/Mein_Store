'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations, useLocale } from 'next-intl'
import { Settings, CreditCard, Truck, Mail, Building2, Check, Loader2, Gift, Bell, Shield } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

export default function AdminSettingsPage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/settings'); return data },
  })

  // Sync form with loaded settings
  useEffect(() => {
    if (settings) {
      setForm({
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
        returnsEnabled: String(settings.returnsEnabled ?? 'true'),
        // Vorkasse
        vorkasse_enabled: String(settings.vorkasse_enabled ?? 'false'),
        vorkasse_account_holder: String(settings.vorkasse_account_holder ?? ''),
        vorkasse_iban: String(settings.vorkasse_iban ?? ''),
        vorkasse_bic: String(settings.vorkasse_bic ?? ''),
        vorkasse_bank_name: String(settings.vorkasse_bank_name ?? ''),
        vorkasse_deadline_days: String(settings.vorkasse_deadline_days ?? '7'),
        // SumUp
        sumup_enabled: String(settings.sumup_enabled ?? 'false'),
        sumup_merchant_code: String(settings.sumup_merchant_code ?? ''),
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/admin/settings', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const updateField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))
  const toggleField = (key: string) => setForm((prev) => ({ ...prev, [key]: prev[key] === 'true' ? 'false' : 'true' }))

  if (isLoading) {
    return (
      <div>
        <AdminBreadcrumb items={[{ label: t('settings.title') }]} />
        <div className="space-y-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-shimmer rounded-xl" />)}</div>
      </div>
    )
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('settings.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6" />{t('settings.title')}</h1>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? t('settings.saved') : t('settings.save')}
        </Button>
      </div>

      {saveMutation.isError && (
        <div className="mb-4 p-3 rounded-xl bg-destructive/10 text-sm text-destructive">Fehler beim Speichern</div>
      )}

      {/* Quick Link to Tracking & Privacy Settings */}
      <Link
        href={`/${locale}/admin/settings/tracking`}
        className="flex items-center gap-3 p-4 bg-[#1a1a2e] border border-white/5 rounded-xl hover:border-[#d4a853]/30 transition-colors group mb-6"
      >
        <div className="h-10 w-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center group-hover:bg-[#d4a853]/20 transition-colors">
          <Shield className="h-5 w-5 text-[#d4a853]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{locale === 'ar' ? 'التتبع والخصوصية' : 'Tracking & Datenschutz'}</p>
          <p className="text-xs text-white/40">{locale === 'ar' ? 'PostHog Analytics، بانر الكوكيز، بكسل التسويق' : 'PostHog Analytics, Cookie-Banner, Marketing-Pixel'}</p>
        </div>
      </Link>

      <div className="space-y-6">
        {/* Company Info */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            {t('settings.companyInfo')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('settings.storeName')} value={form.companyName} onChange={(v) => updateField('companyName', v)} />
            <Field label={t('settings.supportEmail')} value={form.companyEmail} onChange={(v) => updateField('companyEmail', v)} type="email" />
            <Field label="Telefon" value={form.companyPhone} onChange={(v) => updateField('companyPhone', v)} />
            <Field label="Adresse" value={form.companyAddress} onChange={(v) => updateField('companyAddress', v)} className="sm:col-span-2" />
            <Field label="USt-IdNr." value={form.companyVatId} onChange={(v) => updateField('companyVatId', v)} />
            <Field label="Geschäftsführer" value={form.companyCeo} onChange={(v) => updateField('companyCeo', v)} />
          </div>
        </div>

        {/* Payment Methods */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            {t('settings.paymentMethods')}
          </h2>
          <div className="space-y-3">
            <Toggle label="Stripe (Kreditkarte, Apple Pay, Google Pay)" enabled={form.stripeEnabled === 'true'} onToggle={() => toggleField('stripeEnabled')} />
            <Toggle label="Klarna (Rechnung, Ratenzahlung)" enabled={form.klarnaEnabled === 'true'} onToggle={() => toggleField('klarnaEnabled')} />
            <Toggle label="PayPal" enabled={form.paypalEnabled === 'true'} onToggle={() => toggleField('paypalEnabled')} />
            <Toggle label={locale === 'ar' ? 'الدفع المسبق (تحويل بنكي)' : 'Vorkasse (Banküberweisung)'} enabled={form.vorkasse_enabled === 'true'} onToggle={() => updateField('vorkasse_enabled', form.vorkasse_enabled === 'true' ? 'false' : 'true')} />
            {form.vorkasse_enabled === 'true' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ltr:pl-8 rtl:pr-8 border-s-2 border-[#d4a853]/30 ltr:ml-2 rtl:mr-2">
                <Field label={locale === 'ar' ? 'صاحب الحساب' : 'Kontoinhaber'} value={form.vorkasse_account_holder} onChange={(v) => updateField('vorkasse_account_holder', v)} />
                <Field label="IBAN" value={form.vorkasse_iban} onChange={(v) => updateField('vorkasse_iban', v)} />
                <Field label="BIC / SWIFT" value={form.vorkasse_bic} onChange={(v) => updateField('vorkasse_bic', v)} />
                <Field label={locale === 'ar' ? 'اسم البنك' : 'Bankname'} value={form.vorkasse_bank_name} onChange={(v) => updateField('vorkasse_bank_name', v)} />
                <Field label={locale === 'ar' ? 'مهلة الدفع (أيام)' : 'Zahlungsfrist (Tage)'} value={form.vorkasse_deadline_days} onChange={(v) => updateField('vorkasse_deadline_days', v)} type="number" />
              </div>
            )}
            <Toggle label={locale === 'ar' ? 'SumUp (بطاقة ائتمان)' : 'SumUp (Kartenzahlung)'} enabled={form.sumup_enabled === 'true'} onToggle={() => updateField('sumup_enabled', form.sumup_enabled === 'true' ? 'false' : 'true')} />
            {form.sumup_enabled === 'true' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ltr:pl-8 rtl:pr-8 border-s-2 border-[#d4a853]/30 ltr:ml-2 rtl:mr-2">
                <Field label="Merchant Code" value={form.sumup_merchant_code} onChange={(v) => updateField('sumup_merchant_code', v)} />
                <p className="text-xs text-muted-foreground col-span-full">{locale === 'ar' ? 'مفتاح API يُضاف في ملف .env (SUMUP_API_KEY)' : 'API Key wird in .env gesetzt (SUMUP_API_KEY)'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Marketing */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Gift className="h-5 w-5 text-muted-foreground" />
            Marketing
          </h2>
          <div className="space-y-3">
            <Toggle label={locale === 'ar' ? 'نافذة الترحيب (10% خصم للمشتركين الجدد)' : 'Willkommens-Popup (10% Rabatt für Newsletter-Abonnenten)'} enabled={form.welcomePopupEnabled !== 'false'} onToggle={() => updateField('welcomePopupEnabled', form.welcomePopupEnabled === 'false' ? 'true' : 'false')} />
            {form.welcomePopupEnabled !== 'false' && (
              <Field label={locale === 'ar' ? 'نسبة خصم الترحيب (%)' : 'Willkommensrabatt (%)'} value={form.welcomeDiscountPercent || '10'} onChange={(v) => updateField('welcomeDiscountPercent', v)} type="number" />
            )}
            <Toggle label={locale === 'ar' ? 'نظام الإرجاع (زر الإرجاع عند العميل)' : 'Retouren-System (Retoure-Button beim Kunden)'} enabled={form.returnsEnabled !== 'false'} onToggle={() => updateField('returnsEnabled', form.returnsEnabled === 'false' ? 'true' : 'false')} />
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {locale === 'ar' ? 'الإشعارات' : 'Benachrichtigungen'}
          </h2>
          <div className="space-y-3">
            <Field label={locale === 'ar' ? 'البريد الإلكتروني للإشعارات' : 'E-Mail für Benachrichtigungen'} value={form.notif_daily_summary_email || ''} onChange={(v) => updateField('notif_daily_summary_email', v)} placeholder="admin@malak-bekleidung.com" />
            <Toggle label={locale === 'ar' ? 'إشعار بريدي عند طلب جديد' : 'E-Mail bei neuer Bestellung'} enabled={form.notif_email_new_order !== 'false'} onToggle={() => updateField('notif_email_new_order', form.notif_email_new_order === 'false' ? 'true' : 'false')} />
            <Toggle label={locale === 'ar' ? 'إشعار بريدي عند نقص المخزون' : 'E-Mail bei Mindestbestand'} enabled={form.notif_email_low_stock !== 'false'} onToggle={() => updateField('notif_email_low_stock', form.notif_email_low_stock === 'false' ? 'true' : 'false')} />
            <Toggle label={locale === 'ar' ? 'صوت عند طلب جديد' : 'Sound bei neuer Bestellung'} enabled={form.notif_sound_enabled !== 'false'} onToggle={() => updateField('notif_sound_enabled', form.notif_sound_enabled === 'false' ? 'true' : 'false')} />
            <Toggle label={locale === 'ar' ? 'ملخص يومي بالبريد (8:00 صباحاً)' : 'Tägliche Zusammenfassung per E-Mail (08:00)'} enabled={form.notif_daily_summary === 'true'} onToggle={() => updateField('notif_daily_summary', form.notif_daily_summary === 'true' ? 'false' : 'true')} />
          </div>
        </div>

        {/* Shipping */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Truck className="h-5 w-5 text-muted-foreground" />
            Versand
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Gratisversand ab (EUR)" value={form.freeShippingThreshold} onChange={(v) => updateField('freeShippingThreshold', v)} type="number" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">DHL API:</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${settings?.dhlConfigured ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                {settings?.dhlConfigured ? 'Konfiguriert' : 'Manueller Modus'}
              </span>
            </div>
          </div>
        </div>

        {/* Email */}
        <div className="bg-background border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-muted-foreground" />
            {t('settings.emailConfig')}
          </h2>
          <div className="text-sm">
            <p className="text-muted-foreground">Absender: <span className="font-medium text-foreground">{settings?.emailFrom || '—'}</span></p>
            <p className="text-muted-foreground mt-1">Provider: <span className="font-medium text-foreground">Resend</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, className }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{label}</label>
      <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function Toggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <button onClick={onToggle} className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-muted'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`}
          style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}
