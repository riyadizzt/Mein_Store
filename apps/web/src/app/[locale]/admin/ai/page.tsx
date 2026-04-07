'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bot, MessageCircle, FileText, Package, Megaphone, MessageSquare,
  Power, Loader2, Send, Copy, Check, BarChart3, ScrollText,
  RefreshCw, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d

const AI_FEATURES = [
  { key: 'customer_chat', icon: MessageCircle, label: 'Kunden-Chatbot', labelAr: 'روبوت الدردشة', color: '#3b82f6' },
  { key: 'admin_assistant', icon: Bot, label: 'Admin-Assistent', labelAr: 'مساعد المشرف', color: '#8b5cf6' },
  { key: 'product_description', icon: FileText, label: 'Produktbeschreibung', labelAr: 'وصف المنتج', color: '#d4a853' },
  { key: 'inventory_suggestions', icon: Package, label: 'Inventar-Vorschläge', labelAr: 'اقتراحات المخزون', color: '#10b981' },
  { key: 'marketing_text', icon: Megaphone, label: 'Marketing-Texte', labelAr: 'نصوص تسويقية', color: '#f59e0b' },
  { key: 'social_reply', icon: MessageSquare, label: 'Social Media Antworten', labelAr: 'ردود وسائل التواصل', color: '#ec4899' },
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
    mutationFn: async () => { const { data } = await api.post('/admin/ai/inventory-suggestions'); return data },
    onSuccess: (data) => setInvResult(data.suggestions),
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Analyse', 'خطأ في التحليل') }),
  })

  // Marketing
  const [mktOccasion, setMktOccasion] = useState('')
  const [mktResult, setMktResult] = useState<any>(null)
  const mktMut = useMutation({
    mutationFn: async () => { const { data } = await api.post('/admin/ai/generate-marketing-text', { occasion: mktOccasion }); return data },
    onSuccess: (data) => setMktResult(data),
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Generierung', 'خطأ في الإنشاء') }),
  })

  // Social Reply
  const [socialMsg, setSocialMsg] = useState('')
  const [socialPlatform, setSocialPlatform] = useState('instagram')
  const [socialResult, setSocialResult] = useState('')
  const socialMut = useMutation({
    mutationFn: async () => { const { data } = await api.post('/admin/ai/social-reply', { customerMessage: socialMsg, platform: socialPlatform }); return data },
    onSuccess: (data) => setSocialResult(data.reply),
    onError: () => setToast({ type: 'error', text: t3(locale, 'Fehler bei der Generierung', 'خطأ في الإنشاء') }),
  })

  // Logs
  const { data: logs } = useQuery({
    queryKey: ['ai-logs', activeTab],
    queryFn: async () => { const { data } = await api.get('/admin/ai/logs', { params: { limit: 30 } }); return data },
    enabled: activeTab === 'logs',
  })

  const globalOn = settings.ai_global_enabled === 'true'

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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-muted/30 p-1 rounded-xl border">
        {TABS.filter((tab) => !tab.needs || settings[tab.needs] === 'true' || aiSettings?.[tab.needs] === 'true' || tab.key === 'settings' || tab.key === 'logs').map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === tab.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <tab.icon className="h-3.5 w-3.5" />{tab.label}
          </button>
        ))}
      </div>

      {/* ═══════ SETTINGS TAB ═══════ */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Global Toggle */}
          <div className={`bg-background border rounded-2xl p-5 ${globalOn ? 'border-green-500/30' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${globalOn ? 'bg-green-500/10' : 'bg-muted'}`}>
                  <Power className={`h-5 w-5 ${globalOn ? 'text-green-500' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <p className="font-semibold text-sm">{t3(locale, 'KI Global', 'الذكاء الاصطناعي العام')}</p>
                  <p className="text-xs text-muted-foreground">{t3(locale, 'Schaltet alle KI-Funktionen ein/aus', 'تشغيل/إيقاف جميع وظائف الذكاء الاصطناعي')}</p>
                </div>
              </div>
              <button onClick={() => toggleSetting('ai_global_enabled')} className={`w-11 h-6 rounded-full transition-colors ${globalOn ? 'bg-green-500' : 'bg-muted'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mt-[4px] ${globalOn ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* Feature Toggles */}
          {globalOn && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AI_FEATURES.map((f) => {
                const key = `ai_${f.key}_enabled`
                const on = settings[key] === 'true'
                return (
                  <div key={f.key} className="relative overflow-hidden bg-background border rounded-2xl p-4 transition-all">
                    <div className={`absolute top-0 bottom-0 ltr:left-0 rtl:right-0 w-1 transition-all ${on ? '' : 'opacity-0'}`} style={{ backgroundColor: f.color }} />
                    <div className={`absolute inset-0 bg-white/60 dark:bg-[#1a1a2e]/60 pointer-events-none transition-opacity ${on ? 'opacity-0' : 'opacity-100'}`} style={{ zIndex: 1 }} />
                    <div className="relative flex items-center gap-3" style={{ zIndex: 2 }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: on ? f.color + '15' : undefined, color: on ? f.color : undefined }}>
                        <f.icon className="h-[18px] w-[18px]" />
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${on ? '' : 'text-muted-foreground'}`}>{locale === 'ar' ? f.labelAr : f.label}</p>
                      </div>
                      <button onClick={() => toggleSetting(key)} className={`w-10 h-[22px] rounded-full transition-colors`} style={{ backgroundColor: on ? f.color : 'hsl(var(--muted))' }}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px] ${on ? 'ltr:translate-x-[21px] rtl:-translate-x-[21px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]'}`} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="bg-background border rounded-2xl p-5">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4" />{t3(locale, 'Nutzung diesen Monat', 'الاستخدام هذا الشهر')}</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xl font-bold tabular-nums">{stats.totalRequests}</p>
                  <p className="text-[10px] text-muted-foreground">{t3(locale, 'Anfragen', 'الطلبات')}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xl font-bold tabular-nums">{(stats.totalTokens / 1000).toFixed(1)}k</p>
                  <p className="text-[10px] text-muted-foreground">Tokens</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xl font-bold tabular-nums">${stats.estimatedCostUsd}</p>
                  <p className="text-[10px] text-muted-foreground">{t3(locale, 'Geschätzte Kosten', 'التكلفة المقدرة')}</p>
                </div>
              </div>
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
        <div className="bg-background border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4">{t3(locale, 'Marketing-Text generieren', 'إنشاء نص تسويقي')}</h3>
          <input value={mktOccasion} onChange={(e) => setMktOccasion(e.target.value)} placeholder={t3(locale, 'Anlass (z.B. Sommersale, neue Kollektion)', 'المناسبة (مثال: تخفيضات الصيف)')} className="w-full h-10 px-3 rounded-xl border bg-background text-sm mb-3" />
          <Button onClick={() => mktMut.mutate()} disabled={mktMut.isPending || !mktOccasion.trim()} className="gap-1.5 rounded-xl bg-[#f59e0b] hover:bg-[#d97706] text-black mb-4">
            {mktMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            {t3(locale, 'Generieren', 'إنشاء')}
          </Button>
          {mktResult && (
            <div className="space-y-3">
              <div className="bg-muted/30 rounded-xl p-4"><p className="text-xs text-muted-foreground mb-1">{t3(locale, 'Betreff DE', 'الموضوع بالألمانية')}</p><p className="text-sm font-medium">{mktResult.subjectDe}</p></div>
              <div className="bg-muted/30 rounded-xl p-4"><p className="text-xs text-muted-foreground mb-1">{t3(locale, 'Betreff AR', 'الموضوع بالعربية')}</p><p className="text-sm font-medium" dir="rtl">{mktResult.subjectAr}</p></div>
              <div className="bg-muted/30 rounded-xl p-4"><p className="text-xs text-muted-foreground mb-1">{t3(locale, 'Text DE', 'النص بالألمانية')}</p><p className="text-sm">{mktResult.bodyDe}</p></div>
              <div className="bg-muted/30 rounded-xl p-4"><p className="text-xs text-muted-foreground mb-1">{t3(locale, 'Text AR', 'النص بالعربية')}</p><p className="text-sm" dir="rtl">{mktResult.bodyAr}</p></div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ SOCIAL MEDIA TAB ═══════ */}
      {activeTab === 'social' && (
        <div className="bg-background border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4">{t3(locale, 'Social Media Antwort generieren', 'إنشاء رد وسائل التواصل')}</h3>
          <div className="flex gap-2 mb-3">
            <select value={socialPlatform} onChange={(e) => setSocialPlatform(e.target.value)} className="h-10 px-3 rounded-xl border bg-background text-sm">
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="tiktok">TikTok</option>
            </select>
            <textarea value={socialMsg} onChange={(e) => setSocialMsg(e.target.value)} placeholder={t3(locale, 'Kundennachricht einfügen...', 'الصق رسالة العميل...')} className="flex-1 h-20 px-3 py-2 rounded-xl border bg-background text-sm resize-none" />
          </div>
          <Button onClick={() => socialMut.mutate()} disabled={socialMut.isPending || !socialMsg.trim()} className="gap-1.5 rounded-xl bg-[#ec4899] hover:bg-[#db2777] mb-4">
            {socialMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            {t3(locale, 'Antwort generieren', 'إنشاء الرد')}
          </Button>
          {socialResult && (
            <div className="bg-muted/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-muted-foreground">{socialPlatform.toUpperCase()}</span>
                <button onClick={() => { navigator.clipboard.writeText(socialResult); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {t3(locale, 'Kopieren', 'نسخ')}
                </button>
              </div>
              <p className="text-sm">{socialResult}</p>
            </div>
          )}
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
