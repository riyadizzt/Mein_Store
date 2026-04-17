'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bot, MessageCircle, FileText, Package, Megaphone, MessageSquare,
  Power, Loader2, Send, Copy, Check, BarChart3, ScrollText,
  RefreshCw, X, Sparkles, Instagram, Facebook, Star, Smile, Meh, Frown, HelpCircle,
  History, Trash2, ExternalLink,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d

// Unified feature catalogue — gold accent when active, grey when inactive.
// Individual accent colors were removed so the panel reads as one system,
// not six apps. Every feature has a one-line description so the admin
// never has to guess what a toggle controls.
const AI_FEATURES = [
  {
    key: 'customer_chat',
    icon: MessageCircle,
    label: 'Kunden-Chatbot',
    labelEn: 'Customer chatbot',
    labelAr: 'روبوت الدردشة',
    descDe: 'Chat-Widget im Shop. KI beantwortet Produktfragen und hilft Kunden.',
    descEn: 'Chat widget on the store. AI answers product questions and assists customers.',
    descAr: 'واجهة دردشة في المتجر. الذكاء الاصطناعي يجيب على أسئلة المنتجات.',
  },
  {
    key: 'admin_assistant',
    icon: Bot,
    label: 'Admin-Assistent',
    labelEn: 'Admin assistant',
    labelAr: 'مساعد المشرف',
    descDe: 'KI-Assistent im Dashboard. Analysiert Verkäufe, Bestand und Kunden.',
    descEn: 'AI assistant in the dashboard. Analyzes sales, stock and customers.',
    descAr: 'مساعد ذكي في لوحة التحكم. يحلل المبيعات والمخزون والعملاء.',
  },
  {
    key: 'product_description',
    icon: FileText,
    label: 'Produktbeschreibung',
    labelEn: 'Product descriptions',
    labelAr: 'وصف المنتج',
    descDe: 'Generiert Beschreibungen und SEO-Tags aus Produktfotos in 3 Sprachen.',
    descEn: 'Generates descriptions and SEO tags from product photos in 3 languages.',
    descAr: 'إنشاء أوصاف وعلامات SEO من صور المنتجات بثلاث لغات.',
  },
  {
    key: 'inventory_suggestions',
    icon: Package,
    label: 'Inventar-Vorschläge',
    labelEn: 'Inventory suggestions',
    labelAr: 'اقتراحات المخزون',
    descDe: 'Schlägt Nachbestellungen und Umverteilungen basierend auf Verkaufsdaten vor.',
    descEn: 'Suggests reorders and transfers based on sales data.',
    descAr: 'يقترح إعادة الطلب ونقل المخزون بناءً على بيانات المبيعات.',
  },
  {
    key: 'marketing_text',
    icon: Megaphone,
    label: 'Marketing-Texte',
    labelEn: 'Marketing copy',
    labelAr: 'نصوص تسويقية',
    descDe: 'Erstellt Banner-, Popup- und E-Mail-Texte für Kampagnen.',
    descEn: 'Creates banner, popup, and email copy for campaigns.',
    descAr: 'إنشاء نصوص البانرات والنوافذ المنبثقة ورسائل البريد للحملات.',
  },
  {
    key: 'social_reply',
    icon: MessageSquare,
    label: 'Social Media Antworten',
    labelEn: 'Social media replies',
    labelAr: 'ردود وسائل التواصل',
    descDe: 'Generiert 3 Antwort-Varianten für Kommentare auf Instagram, Facebook, TikTok.',
    descEn: 'Generates 3 reply variants for comments on Instagram, Facebook, TikTok.',
    descAr: 'إنشاء 3 خيارات للرد على تعليقات إنستغرام وفيسبوك وتيك توك.',
  },
]

