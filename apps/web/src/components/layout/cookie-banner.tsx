'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import { X, Cookie, Shield, BarChart3, Megaphone } from 'lucide-react'
import { useConsentStore } from '@/store/consent-store'
import { motion, AnimatePresence } from 'motion/react'

const COPY = {
  de: {
    title: 'Deine Privatsphäre',
    body: 'Wir nutzen Cookies, um dein Einkaufserlebnis zu verbessern und unseren Shop zu optimieren.',
    acceptAll: 'Alle akzeptieren',
    essentialOnly: 'Nur notwendige',
    settings: 'Einstellungen',
    settingsTitle: 'Cookie-Einstellungen',
    save: 'Auswahl speichern',
    privacy: 'Datenschutzerklärung',
    essential: { title: 'Notwendige Cookies', desc: 'Für den Betrieb des Shops erforderlich: Warenkorb, Sprache, Anmeldung. Können nicht deaktiviert werden.' },
    analytics: { title: 'Analyse-Cookies', desc: 'Helfen uns zu verstehen, wie der Shop genutzt wird (PostHog). Daten bleiben auf EU-Servern.' },
    marketing: { title: 'Marketing-Cookies', desc: 'Ermöglichen personalisierte Werbung über Meta und TikTok. Für Retargeting-Kampagnen.' },
  },
  en: {
    title: 'Your Privacy',
    body: 'We use cookies to improve your shopping experience and optimize our store.',
    acceptAll: 'Accept all',
    essentialOnly: 'Essential only',
    settings: 'Settings',
    settingsTitle: 'Cookie Settings',
    save: 'Save preferences',
    privacy: 'Privacy Policy',
    essential: { title: 'Essential Cookies', desc: 'Required for the store to function: cart, language, login. Cannot be disabled.' },
    analytics: { title: 'Analytics Cookies', desc: 'Help us understand how the store is used (PostHog). Data stays on EU servers.' },
    marketing: { title: 'Marketing Cookies', desc: 'Enable personalized ads via Meta and TikTok. Used for retargeting campaigns.' },
  },
  ar: {
    title: 'خصوصيتك',
    body: 'نستخدم ملفات تعريف الارتباط لتحسين تجربة التسوق وتطوير متجرنا.',
    acceptAll: 'قبول الكل',
    essentialOnly: 'الضرورية فقط',
    settings: 'الإعدادات',
    settingsTitle: 'إعدادات ملفات تعريف الارتباط',
    save: 'حفظ التفضيلات',
    privacy: 'سياسة الخصوصية',
    essential: { title: 'ملفات تعريف الارتباط الضرورية', desc: 'مطلوبة لتشغيل المتجر: السلة، اللغة، تسجيل الدخول. لا يمكن تعطيلها.' },
    analytics: { title: 'ملفات تعريف الارتباط التحليلية', desc: 'تساعدنا في فهم كيفية استخدام المتجر (PostHog). البيانات تبقى على خوادم أوروبية.' },
    marketing: { title: 'ملفات تعريف الارتباط التسويقية', desc: 'تتيح الإعلانات المخصصة عبر Meta و TikTok. تُستخدم لحملات إعادة الاستهداف.' },
  },
}

/* ── Toggle Switch ── */
function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors duration-200 flex-shrink-0 ${
        disabled ? 'bg-brand-gold/30 cursor-not-allowed' : checked ? 'bg-brand-gold' : 'bg-muted-foreground/20'
      }`}
    >
      <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'} mt-0.5`} />
    </button>
  )
}

/* ── Settings Modal ── */
function SettingsModal({ locale }: { locale: string }) {
  const copy = COPY[locale as keyof typeof COPY] ?? COPY.de
  const { analytics, marketing, saveCustom, acceptEssentialOnly, closeSettings } = useConsentStore()
  const [localAnalytics, setLocalAnalytics] = useState(analytics)
  const [localMarketing, setLocalMarketing] = useState(marketing)

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={closeSettings} />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed z-[201] bottom-0 left-0 right-0 md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:max-w-lg bg-background rounded-t-2xl md:rounded-2xl shadow-2xl border"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{copy.settingsTitle}</h2>
          <button onClick={closeSettings} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3"><Shield className="h-5 w-5 text-brand-gold mt-0.5 flex-shrink-0" /><div><p className="text-sm font-semibold">{copy.essential.title}</p><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.essential.desc}</p></div></div>
            <Toggle checked={true} onChange={() => {}} disabled />
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3"><BarChart3 className="h-5 w-5 text-brand-gold mt-0.5 flex-shrink-0" /><div><p className="text-sm font-semibold">{copy.analytics.title}</p><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.analytics.desc}</p></div></div>
            <Toggle checked={localAnalytics} onChange={setLocalAnalytics} />
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3"><Megaphone className="h-5 w-5 text-brand-gold mt-0.5 flex-shrink-0" /><div><p className="text-sm font-semibold">{copy.marketing.title}</p><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.marketing.desc}</p></div></div>
            <Toggle checked={localMarketing} onChange={setLocalMarketing} />
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-muted/30 flex gap-3">
          <button onClick={() => { acceptEssentialOnly(); closeSettings() }} className="flex-1 h-11 rounded-xl border text-sm font-medium hover:bg-muted transition-colors">{copy.essentialOnly}</button>
          <button onClick={() => { saveCustom(localAnalytics, localMarketing); closeSettings() }} className="flex-1 h-11 rounded-xl bg-[#0f1419] text-white text-sm font-semibold hover:bg-[#1a1a2e] transition-colors btn-press">{copy.save}</button>
        </div>
      </motion.div>
    </>
  )
}

/* ── Main Banner ── */
export function CookieBanner() {
  const locale = useLocale()
  const copy = COPY[locale as keyof typeof COPY] ?? COPY.de
  const { decided, acceptAll, acceptEssentialOnly, settingsOpen, openSettings } = useConsentStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return (
    <>
      <AnimatePresence>{settingsOpen && <SettingsModal locale={locale} />}</AnimatePresence>

      <AnimatePresence>
        {!decided && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-[190] p-4 sm:p-6"
          >
            <div className="mx-auto max-w-2xl bg-background border rounded-2xl shadow-elevated p-5 sm:p-6">
              <div className="flex items-start gap-3 mb-4">
                <Cookie className="h-5 w-5 text-brand-gold flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold">{copy.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{copy.body}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button onClick={acceptAll} className="flex-1 h-10 rounded-xl bg-[#0f1419] text-white text-sm font-semibold hover:bg-[#1a1a2e] transition-colors btn-press">{copy.acceptAll}</button>
                <button onClick={acceptEssentialOnly} className="flex-1 h-10 rounded-xl border text-sm font-medium hover:bg-muted transition-colors">{copy.essentialOnly}</button>
                <button onClick={openSettings} className="h-10 px-4 rounded-xl text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">{copy.settings}</button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 text-center">
                <Link href={`/${locale}/legal/datenschutz`} className="underline underline-offset-2 hover:text-foreground transition-colors">{copy.privacy}</Link>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
