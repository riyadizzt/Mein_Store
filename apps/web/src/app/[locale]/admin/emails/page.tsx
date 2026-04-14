'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Send, Loader2, X, Mail, Smartphone, Monitor,
  Check, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d

const TEMPLATE_ICONS: Record<string, string> = {
  welcome: '👋', 'email-verification': '✉', 'email-change': '📧',
  'password-reset': '🔑', 'order-confirmation': '🛒', 'order-status': '📦',
  'order-cancellation': '❌', 'return-confirmation': '↩', 'guest-invite': '👤', invoice: '🧾',
}

const TEMPLATE_DESCRIPTIONS: Record<string, { de: string; ar: string }> = {
  welcome: { de: 'Wird nach der Registrierung gesendet', ar: 'يُرسل بعد التسجيل' },
  'email-verification': { de: 'Verifizierung der E-Mail-Adresse', ar: 'التحقق من البريد الإلكتروني' },
  'email-change': { de: 'Bestätigung bei E-Mail-Änderung', ar: 'تأكيد تغيير البريد' },
  'password-reset': { de: 'Link zum Passwort zurücksetzen', ar: 'رابط إعادة تعيين كلمة المرور' },
  'order-confirmation': { de: 'Nach erfolgreicher Bestellung', ar: 'بعد إتمام الطلب بنجاح' },
  'order-status': { de: 'Bei Status-Änderung der Bestellung', ar: 'عند تغيير حالة الطلب' },
  'order-cancellation': { de: 'Bestellung wurde storniert', ar: 'تم إلغاء الطلب' },
  'return-confirmation': { de: 'Retoure genehmigt/abgelehnt', ar: 'الموافقة/رفض المرتجع' },
  'guest-invite': { de: 'Einladung Konto zu erstellen', ar: 'دعوة لإنشاء حساب' },
  invoice: { de: 'Rechnung als PDF-Anhang', ar: 'الفاتورة كمرفق PDF' },
}

const PLACEHOLDERS = [
  { key: '{customer_name}', de: 'Kundenname', ar: 'اسم العميل' },
  { key: '{order_number}', de: 'Bestellnummer', ar: 'رقم الطلب' },
  { key: '{order_total}', de: 'Gesamtbetrag', ar: 'المبلغ الإجمالي' },
  { key: '{tracking_number}', de: 'Tracking-Nummer', ar: 'رقم التتبع' },
  { key: '{tracking_url}', de: 'Tracking-Link', ar: 'رابط التتبع' },
  { key: '{shop_name}', de: 'Malak Bekleidung', ar: 'ملك بيكلايدونغ' },
  { key: '{reset_url}', de: 'Passwort-Reset Link', ar: 'رابط إعادة التعيين' },
  { key: '{status}', de: 'Bestellstatus', ar: 'حالة الطلب' },
]

