'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Mail, Phone, MapPin, Clock, Send, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { API_BASE_URL } from '@/lib/env'

export default function ContactPage() {
  const t = useTranslations('contact')
  const locale = useLocale()
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', website: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, locale }),
      })
      const body: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        const localized =
          typeof body?.message === 'object'
            ? body.message[locale] ?? body.message.de
            : body?.message
        setError(
          localized ||
            (locale === 'ar'
              ? 'حدث خطأ. يرجى المحاولة مرة أخرى.'
              : locale === 'en'
                ? 'Something went wrong. Please try again.'
                : 'Etwas ist schiefgelaufen. Bitte erneut versuchen.'),
        )
        setSubmitting(false)
        return
      }
      setSent(true)
    } catch {
      setError(
        locale === 'ar'
          ? 'خطأ في الشبكة. يرجى المحاولة مرة أخرى.'
          : locale === 'en'
            ? 'Network error. Please try again.'
            : 'Netzwerkfehler. Bitte erneut versuchen.',
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-8 lg:px-12 py-12 sm:py-20">
      <div className="text-center mb-14 animate-fade-up">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">{t('title')}</h1>
        <p className="text-muted-foreground max-w-md mx-auto text-base">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-14 max-w-5xl mx-auto">
        {/* Contact Info */}
        <div className="lg:col-span-2 space-y-8 animate-fade-up delay-100">
          {[
            { Icon: Mail, label: t('email'), value: 'info@malak-bekleidung.com', ltr: true },
            { Icon: Phone, label: t('phone'), value: '+49 (0) 30 123 456 78', ltr: true },
            { Icon: MapPin, label: t('address'), value: 'Berlin, Deutschland', ltr: false },
            { Icon: Clock, label: t('hours'), value: t('hoursValue'), ltr: false },
          ].map(({ Icon, label, value, ltr }) => (
            <div key={label} className="flex items-start gap-4 group">
              <div className="h-12 w-12 rounded-xl bg-[#d4a853]/10 flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:bg-[#d4a853]/20 group-hover:scale-105">
                <Icon className="h-5 w-5 text-[#d4a853]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0f1419] mb-1">{label}</p>
                <p className={`text-base text-[#0f1419]/60 ${ltr ? 'dir-ltr' : ''}`} dir={ltr ? 'ltr' : undefined}>
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="lg:col-span-3 animate-fade-up delay-200">
          {sent ? (
            <div className="text-center py-16 animate-scale-in">
              <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
              <h3 className="text-xl font-bold mb-2">{t('sent')}</h3>
              <p className="text-muted-foreground text-base">
                {locale === 'ar'
                  ? 'سنرد عليك خلال 24 ساعة. تحقق من بريدك الإلكتروني للحصول على تأكيد.'
                  : locale === 'en'
                    ? 'We will get back to you within 24 hours. Check your inbox for a confirmation.'
                    : 'Wir melden uns innerhalb von 24 Stunden bei dir. Prüfe dein Postfach für die Bestätigung.'}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 bg-white border border-[#e5e5e5]/60 rounded-2xl shadow-lg p-7 sm:p-10">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {/* Honeypot — bots fill this, humans don't see it */}
              <input
                type="text"
                name="website"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('name')}</label>
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    disabled={submitting}
                    className="h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('emailField')}</label>
                  <Input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    disabled={submitting}
                    dir="ltr"
                    className="h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('subject')}</label>
                <Input
                  required
                  minLength={2}
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  disabled={submitting}
                  className="h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('message')}</label>
                <textarea
                  required
                  minLength={10}
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  disabled={submitting}
                  className="w-full px-4 py-3 rounded-xl border border-[#e0e0e0] bg-white text-base resize-none focus:outline-none focus:border-[#d4a853] focus:ring-2 focus:ring-[#d4a853]/20 transition-colors disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-13 rounded-xl bg-[#d4a853] text-white text-base font-semibold hover:bg-[#c49b45] transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('send')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