export default function AdminAiPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'settings' | 'assistant' | 'products' | 'inventory' | 'marketing' | 'social' | 'logs'>('settings')
  const [settings, setSettings] = useState<Record<string, string>>({ ai_global_enabled: 'false' })
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Load settings
  const { data: aiSettings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/ai/settings'); return data },
  })

  const { data: stats } = useQuery({
    queryKey: ['ai-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/ai/stats'); return data },
  })

  useEffect(() => {
    if (aiSettings) setSettings((p) => ({ ...p, ...aiSettings }))
  }, [aiSettings])

  // Save toggle
  const saveMut = useMutation({
    mutationFn: async (keysToSave: Record<string, string>) => {
      await api.patch('/admin/settings', keysToSave)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      setToast({ type: 'success', text: t3(locale, 'Gespeichert', 'تم الحفظ') })
      setTimeout(() => setToast(null), 2000)
    },
    onError: () => {
      setToast({ type: 'error', text: t3(locale, 'Fehler', 'خطأ') })
      setTimeout(() => setToast(null), 3000)
    },
  })

  const toggleSetting = (key: string) => {
    const newVal = settings[key] === 'true' ? 'false' : 'true'
    setSettings((p) => ({ ...p, [key]: newVal }))
    saveMut.mutate({ [key]: newVal })
  }

  // Admin Assistant
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantResponse, setAssistantResponse] = useState('')
  const assistantMut = useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post('/admin/ai/assistant', { message })
      return data
    },
    onSuccess: (data) => setAssistantResponse(data.response),
    onError: () => setAssistantResponse(t3(locale, 'Fehler bei der KI-Anfrage.', 'خطأ في طلب الذكاء الاصطناعي.')),
  })

  // Product Description
  const [pdName, setPdName] = useState('')
  const [pdCategory, setPdCategory] = useState('')
  const [pdResult, setPdResult] = useState<{ de: string; ar: string; en: string } | null>(null)
  const pdMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/ai/generate-product-description', { name: pdName, category: pdCategory })
      return data
    },
    onSuccess: (data) => setPdResult({ de: data.de, ar: data.ar, en: data.en }),
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Generierung', 'خطأ في الإنشاء') }),
  })

  // Inventory
  const [invResult, setInvResult] = useState('')
  const invMut = useMutation({
    mutationFn: async () => { const { data } = await api.post('/admin/ai/inventory-suggestions', { lang: locale }); return data },
    onSuccess: (data) => setInvResult(data.suggestions),
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Analyse', 'خطأ في التحليل') }),
  })

  // Marketing
  // ── Marketing Studio ─────────────────────────────────────────
  const router = useRouter()
  type MktFormat = 'hero' | 'popup' | 'bar' | 'newsletter' | 'social'
  type MktTone = 'elegant' | 'playful' | 'urgent' | 'luxury' | 'seasonal'
  type MktLang = 'de' | 'en' | 'ar'
  const [mktFormat, setMktFormat] = useState<MktFormat>('hero')
  const [mktOccasion, setMktOccasion] = useState('')
  const [mktTarget, setMktTarget] = useState<'all' | 'men' | 'women' | 'kids'>('all')
  const [mktTone, setMktTone] = useState<MktTone>('elegant')
  const [mktDiscount, setMktDiscount] = useState('')
  const [mktValidUntil, setMktValidUntil] = useState('')
  const [mktLanguages, setMktLanguages] = useState<MktLang[]>(['de', 'en', 'ar'])
  const [mktActiveLang, setMktActiveLang] = useState<MktLang>('de')
  const [mktResult, setMktResult] = useState<any>(null)
  const [mktCopiedKey, setMktCopiedKey] = useState<string | null>(null)

  const mktMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/ai/generate-marketing-text', {
        occasion: mktOccasion,
        format: mktFormat,
        target: mktTarget === 'all' ? undefined : mktTarget,
        tone: mktTone,
        discount: mktDiscount || undefined,
        validUntil: mktValidUntil || undefined,
        languages: mktLanguages,
        variants: 3,
      })
      return data
    },
    onSuccess: (data) => {
      setMktResult(data)
      // Snap the output language tab to the first requested language
      const first = (data?.languages?.[0] ?? mktLanguages[0]) as MktLang
      if (first) setMktActiveLang(first)
    },
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Generierung', 'خطأ في الإنشاء') }),
  })

  // Social Reply — Zalando-style two-column panel with 3 variants
  const [socialMsg, setSocialMsg] = useState('')
  const [socialPlatform, setSocialPlatform] = useState<'instagram' | 'facebook' | 'tiktok' | 'whatsapp' | 'review'>('instagram')
  const [socialTone, setSocialTone] = useState<'friendly' | 'professional' | 'apologetic' | 'grateful'>('friendly')
  const [socialLang, setSocialLang] = useState<string>('auto')
  const [socialShowMoreLangs, setSocialShowMoreLangs] = useState(false)
  const [socialVariants, setSocialVariants] = useState<string[]>([])
  const [socialSentiment, setSocialSentiment] = useState<'positive' | 'neutral' | 'negative' | 'question' | null>(null)
  const [socialCopiedIdx, setSocialCopiedIdx] = useState<number | null>(null)
  const [socialHistory, setSocialHistory] = useState<Array<{ msg: string; variants: string[]; platform: string; ts: number }>>([])

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('admin-ai-social-history')
      if (raw) setSocialHistory(JSON.parse(raw).slice(0, 10))
    } catch { /* ignore */ }
  }, [])

  const socialMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/ai/social-reply', {
        customerMessage: socialMsg,
        platform: socialPlatform,
        lang: socialLang,
        tone: socialTone,
        variants: 3,
      })
      return data
    },
    onSuccess: (data) => {
      const vars: string[] = Array.isArray(data.variants) && data.variants.length > 0 ? data.variants : [data.reply]
      setSocialVariants(vars)
      setSocialSentiment(data.sentiment ?? null)
      // Save to history (max 10)
      const entry = { msg: socialMsg, variants: vars, platform: socialPlatform, ts: Date.now() }
      const next = [entry, ...socialHistory.filter(h => h.msg !== socialMsg)].slice(0, 10)
      setSocialHistory(next)
      try { localStorage.setItem('admin-ai-social-history', JSON.stringify(next)) } catch { /* ignore */ }
    },
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Generierung', 'خطأ في الإنشاء') }),
  })

  // Quick templates — common customer message scenarios
  const socialTemplates = [
    { key: 'praise', labelDe: 'Lob / 5 Sterne', labelEn: 'Praise / 5 stars', labelAr: 'مدح / 5 نجوم', msg: t3(locale, 'Super Qualität, schnelle Lieferung, komme gerne wieder!', 'جودة ممتازة وتوصيل سريع، سأعود مرة أخرى!') },
    { key: 'shipping_delay', labelDe: 'Versand verspätet', labelEn: 'Shipping delay', labelAr: 'تأخر الشحن', msg: t3(locale, 'Wo bleibt meine Bestellung? Seit 5 Tagen nichts!', 'أين طلبي؟ لم يصل منذ 5 أيام!') },
    { key: 'size_question', labelDe: 'Größen-Frage', labelEn: 'Size question', labelAr: 'سؤال عن المقاس', msg: t3(locale, 'Welche Größe passt mir bei 175cm und 70kg?', 'ما المقاس المناسب لطول 175 سم ووزن 70 كجم؟') },
    { key: 'complaint', labelDe: 'Reklamation', labelEn: 'Complaint', labelAr: 'شكوى', msg: t3(locale, 'Der Pullover hat nach einmal Waschen Löcher!', 'السترة بها ثقوب بعد غسلة واحدة!') },
    { key: 'stock_question', labelDe: 'Verfügbarkeit', labelEn: 'Availability', labelAr: 'التوفر', msg: t3(locale, 'Ist das Kleid auch in Größe M verfügbar?', 'هل الفستان متوفر بمقاس M أيضاً؟') },
    { key: 'return_question', labelDe: 'Rückgabe-Frage', labelEn: 'Return question', labelAr: 'سؤال عن الإرجاع', msg: t3(locale, 'Kann ich die Hose noch zurückgeben? 10 Tage alt.', 'هل يمكنني إرجاع البنطال؟ عمره 10 أيام.') },
  ]

  // Logs
  const { data: logs } = useQuery({
    queryKey: ['ai-logs', activeTab],
    queryFn: async () => { const { data } = await api.get('/admin/ai/logs', { params: { limit: 30 } }); return data },
    enabled: activeTab === 'logs',
  })

  const globalOn = settings.ai_global_enabled === 'true'

  // Per-key "just saved" indicator so each toggle gets inline feedback
  // instead of only a global toast. Clears itself after 1500ms.
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null)
  const toggleSettingWithFeedback = (key: string) => {
    toggleSetting(key)
    setJustSavedKey(key)
    setTimeout(() => setJustSavedKey((k) => (k === key ? null : k)), 1500)
  }

  // Forecast: linear extrapolation of this-month cost to end-of-month.
  // Cheap heuristic — gives admin a rough "where we're heading" number
  // without needing a new backend endpoint.
  const costForecast = (() => {
    if (!stats) return null
    const now = new Date()
    const day = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const costSoFar = Number(stats.estimatedCostUsd ?? 0)
    if (day < 2 || costSoFar <= 0) return null
    return (costSoFar * (daysInMonth / day)).toFixed(2)
  })()

  const TABS = [
    { key: 'settings', label: t3(locale, 'Einstellungen', 'الإعدادات'), icon: Power },
    { key: 'assistant', label: t3(locale, 'Assistent', 'المساعد'), icon: Bot, needs: 'ai_admin_assistant_enabled' },
    { key: 'products', label: t3(locale, 'Beschreibungen', 'الأوصاف'), icon: FileText, needs: 'ai_product_description_enabled' },
    { key: 'inventory', label: t3(locale, 'Inventar', 'المخزون'), icon: Package, needs: 'ai_inventory_suggestions_enabled' },
    { key: 'marketing', label: t3(locale, 'Marketing', 'التسويق'), icon: Megaphone, needs: 'ai_marketing_text_enabled' },
    { key: 'social', label: t3(locale, 'Social Media', 'وسائل التواصل'), icon: MessageSquare, needs: 'ai_social_reply_enabled' },
    { key: 'logs', label: t3(locale, 'Logs', 'السجلات'), icon: ScrollText },
  ]

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'KI-Assistent', 'مساعد الذكاء الاصطناعي') }]} />
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Bot className="h-6 w-6 text-[#d4a853]" />
        {t3(locale, 'KI-Assistent', 'مساعد الذكاء الاصطناعي')}
      </h1>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${toast.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
          {toast.type === 'success' ? <Check className="h-4 w-4" /> : '!'} {toast.text}
        </div>
      )}

      {/* Tabs — ALL visible so admin knows which features exist; disabled ones
          are greyed out with an "OFF" badge and redirect to settings on click. */}
      <div className="flex flex-wrap gap-1 mb-6 bg-muted/30 p-1 rounded-xl border">
        {TABS.map((tab) => {
          const featureOn = !tab.needs || settings[tab.needs] === 'true' || aiSettings?.[tab.needs] === 'true'
          const isActive = activeTab === tab.key
          const handleClick = () => {
            if (!featureOn) {
              setActiveTab('settings')
              setToast({ type: 'error', text: t3(locale, 'Feature ist deaktiviert — erst einschalten.', 'الميزة معطّلة — قم بتفعيلها أولاً.') })
              setTimeout(() => setToast(null), 2500)
              return
            }
            setActiveTab(tab.key as any)
          }
          return (
            <button
              key={tab.key}
              onClick={handleClick}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-background shadow-sm text-foreground'
                  : featureOn
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-muted-foreground/50 hover:text-muted-foreground'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              {!featureOn && (
                <span className="ms-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600">
                  {t3(locale, 'AUS', 'OFF')}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ═══════ SETTINGS TAB ═══════ */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {/* ═══ Master Switch — clearly elevated above feature cards ═══ */}
          <div className={`relative overflow-hidden rounded-2xl p-5 transition-colors ${
            globalOn
              ? 'bg-gradient-to-br from-[#0f1419] to-[#1a1a2e] text-white'
              : 'bg-muted/30 border-2 border-dashed border-muted-foreground/20'
          }`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  globalOn ? 'bg-[#d4a853]/20' : 'bg-muted-foreground/10'
                }`}>
                  <Power className={`h-5 w-5 ${globalOn ? 'text-[#d4a853]' : 'text-muted-foreground'}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-bold text-base ${globalOn ? 'text-white' : ''}`}>
                      {t3(locale, 'KI Global — Master-Schalter', 'الذكاء الاصطناعي العام — المفتاح الرئيسي')}
                    </p>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      globalOn ? 'bg-[#d4a853] text-[#0f1419]' : 'bg-red-500/10 text-red-600 border border-red-500/20'
                    }`}>
                      {globalOn ? t3(locale, 'Aktiv', 'مفعّل') : t3(locale, 'Deaktiviert', 'معطّل')}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${globalOn ? 'text-white/60' : 'text-muted-foreground'}`}>
                    {globalOn
                      ? t3(locale, 'Einzelne Features können unten an/aus geschaltet werden.', 'يمكن تفعيل/تعطيل الميزات الفردية أدناه.')
                      : t3(locale, '⚠️ Alle KI-Features sind deaktiviert. Kein Chatbot, keine Vorschläge, keine Antworten.', '⚠️ جميع ميزات الذكاء الاصطناعي معطّلة. لا روبوت دردشة ولا اقتراحات ولا ردود.')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {justSavedKey === 'ai_global_enabled' && (
                  <span className="flex items-center gap-1 text-[11px] text-[#d4a853] font-semibold animate-in fade-in">
                    <Check className="h-3 w-3" />
                    {t3(locale, 'Gespeichert', 'تم الحفظ')}
                  </span>
                )}
                <button
                  onClick={() => toggleSettingWithFeedback('ai_global_enabled')}
                  className={`w-12 h-7 rounded-full transition-colors ${globalOn ? 'bg-[#d4a853]' : 'bg-muted-foreground/20'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mt-1 ${globalOn ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* ═══ Feature Toggles — unified gold-when-active styling ═══ */}
          {globalOn && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AI_FEATURES.map((f) => {
                const key = `ai_${f.key}_enabled`
                const on = settings[key] === 'true'
                const label = locale === 'ar' ? f.labelAr : locale === 'en' ? f.labelEn : f.label
                const desc = locale === 'ar' ? f.descAr : locale === 'en' ? f.descEn : f.descDe
                const saved = justSavedKey === key
                return (
                  <div
                    key={f.key}
                    className={`relative overflow-hidden bg-background border rounded-2xl p-4 transition-all ${
                      on ? 'border-[#d4a853]/40 shadow-sm' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {/* Left accent bar — gold when active */}
                    <div className={`absolute top-0 bottom-0 ltr:left-0 rtl:right-0 w-1 bg-[#d4a853] transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
                    <div className="relative flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        on ? 'bg-[#d4a853]/15 text-[#d4a853]' : 'bg-muted text-muted-foreground'
                      }`}>
                        <f.icon className="h-[18px] w-[18px]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={`text-sm font-semibold ${on ? '' : 'text-muted-foreground'}`}>{label}</p>
                          {saved && (
                            <span className="flex items-center gap-1 text-[10px] text-[#d4a853] font-semibold animate-in fade-in">
                              <Check className="h-3 w-3" />
                              {t3(locale, 'Gespeichert', 'تم الحفظ')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                      </div>
                      <button
                        onClick={() => toggleSettingWithFeedback(key)}
                        className={`w-10 h-[22px] rounded-full transition-colors flex-shrink-0 ${on ? 'bg-[#d4a853]' : 'bg-muted-foreground/20'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px] ${on ? 'ltr:translate-x-[21px] rtl:-translate-x-[21px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]'}`} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══ Usage Stats — with end-of-month forecast ═══ */}
          {stats && (
            <div className="bg-background border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[#d4a853]" />
                  {t3(locale, 'Nutzung diesen Monat', 'الاستخدام هذا الشهر')}
                </h3>
                {costForecast && (
                  <span className="text-[11px] text-muted-foreground">
                    {t3(locale, `Prognose Monatsende: ~$${costForecast}`, `التوقع نهاية الشهر: ~$${costForecast}`)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{stats.totalRequests}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t3(locale, 'Anfragen', 'الطلبات')}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{(stats.totalTokens / 1000).toFixed(1)}k</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Tokens</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">${stats.estimatedCostUsd}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t3(locale, 'Kosten', 'التكلفة')}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                {t3(
                  locale,
                  'Geschätzte Kosten basierend auf Anthropic/Gemini API-Preisen. Tatsächliche Rechnung kann abweichen.',
                  'التكلفة المقدرة بناءً على أسعار Anthropic/Gemini API. قد تختلف الفاتورة الفعلية.',
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══════ ADMIN ASSISTANT TAB ═══════ */}
      {activeTab === 'assistant' && (
        <div className="bg-background border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4">{t3(locale, 'Frage an den KI-Assistenten', 'اسأل مساعد الذكاء الاصطناعي')}</h3>
          <div className="flex gap-2 mb-4">
            <input value={assistantInput} onChange={(e) => setAssistantInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') assistantMut.mutate(assistantInput) }}
              placeholder={t3(locale, 'z.B. Welches Produkt hat den höchsten Umsatz?', 'مثال: ما هو المنتج الأعلى مبيعات؟')}
              className="flex-1 h-10 px-3 rounded-xl border bg-background text-sm" />
            <Button onClick={() => assistantMut.mutate(assistantInput)} disabled={assistantMut.isPending || !assistantInput.trim()} className="gap-1.5 rounded-xl bg-[#8b5cf6] hover:bg-[#7c3aed]">
              {assistantMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {assistantResponse && (
            <div className="bg-muted/30 rounded-xl p-4 text-sm whitespace-pre-wrap">{assistantResponse}</div>
          )}
        </div>
      )}

      {/* ═══════ PRODUCT DESCRIPTION TAB ═══════ */}
      {activeTab === 'products' && (
        <div className="bg-background border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4">{t3(locale, 'Produktbeschreibung generieren', 'إنشاء وصف المنتج')}</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <input value={pdName} onChange={(e) => setPdName(e.target.value)} placeholder={t3(locale, 'Produktname', 'اسم المنتج')} className="h-10 px-3 rounded-xl border bg-background text-sm" />
            <input value={pdCategory} onChange={(e) => setPdCategory(e.target.value)} placeholder={t3(locale, 'Kategorie (optional)', 'الفئة (اختياري)')} className="h-10 px-3 rounded-xl border bg-background text-sm" />
          </div>
          <Button onClick={() => pdMut.mutate()} disabled={pdMut.isPending || !pdName.trim()} className="gap-1.5 rounded-xl bg-[#d4a853] hover:bg-[#c49b4a] text-black mb-4">
            {pdMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {t3(locale, 'Generieren', 'إنشاء')}
          </Button>
          {pdResult && (
            <div className="space-y-3">
              {(['de', 'ar', 'en'] as const).map((lang) => (
                <div key={lang} className="bg-muted/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase text-muted-foreground">{lang.toUpperCase()}</span>
                    <button onClick={() => { navigator.clipboard.writeText(pdResult[lang]); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="p-1 hover:bg-muted rounded">
                      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                  <p className="text-sm" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{pdResult[lang]}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ INVENTORY TAB ═══════ */}
      {activeTab === 'inventory' && (
        <div className="bg-background border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm">{t3(locale, 'KI-Inventar-Empfehlungen', 'توصيات المخزون')}</h3>
            <Button size="sm" onClick={() => invMut.mutate()} disabled={invMut.isPending} className="gap-1.5 rounded-xl">
              {invMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t3(locale, 'Aktualisieren', 'تحديث')}
            </Button>
          </div>
          {invResult ? <div className="bg-muted/30 rounded-xl p-4 text-sm whitespace-pre-wrap">{invResult}</div>
            : <p className="text-sm text-muted-foreground py-8 text-center">{t3(locale, 'Klicke "Aktualisieren" für neue Empfehlungen', 'اضغط "تحديث" للحصول على توصيات جديدة')}</p>}
        </div>
      )}

      {/* ═══════ MARKETING TAB ═══════ */}
      {activeTab === 'marketing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── LEFT: Setup ──────────────────────────────── */}
          <div className="bg-background border rounded-2xl p-5 space-y-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-[#0f1419]/5 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[#d4a853]" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">{t3(locale, 'Marketing-Studio', 'استوديو التسويق')}</h3>
                <p className="text-xs text-muted-foreground">{t3(locale, '3 Varianten in bis zu 3 Sprachen', '3 خيارات بحتى 3 لغات')}</p>
              </div>
            </div>

            {/* Format picker */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Format', 'التنسيق')}</label>
              <div className="grid grid-cols-5 gap-1.5">
                {([
                  { key: 'hero', icon: Megaphone, de: 'Hero-Banner', en: 'Hero', ar: 'بانر' },
                  { key: 'popup', icon: MessageSquare, de: 'Popup', en: 'Popup', ar: 'نافذة' },
                  { key: 'bar', icon: ScrollText, de: 'Leiste', en: 'Bar', ar: 'شريط' },
                  { key: 'newsletter', icon: FileText, de: 'Newsletter', en: 'Email', ar: 'نشرة' },
                  { key: 'social', icon: MessageCircle, de: 'Social', en: 'Social', ar: 'شبكات' },
                ] as const).map((f) => {
                  const Icon = f.icon
                  const active = mktFormat === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setMktFormat(f.key)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all text-[11px] font-medium ${
                        active ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#0f1419]' : 'border-border hover:border-[#0f1419]/30 text-muted-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {locale === 'ar' ? f.ar : locale === 'en' ? f.en : f.de}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Occasion */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Anlass', 'المناسبة')}</label>
              <input
                value={mktOccasion}
                onChange={(e) => setMktOccasion(e.target.value)}
                placeholder={t3(locale, 'z.B. Sommer-Sale, Black Friday, Neue Kollektion', 'مثال: تخفيضات الصيف، جمعة سوداء')}
                className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20 focus:border-[#d4a853]"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  { de: 'Sommer-Sale', en: 'Summer Sale', ar: 'تخفيضات الصيف' },
                  { de: 'Black Friday', en: 'Black Friday', ar: 'الجمعة السوداء' },
                  { de: 'Neue Kollektion', en: 'New Collection', ar: 'مجموعة جديدة' },
                  { de: 'Restocking', en: 'Restocking', ar: 'إعادة تزويد' },
                  { de: 'Ramadan-Aktion', en: 'Ramadan Deal', ar: 'عرض رمضان' },
                ].map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setMktOccasion(locale === 'ar' ? q.ar : locale === 'en' ? q.en : q.de)}
                    className="px-2.5 py-1 rounded-full border text-[11px] text-muted-foreground hover:text-foreground hover:border-[#0f1419]/40 hover:bg-muted/50 transition-all"
                  >
                    {locale === 'ar' ? q.ar : locale === 'en' ? q.en : q.de}
                  </button>
                ))}
              </div>
            </div>

            {/* Target + Tone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Zielgruppe', 'الفئة المستهدفة')}</label>
                <select
                  value={mktTarget}
                  onChange={(e) => setMktTarget(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20"
                >
                  <option value="all">{t3(locale, 'Alle', 'الجميع')}</option>
                  <option value="men">{t3(locale, 'Herren', 'رجال')}</option>
                  <option value="women">{t3(locale, 'Damen', 'نساء')}</option>
                  <option value="kids">{t3(locale, 'Kinder', 'أطفال')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Tonalität', 'النبرة')}</label>
                <select
                  value={mktTone}
                  onChange={(e) => setMktTone(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20"
                >
                  <option value="elegant">{t3(locale, 'Elegant', 'أنيق')}</option>
                  <option value="playful">{t3(locale, 'Verspielt', 'مرح')}</option>
                  <option value="urgent">{t3(locale, 'Dringlich', 'عاجل')}</option>
                  <option value="luxury">{t3(locale, 'Luxuriös', 'فاخر')}</option>
                  <option value="seasonal">{t3(locale, 'Saisonal', 'موسمي')}</option>
                </select>
              </div>
            </div>

            {/* Discount + ValidUntil */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Rabatt (optional)', 'خصم (اختياري)')}</label>
                <input
                  value={mktDiscount}
                  onChange={(e) => setMktDiscount(e.target.value)}
                  placeholder={t3(locale, 'z.B. 20% oder 15 EUR', 'مثال: 20% أو 15€')}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Gültig bis (optional)', 'ساري حتى (اختياري)')}</label>
                <input
                  type="date"
                  value={mktValidUntil}
                  onChange={(e) => setMktValidUntil(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20"
                />
              </div>
            </div>

            {/* Languages */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Sprachen', 'اللغات')}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { key: 'de', label: 'Deutsch', flag: '🇩🇪' },
                  { key: 'en', label: 'English', flag: '🇬🇧' },
                  { key: 'ar', label: 'العربية', flag: '🇸🇦' },
                ] as const).map((l) => {
                  const active = mktLanguages.includes(l.key)
                  const toggle = () => {
                    setMktLanguages((prev) => {
                      if (active) {
                        // never go below 1 language
                        if (prev.length <= 1) return prev
                        return prev.filter(x => x !== l.key)
                      }
                      return [...prev, l.key]
                    })
                  }
                  return (
                    <button
                      key={l.key}
                      type="button"
                      onClick={toggle}
                      className={`py-2 px-1 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                        active ? 'border-[#d4a853] bg-[#d4a853]/10' : 'border-border hover:border-[#0f1419]/30 text-muted-foreground'
                      }`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                      {active && <Check className="h-3 w-3 text-[#d4a853]" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Generate */}
            <Button
              onClick={() => mktMut.mutate()}
              disabled={mktMut.isPending || !mktOccasion.trim() || mktLanguages.length === 0}
              className="w-full h-11 gap-2 rounded-xl bg-[#0f1419] hover:bg-[#1a1a2e] text-white font-medium"
            >
              {mktMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t3(locale, 'KI generiert...', 'الذكاء الاصطناعي يولّد...')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-[#d4a853]" />
                  {t3(locale, '3 Varianten generieren', 'إنشاء 3 خيارات')}
                </>
              )}
            </Button>
          </div>

          {/* ─── RIGHT: Output ───────────────────────────── */}
          <div className="bg-background border rounded-2xl p-5 space-y-4">
            {!mktMut.isPending && (!mktResult || !mktResult.variants) ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground py-12">
                <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                  <Megaphone className="h-7 w-7 opacity-40" />
                </div>
                <p className="text-sm font-medium mb-1">{t3(locale, 'Noch keine Texte', 'لا توجد نصوص بعد')}</p>
                <p className="text-xs max-w-xs">{t3(locale, 'Wähle Format + Anlass links und klicke "Generieren".', 'اختر التنسيق والمناسبة على اليسار ثم اضغط "إنشاء".')}</p>
              </div>
            ) : mktMut.isPending ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#d4a853] mb-3" />
                <p className="text-sm text-muted-foreground">{t3(locale, '3 Varianten werden generiert...', 'جاري إنشاء 3 خيارات...')}</p>
              </div>
            ) : mktResult && mktResult.variants && (
              <>
                {/* Language tabs */}
                {mktResult.languages && mktResult.languages.length > 1 && (
                  <div className="flex gap-1 p-1 bg-muted/30 rounded-xl border">
                    {mktResult.languages.map((l: MktLang) => {
                      const active = mktActiveLang === l
                      const flag = l === 'de' ? '🇩🇪' : l === 'en' ? '🇬🇧' : '🇸🇦'
                      const label = l === 'de' ? 'Deutsch' : l === 'en' ? 'English' : 'العربية'
                      return (
                        <button
                          key={l}
                          onClick={() => setMktActiveLang(l)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                            active ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <span>{flag}</span>
                          <span>{label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Variants */}
                <div className="space-y-3">
                  {(mktResult.variants as Array<Record<string, Record<string, string>>>).map((v, i) => {
                    const langData = v[mktActiveLang] ?? v[mktResult.languages[0] as MktLang] ?? {}
                    const isRtl = mktActiveLang === 'ar'
                    return (
                      <div key={i} className="border-2 border-border hover:border-[#d4a853]/40 rounded-xl p-4 transition-all">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="h-6 w-6 rounded-full bg-[#0f1419] text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="text-xs font-semibold text-muted-foreground">{t3(locale, `Variante ${i + 1}`, `الخيار ${i + 1}`)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const allText = Object.values(langData).filter(Boolean).join('\n\n')
                                navigator.clipboard.writeText(allText)
                                const k = `copy-${i}`
                                setMktCopiedKey(k)
                                setTimeout(() => setMktCopiedKey(null), 1500)
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-[#0f1419]/40 transition-all"
                            >
                              {mktCopiedKey === `copy-${i}` ? (
                                <><Check className="h-3.5 w-3.5 text-emerald-600" /> {t3(locale, 'Kopiert', 'تم النسخ')}</>
                              ) : (
                                <><Copy className="h-3.5 w-3.5" /> {t3(locale, 'Kopieren', 'نسخ')}</>
                              )}
                            </button>
                            {/* Only show campaign-insert for formats that map to campaign fields */}
                            {['hero', 'popup', 'bar'].includes(mktResult.format) && (
                              <button
                                onClick={() => {
                                  // Build prefill payload with ALL languages (not just active tab)
                                  try {
                                    const prefill: Record<string, any> = {
                                      format: mktResult.format,
                                      occasion: mktOccasion,
                                      variant: v, // { de: {headline, subtitle, cta}, en: {...}, ar: {...} }
                                    }
                                    sessionStorage.setItem('campaign-prefill', JSON.stringify(prefill))
                                    router.push(`/${locale}/admin/campaigns?autoOpen=1`)
                                  } catch {
                                    setToast({ type: 'error', text: t3(locale, 'Übertragung fehlgeschlagen', 'فشل النقل') })
                                    setTimeout(() => setToast(null), 2000)
                                  }
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#d4a853]/10 text-[#0f1419] border border-[#d4a853]/40 text-xs font-medium hover:bg-[#d4a853]/20 transition-all"
                              >
                                <Megaphone className="h-3.5 w-3.5" />
                                {t3(locale, 'In Kampagne', 'إلى حملة')}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
                          {Object.entries(langData).map(([fieldKey, fieldValue]) => (
                            <div key={fieldKey}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {fieldKey}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">{String(fieldValue).length}</span>
                              </div>
                              <p className="text-sm leading-relaxed bg-muted/20 rounded-lg px-3 py-2">{fieldValue || '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ SOCIAL MEDIA TAB ═══════ */}
      {activeTab === 'social' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── LEFT: Input Panel ─────────────────────────── */}
          <div className="bg-background border rounded-2xl p-5 space-y-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-[#0f1419]/5 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[#d4a853]" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">{t3(locale, 'Kundennachricht', 'رسالة العميل')}</h3>
                <p className="text-xs text-muted-foreground">{t3(locale, 'KI generiert 3 Varianten', 'الذكاء الاصطناعي يُنشئ 3 خيارات')}</p>
              </div>
            </div>

            {/* Platform picker */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Plattform', 'المنصة')}</label>
              <div className="grid grid-cols-5 gap-1.5">
                {([
                  { key: 'instagram', icon: Instagram, label: 'Instagram' },
                  { key: 'facebook', icon: Facebook, label: 'Facebook' },
                  { key: 'tiktok', icon: MessageCircle, label: 'TikTok' },
                  { key: 'whatsapp', icon: MessageSquare, label: 'WhatsApp' },
                  { key: 'review', icon: Star, label: t3(locale, 'Review', 'تقييم') },
                ] as const).map((p) => {
                  const Icon = p.icon
                  const active = socialPlatform === p.key
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setSocialPlatform(p.key)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all text-[11px] font-medium ${
                        active ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#0f1419]' : 'border-border hover:border-[#0f1419]/30 text-muted-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Tone picker */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Tonalität', 'النبرة')}</label>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { key: 'friendly', de: 'Freundlich', en: 'Friendly', ar: 'ودود' },
                  { key: 'professional', de: 'Professionell', en: 'Professional', ar: 'احترافي' },
                  { key: 'apologetic', de: 'Entschuldigend', en: 'Apologetic', ar: 'اعتذاري' },
                  { key: 'grateful', de: 'Dankend', en: 'Grateful', ar: 'شاكر' },
                ] as const).map((t) => {
                  const active = socialTone === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setSocialTone(t.key)}
                      className={`py-2 rounded-xl border text-[11px] font-medium transition-all ${
                        active ? 'border-[#0f1419] bg-[#0f1419] text-white' : 'border-border hover:border-[#0f1419]/40 text-muted-foreground'
                      }`}
                    >
                      {locale === 'ar' ? t.ar : locale === 'en' ? t.en : t.de}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Language picker — Auto-detect by default, explicit override available */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Antwort-Sprache', 'لغة الرد')}</label>
              {/* Primary row: Auto + 3 main languages */}
              <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                {([
                  { key: 'auto', labelDe: 'Auto', labelEn: 'Auto', labelAr: 'تلقائي', icon: '✨' },
                  { key: 'de', labelDe: 'Deutsch', labelEn: 'German', labelAr: 'ألمانية', icon: '🇩🇪' },
                  { key: 'en', labelDe: 'English', labelEn: 'English', labelAr: 'إنجليزية', icon: '🇬🇧' },
                  { key: 'ar', labelDe: 'Arabisch', labelEn: 'Arabic', labelAr: 'عربية', icon: '🇸🇦' },
                ] as const).map((l) => {
                  const active = socialLang === l.key
                  return (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => setSocialLang(l.key)}
                      className={`py-2 px-1 rounded-xl border text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
                        active ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#0f1419]' : 'border-border hover:border-[#0f1419]/30 text-muted-foreground'
                      }`}
                    >
                      <span>{l.icon}</span>
                      <span className="truncate">{locale === 'ar' ? l.labelAr : locale === 'en' ? l.labelEn : l.labelDe}</span>
                    </button>
                  )
                })}
              </div>
              {/* "More languages" row — expandable */}
              {!socialShowMoreLangs && !['fr','es','it','tr','nl','pt','ru','pl'].includes(socialLang) && (
                <button
                  type="button"
                  onClick={() => setSocialShowMoreLangs(true)}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {t3(locale, '+ Weitere Sprachen', '+ لغات أخرى')}
                </button>
              )}
              {(socialShowMoreLangs || ['fr','es','it','tr','nl','pt','ru','pl'].includes(socialLang)) && (
                <div className="grid grid-cols-4 gap-1.5">
                  {([
                    { key: 'fr', label: 'Français', icon: '🇫🇷' },
                    { key: 'es', label: 'Español', icon: '🇪🇸' },
                    { key: 'it', label: 'Italiano', icon: '🇮🇹' },
                    { key: 'tr', label: 'Türkçe', icon: '🇹🇷' },
                    { key: 'nl', label: 'Nederlands', icon: '🇳🇱' },
                    { key: 'pt', label: 'Português', icon: '🇵🇹' },
                    { key: 'ru', label: 'Русский', icon: '🇷🇺' },
                    { key: 'pl', label: 'Polski', icon: '🇵🇱' },
                  ] as const).map((l) => {
                    const active = socialLang === l.key
                    return (
                      <button
                        key={l.key}
                        type="button"
                        onClick={() => setSocialLang(l.key)}
                        className={`py-2 px-1 rounded-xl border text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
                          active ? 'border-[#d4a853] bg-[#d4a853]/10 text-[#0f1419]' : 'border-border hover:border-[#0f1419]/30 text-muted-foreground'
                        }`}
                      >
                        <span>{l.icon}</span>
                        <span className="truncate">{l.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Customer message textarea */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t3(locale, 'Nachricht', 'الرسالة')}</label>
                <span className="text-[11px] text-muted-foreground tabular-nums">{socialMsg.length} / 2000</span>
              </div>
              <textarea
                value={socialMsg}
                onChange={(e) => setSocialMsg(e.target.value.slice(0, 2000))}
                placeholder={t3(locale, 'Kundennachricht einfügen oder Vorlage wählen...', 'الصق رسالة العميل أو اختر قالب...')}
                className="w-full h-32 px-3 py-2.5 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#d4a853]/20 focus:border-[#d4a853]"
              />
            </div>

            {/* Quick templates */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block uppercase tracking-wider">{t3(locale, 'Vorlagen', 'القوالب')}</label>
              <div className="flex flex-wrap gap-1.5">
                {socialTemplates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSocialMsg(t.msg)}
                    className="px-3 py-1.5 rounded-full border text-[11px] text-muted-foreground hover:text-foreground hover:border-[#0f1419]/40 hover:bg-muted/50 transition-all"
                  >
                    {locale === 'ar' ? t.labelAr : locale === 'en' ? t.labelEn : t.labelDe}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <Button
              onClick={() => socialMut.mutate()}
              disabled={socialMut.isPending || !socialMsg.trim()}
              className="w-full h-11 gap-2 rounded-xl bg-[#0f1419] hover:bg-[#1a1a2e] text-white font-medium"
            >
              {socialMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t3(locale, 'KI generiert...', 'الذكاء الاصطناعي يولّد...')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-[#d4a853]" />
                  {t3(locale, '3 Antworten generieren', 'إنشاء 3 ردود')}
                </>
              )}
            </Button>
          </div>

          {/* ─── RIGHT: Output Panel ───────────────────────── */}
          <div className="bg-background border rounded-2xl p-5 space-y-4">
            {!socialMut.isPending && socialVariants.length === 0 ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center text-muted-foreground py-12">
                <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                  <MessageSquare className="h-7 w-7 opacity-40" />
                </div>
                <p className="text-sm font-medium mb-1">{t3(locale, 'Noch keine Antworten', 'لا توجد ردود بعد')}</p>
                <p className="text-xs max-w-xs">{t3(locale, 'Füge eine Kundennachricht ein und klicke "Generieren".', 'أدخل رسالة العميل واضغط "إنشاء".')}</p>
              </div>
            ) : socialMut.isPending ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#d4a853] mb-3" />
                <p className="text-sm text-muted-foreground">{t3(locale, '3 Varianten werden generiert...', 'جاري إنشاء 3 خيارات...')}</p>
              </div>
            ) : (
              <>
                {/* Sentiment badge */}
                {socialSentiment && (() => {
                  const map = {
                    positive: { Icon: Smile, de: 'Positive Stimmung', en: 'Positive sentiment', ar: 'شعور إيجابي', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    neutral: { Icon: Meh, de: 'Neutrale Stimmung', en: 'Neutral sentiment', ar: 'شعور محايد', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
                    negative: { Icon: Frown, de: 'Negative Stimmung', en: 'Negative sentiment', ar: 'شعور سلبي', cls: 'bg-red-50 text-red-700 border-red-200' },
                    question: { Icon: HelpCircle, de: 'Frage', en: 'Question', ar: 'سؤال', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
                  }
                  const s = map[socialSentiment]
                  const Icon = s.Icon
                  return (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${s.cls}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {locale === 'ar' ? s.ar : locale === 'en' ? s.en : s.de}
                    </div>
                  )
                })()}

                {/* Variants */}
                <div className="space-y-3">
                  {socialVariants.map((v, i) => (
                    <div key={i} className="border-2 border-border hover:border-[#d4a853]/40 rounded-xl p-4 transition-all group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="h-6 w-6 rounded-full bg-[#0f1419] text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span className="text-xs font-semibold text-muted-foreground">{t3(locale, `Variante ${i + 1}`, `الخيار ${i + 1}`)}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{v.length} {t3(locale, 'Zeichen', 'حرف')}</span>
                      </div>
                      <p className="text-sm leading-relaxed mb-3" dir={socialLang === 'ar' ? 'rtl' : 'auto'}>{v}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(v)
                            setSocialCopiedIdx(i)
                            setTimeout(() => setSocialCopiedIdx(null), 1500)
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-[#0f1419]/40 transition-all"
                        >
                          {socialCopiedIdx === i ? (
                            <><Check className="h-3.5 w-3.5 text-emerald-600" /> {t3(locale, 'Kopiert', 'تم النسخ')}</>
                          ) : (
                            <><Copy className="h-3.5 w-3.5" /> {t3(locale, 'Kopieren', 'نسخ')}</>
                          )}
                        </button>
                        {socialPlatform === 'facebook' && (
                          <button
                            disabled
                            title={t3(locale, 'Facebook-Seite zuerst in Einstellungen verbinden (bald verfügbar)', 'قم بربط صفحة فيسبوك أولاً في الإعدادات (قريباً)')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1877f2]/10 text-[#1877f2] border border-[#1877f2]/20 text-xs font-medium opacity-50 cursor-not-allowed"
                          >
                            <Facebook className="h-3.5 w-3.5" />
                            {t3(locale, 'Auf Facebook antworten', 'الرد على فيسبوك')}
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* History */}
                {socialHistory.length > 0 && (
                  <div className="pt-4 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <History className="h-3.5 w-3.5" />
                        {t3(locale, 'Letzte Anfragen', 'آخر الطلبات')}
                      </div>
                      <button
                        onClick={() => {
                          setSocialHistory([])
                          try { localStorage.removeItem('admin-ai-social-history') } catch { /* ignore */ }
                        }}
                        className="text-[11px] text-red-600 hover:text-red-700 flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t3(locale, 'Löschen', 'حذف')}
                      </button>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {socialHistory.slice(0, 5).map((h, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSocialMsg(h.msg)
                            setSocialVariants(h.variants)
                            setSocialPlatform(h.platform as any)
                          }}
                          className="w-full text-start px-3 py-2 rounded-lg border border-border hover:border-[#0f1419]/30 hover:bg-muted/30 transition-all text-xs"
                        >
                          <p className="truncate text-foreground">{h.msg}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(h.ts).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {h.platform}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ LOGS TAB ═══════ */}
      {activeTab === 'logs' && (
        <div className="bg-background border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b bg-muted/20 flex items-center justify-between">
            <h3 className="font-semibold text-sm">{t3(locale, 'KI-Logs', 'سجلات الذكاء الاصطناعي')}</h3>
            {(logs?.data ?? []).length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg text-red-600 border-red-200 hover:bg-red-50"
                onClick={async () => {
                  if (!confirm(t3(locale, 'Alle Logs löschen?', 'حذف جميع السجلات؟'))) return
                  await api.delete('/admin/ai/logs')
                  qc.invalidateQueries({ queryKey: ['ai-logs'] })
                  setToast({ type: 'success', text: t3(locale, 'Logs gelöscht', 'تم حذف السجلات') })
                  setTimeout(() => setToast(null), 2000)
                }}>
                {t3(locale, 'Alle löschen', 'حذف الكل')}
              </Button>
            )}
          </div>
          <div className="divide-y">
            {(logs?.data ?? []).map((log: any) => (
              <div key={log.id} className="px-5 py-3 text-xs group hover:bg-muted/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium px-2 py-0.5 rounded-full bg-muted">{log.type}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')}</span>
                    <button className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity p-1"
                      onClick={async () => {
                        await api.delete(`/admin/ai/logs/${log.id}`)
                        qc.invalidateQueries({ queryKey: ['ai-logs'] })
                      }}
                      title={t3(locale, 'Löschen', 'حذف')}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p className="text-muted-foreground truncate">{log.prompt.slice(0, 100)}...</p>
                <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span>{log.provider}</span>
                  <span>{log.tokensIn + log.tokensOut} tokens</span>
                  <span>{log.latencyMs}ms</span>
                </div>
              </div>
            ))}
            {(logs?.data ?? []).length === 0 && <p className="px-5 py-8 text-sm text-muted-foreground text-center">{t3(locale, 'Keine Logs vorhanden', 'لا توجد سجلات')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