export default function AdminEmailsPage() {
  const locale = useLocale()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [previewLang, setPreviewLang] = useState<'de' | 'ar'>('de')
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showTestConfirm, setShowTestConfirm] = useState(false)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['admin-email-templates'],
    queryFn: async () => { const { data } = await api.get('/admin/emails/templates'); return data },
  })

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['admin-email-preview', selectedKey, previewLang],
    queryFn: async () => { const { data } = await api.get(`/admin/emails/preview/${selectedKey}`, { params: { lang: previewLang } }); return data },
    enabled: !!selectedKey,
  })

  const testMut = useMutation({
    mutationFn: async ({ key, lang }: { key: string; lang: string }) => {
      const { data } = await api.post('/admin/emails/test-send', { templateKey: key, lang })
      return data
    },
    onSuccess: (data) => {
      setToast(data.success
        ? { type: 'success', text: `${t3(locale, 'Test-E-Mail gesendet an', 'تم إرسال بريد تجريبي إلى')} ${data.sentTo}` }
        : { type: 'error', text: t3(locale, 'Fehler beim Senden', 'خطأ في الإرسال') })
      setShowTestConfirm(false)
      setTimeout(() => setToast(null), 4000)
    },
    onError: () => {
      setToast({ type: 'error', text: t3(locale, 'Fehler beim Senden — bitte erneut versuchen', 'خطأ في الإرسال — يرجى المحاولة مرة أخرى') })
      setTimeout(() => setToast(null), 4000)
    },
  })

  const getName = (tpl: any) => {
    if (typeof tpl.name === 'object') return tpl.name[locale] ?? tpl.name.de ?? tpl.key
    return tpl.name ?? tpl.key
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'E-Mail Templates', 'قوالب البريد الإلكتروني') }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t3(locale, 'E-Mail Templates', 'قوالب البريد الإلكتروني')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t3(locale, 'Vorschau und Test-Versand aller E-Mail Templates', 'معاينة وإرسال تجريبي لجميع قوالب البريد')}</p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-500/10 text-green-600 border border-green-500/20' : 'bg-red-500/10 text-red-600 border border-red-500/20'}`}
          style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
          {toast.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {toast.text}
          <button onClick={() => setToast(null)} className="ltr:ml-auto rtl:mr-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Main Content — Grid or Detail */}
      {!selectedKey ? (
        /* ═══════ TEMPLATE GRID ═══════ */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 bg-muted rounded-2xl animate-pulse" />
          )) : (templates ?? []).map((tpl: any) => {
            const desc = TEMPLATE_DESCRIPTIONS[tpl.key]
            const hasAr = (tpl.languages ?? []).includes('ar')
            const hasDe = (tpl.languages ?? []).includes('de')
            return (
              <button
                key={tpl.key}
                onClick={() => { setSelectedKey(tpl.key); setPreviewLang('de') }}
                className="bg-background border rounded-2xl p-5 text-start hover:shadow-lg hover:border-[#d4a853]/30 hover:-translate-y-0.5 transition-all duration-200 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center text-lg">
                      {TEMPLATE_ICONS[tpl.key] ?? '📧'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{getName(tpl)}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {desc ? (locale === 'ar' ? desc.ar : desc.de) : tpl.key}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-[#d4a853] transition-colors ltr:rotate-0 rtl:rotate-180" />
                </div>

                {/* Language + Status */}
                <div className="flex items-center gap-2">
                  {hasDe && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 font-medium">🇩🇪 DE</span>}
                  {hasAr && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-700 dark:text-green-300 font-medium">🇸🇦 AR</span>}
                  {!hasAr && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" />{t3(locale, 'AR fehlt', 'النسخة العربية مفقودة')}</span>}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-600 font-medium ltr:ml-auto rtl:mr-auto">{t3(locale, 'Aktiv', 'نشط')}</span>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        /* ═══════ TEMPLATE DETAIL / PREVIEW ═══════ */
        <div>
          {/* Back + Title */}
          <button onClick={() => setSelectedKey(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
            <ChevronRight className="h-4 w-4 ltr:rotate-180 rtl:rotate-0" />
            {t3(locale, 'Zurück zur Übersicht', 'العودة للقائمة')}
          </button>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center text-lg">
                {TEMPLATE_ICONS[selectedKey] ?? '📧'}
              </div>
              <div>
                <h2 className="text-lg font-bold">{(() => { const tpl = templates?.find((tp: any) => tp.key === selectedKey); return tpl ? getName(tpl) : selectedKey })()}</h2>
                <p className="text-xs text-muted-foreground">{TEMPLATE_DESCRIPTIONS[selectedKey] ? (locale === 'ar' ? TEMPLATE_DESCRIPTIONS[selectedKey].ar : TEMPLATE_DESCRIPTIONS[selectedKey].de) : ''}</p>
              </div>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-muted/30 rounded-xl border">
            {/* Language Tabs */}
            <div className="flex gap-1 bg-background rounded-lg p-1 border">
              {(['de', 'ar'] as const).map((lang) => (
                <button key={lang} onClick={() => setPreviewLang(lang)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewLang === lang ? 'bg-[#d4a853] text-black shadow-sm' : 'hover:bg-muted'}`}>
                  {lang === 'de' ? '🇩🇪 Deutsch' : '🇸🇦 العربية'}
                </button>
              ))}
            </div>

            {/* View Mode */}
            <div className="flex gap-1 bg-background rounded-lg p-1 border">
              <button onClick={() => setViewMode('desktop')} className={`p-1.5 rounded-md transition-all ${viewMode === 'desktop' ? 'bg-muted shadow-sm' : ''}`} title="Desktop">
                <Monitor className="h-4 w-4" />
              </button>
              <button onClick={() => setViewMode('mobile')} className={`p-1.5 rounded-md transition-all ${viewMode === 'mobile' ? 'bg-muted shadow-sm' : ''}`} title="Mobile">
                <Smartphone className="h-4 w-4" />
              </button>
            </div>

            {/* Test Send */}
            <div className="ltr:ml-auto rtl:mr-auto flex items-center gap-2">
              {showTestConfirm ? (
                <div className="flex items-center gap-2 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
                  <span className="text-xs text-amber-700 dark:text-amber-300">{t3(locale, 'An deine Admin-E-Mail senden?', 'إرسال إلى بريدك الإداري؟')}</span>
                  <Button size="sm" className="h-7 gap-1 bg-[#d4a853] hover:bg-[#c49b4a] text-black text-xs rounded-lg"
                    onClick={() => testMut.mutate({ key: selectedKey!, lang: previewLang })}
                    disabled={testMut.isPending}>
                    {testMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    {t3(locale, 'Ja, senden', 'نعم، إرسال')}
                  </Button>
                  <button onClick={() => setShowTestConfirm(false)} className="p-0.5"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" onClick={() => setShowTestConfirm(true)}>
                  <Send className="h-3.5 w-3.5" />
                  {t3(locale, 'Test-E-Mail senden', 'إرسال بريد تجريبي')}
                </Button>
              )}
            </div>
          </div>

          {/* Two Column Layout: Placeholders + Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Placeholders Reference */}
            <div className="bg-background border rounded-2xl p-4">
              <h4 className="font-semibold text-xs mb-3 text-muted-foreground uppercase tracking-wider">{t3(locale, 'Platzhalter', 'المتغيرات')}</h4>
              <div className="space-y-1.5">
                {PLACEHOLDERS.map((p) => (
                  <div key={p.key} className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0">
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{p.key}</code>
                    <span className="text-muted-foreground text-[10px]">{locale === 'ar' ? p.ar : p.de}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">{t3(locale, 'Platzhalter werden automatisch beim Senden ersetzt.', 'يتم استبدال المتغيرات تلقائيا عند الإرسال.')}</p>
            </div>

            {/* Preview */}
            <div className="lg:col-span-3">
              {/* Subject Line */}
              {preview?.subject && (
                <div className="bg-muted/30 border rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">{t3(locale, 'Betreff', 'الموضوع')}:</span>
                  <span className="text-sm font-medium">{preview.subject}</span>
                </div>
              )}

              {/* Email Preview Frame */}
              <div className={`bg-gray-100 dark:bg-gray-900 rounded-2xl p-4 flex justify-center transition-all duration-300 ${viewMode === 'mobile' ? 'py-8' : ''}`}>
                {previewLoading ? (
                  <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : preview?.html ? (
                  <div className={`transition-all duration-300 ${viewMode === 'mobile' ? 'w-[375px] rounded-[2rem] border-8 border-gray-800 dark:border-gray-600 shadow-2xl overflow-hidden' : 'w-full max-w-2xl'}`}>
                    {viewMode === 'mobile' && (
                      <div className="h-6 bg-gray-800 dark:bg-gray-600 flex items-center justify-center">
                        <div className="w-16 h-1 bg-gray-600 dark:bg-gray-500 rounded-full" />
                      </div>
                    )}
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={preview.html}
                      dir={previewLang === 'ar' ? 'rtl' : 'ltr'}
                      className="bg-white w-full block"
                      style={{ height: viewMode === 'mobile' ? '600px' : '800px', border: 'none' }}
                    />
                  </div>
                ) : (
                  <div className="text-center py-20 text-muted-foreground text-sm">
                    {t3(locale, 'Template nicht verfügbar', 'القالب غير متوفر')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
