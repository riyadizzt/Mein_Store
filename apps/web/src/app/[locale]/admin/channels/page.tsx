'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Globe, ShoppingBag, MessageCircle, Copy, RefreshCw, ExternalLink,
  Check, ChevronDown, Power, TrendingUp, Package, Clock,
  AlertTriangle, Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d

// ── Channel Config ──────────────────────────────────────────────
interface ChannelDef {
  id: string
  name: string
  nameAr: string
  icon: React.ReactNode
  iconBg: string
  color: string
  settingsKey: string
  feedUrl?: (apiUrl: string, token: string) => string
  pixelKey?: string
  pixelLabel?: string
}

const CHANNELS: ChannelDef[] = [
  {
    id: 'facebook', name: 'Facebook / Instagram', nameAr: 'فيسبوك / إنستجرام',
    icon: <span className="text-blue-500 font-bold text-lg">f</span>,
    iconBg: 'bg-blue-500/10', color: 'blue',
    settingsKey: 'channel_facebook_enabled',
    feedUrl: (api, token) => `${api}/api/v1/feeds/facebook?token=${token}`,
    pixelKey: 'meta_pixel_id', pixelLabel: 'Meta Pixel ID',
  },
  {
    id: 'tiktok', name: 'TikTok Shop', nameAr: 'تيك توك شوب',
    icon: <span className="font-bold text-lg">♪</span>,
    iconBg: 'bg-black/10 dark:bg-white/10', color: 'purple',
    settingsKey: 'channel_tiktok_enabled',
    feedUrl: (api, token) => `${api}/api/v1/feeds/tiktok?token=${token}`,
    pixelKey: 'tiktok_pixel_id', pixelLabel: 'TikTok Pixel ID',
  },
  {
    id: 'google', name: 'Google Shopping', nameAr: 'جوجل شوبينج',
    icon: <span className="text-red-500 font-bold text-lg">G</span>,
    iconBg: 'bg-red-500/10', color: 'red',
    settingsKey: 'channel_google_enabled',
    feedUrl: (api, token) => `${api}/api/v1/feeds/google?token=${token}`,
  },
]

export default function ChannelsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const [copied, setCopied] = useState('')
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null)
  const [settings, setSettings] = useState<Record<string, string>>({
    meta_pixel_id: '', tiktok_pixel_id: '',
    whatsapp_number: '', whatsapp_enabled: 'false',
    whatsapp_message_de: 'Hallo! Ich habe eine Frage zu Malak Bekleidung.',
    whatsapp_message_ar: 'مرحبا! عندي سؤال عن ملك بيكلايدونغ',
    channel_facebook_enabled: 'false',
    channel_tiktok_enabled: 'false',
    channel_google_enabled: 'false',
  })

  // ── Data ──────────────────────────────────────────────────────
  const { data: feedToken } = useQuery({
    queryKey: ['feed-token'],
    queryFn: async () => { const { data } = await api.get('/admin/feeds/token'); return data?.token ?? '' },
  })

  const { data: feedStats } = useQuery({
    queryKey: ['feed-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/feeds/stats'); return data },
  })

  const { data: channelStats } = useQuery({
    queryKey: ['channel-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/products/channel-stats'); return data },
  })

  const { data: accessLog } = useQuery({
    queryKey: ['feed-access-log'],
    queryFn: async () => { const { data } = await api.get('/admin/feeds/log'); return data },
    staleTime: 30000,
  })

  const { data: rawSettings } = useQuery({
    queryKey: ['channel-settings'],
    queryFn: async () => { const { data } = await api.get('/admin/channels/settings'); return data },
  })

  useEffect(() => {
    if (!rawSettings) return
    setSettings((prev) => ({
      ...prev,
      meta_pixel_id: rawSettings.meta_pixel_id ?? prev.meta_pixel_id,
      tiktok_pixel_id: rawSettings.tiktok_pixel_id ?? prev.tiktok_pixel_id,
      whatsapp_number: rawSettings.whatsapp_number ?? prev.whatsapp_number,
      whatsapp_enabled: rawSettings.whatsapp_enabled ?? prev.whatsapp_enabled,
      whatsapp_message_de: rawSettings.whatsapp_message_de ?? prev.whatsapp_message_de,
      whatsapp_message_ar: rawSettings.whatsapp_message_ar ?? prev.whatsapp_message_ar,
      channel_facebook_enabled: rawSettings.channel_facebook_enabled ?? prev.channel_facebook_enabled,
      channel_tiktok_enabled: rawSettings.channel_tiktok_enabled ?? prev.channel_tiktok_enabled,
      channel_google_enabled: rawSettings.channel_google_enabled ?? prev.channel_google_enabled,
    }))
  }, [rawSettings])

  // ── Mutations ─────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null)

  const saveMut = useMutation({
    mutationFn: async (keysToSave: Record<string, string>) => {
      setSaveError(null)
      await api.patch('/admin/settings', keysToSave)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channel-settings'] })
      qc.invalidateQueries({ queryKey: ['feed-stats'] })
    },
    onError: () => {
      setSaveError(t3(locale, 'Fehler beim Speichern — bitte erneut versuchen', 'خطأ في الحفظ — يرجى المحاولة مرة أخرى'))
      // Rollback: reload settings from server
      qc.invalidateQueries({ queryKey: ['channel-settings'] })
    },
  })

  const refreshMut = useMutation({
    mutationFn: async () => { await api.post('/admin/feeds/refresh') },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed-stats'] }),
  })

  const toggleChannel = (settingsKey: string) => {
    const newVal = settings[settingsKey] === 'true' ? 'false' : 'true'
    setSettings((p) => ({ ...p, [settingsKey]: newVal }))
    saveMut.mutate({ [settingsKey]: newVal })
  }

  // ── Computed ──────────────────────────────────────────────────
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const totalProducts = channelStats?.total ?? 0
  const channelCounts: Record<string, number> = {
    facebook: channelStats?.facebook ?? 0,
    tiktok: channelStats?.tiktok ?? 0,
    google: channelStats?.google ?? 0,
  }
  const channelOrders: Record<string, number> = {
    facebook: channelStats?.orders?.facebook ?? 0,
    tiktok: channelStats?.orders?.tiktok ?? 0,
    instagram: channelStats?.orders?.instagram ?? 0,
    website: channelStats?.orders?.website ?? 0,
  }

  const getLastAccess = (channel: string) => {
    if (!accessLog) return null
    const entry = (accessLog as any[]).find((e: any) => e.feed === channel)
    return entry?.date ? new Date(entry.date) : null
  }

  const getFeedExported = (channel: string) => {
    const key = `${channel}_de`
    return feedStats?.[key]?.stats?.exported ?? 0
  }

  const getFeedGenerated = (channel: string) => {
    const key = `${channel}_de`
    return feedStats?.[key]?.generatedAt ? new Date(feedStats[key].generatedAt) : null
  }

  const copyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const fmtDate = (d: Date | null) => {
    if (!d) return '—'
    return d.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'Verkaufskanale', 'قنوات البيع') }]} />
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Globe className="h-6 w-6 text-[#d4a853]" />
        {t3(locale, 'Verkaufskanale', 'قنوات البيع')}
      </h1>

      {/* ═══════ ONLINE SHOP — Always On ═══════ */}
      <div className="bg-background border rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center"><ShoppingBag className="h-5 w-5 text-[#d4a853]" /></div>
            <div>
              <p className="font-semibold text-sm">{t3(locale, 'Online-Shop', 'المتجر الإلكتروني')}</p>
              <p className="text-xs text-muted-foreground">{totalProducts} {t3(locale, 'Produkte', 'منتج')} · {channelOrders.website} {t3(locale, 'Bestellungen', 'طلب')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-green-500/20 text-green-300 font-medium">{t3(locale, 'Immer aktiv', 'نشط دائما')}</span>
            <a href={appUrl} target="_blank" className="p-2 rounded-lg hover:bg-muted transition-colors"><ExternalLink className="h-4 w-4 text-muted-foreground" /></a>
          </div>
        </div>
      </div>

      {/* ═══════ FEED CHANNELS — Expandable Cards ═══════ */}
      <div className="space-y-3 mb-6">
        {CHANNELS.map((ch) => {
          const isEnabled = settings[ch.settingsKey] === 'true'
          const isExpanded = expandedChannel === ch.id
          const productCount = channelCounts[ch.id] ?? 0
          const feedExported = getFeedExported(ch.id)
          const lastGenerated = getFeedGenerated(ch.id)
          const lastAccess = getLastAccess(ch.id)
          const feedUrl = ch.feedUrl && feedToken ? ch.feedUrl(apiUrl, feedToken) : ''
          const orderCount = channelOrders[ch.id] ?? 0

          return (
            <div key={ch.id} className={`bg-background border rounded-2xl overflow-hidden transition-all duration-300 ${isExpanded ? 'ring-1 ring-[#d4a853]/30' : ''}`}>
              {/* ── Card Header ── */}
              <div
                className="flex items-center gap-3 p-5 cursor-pointer hover:bg-muted/10 transition-colors"
                onClick={() => setExpandedChannel(isExpanded ? null : ch.id)}
              >
                <div className={`w-10 h-10 rounded-xl ${ch.iconBg} flex items-center justify-center flex-shrink-0`}>{ch.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{locale === 'ar' ? ch.nameAr : ch.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" />{productCount}/{totalProducts}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />{orderCount} {t3(locale, 'Bestellungen', 'طلب')}</span>
                    {feedExported > 0 && <span className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" />{feedExported} {t3(locale, 'im Feed', 'في الخلاصة')}</span>}
                  </div>
                </div>

                {/* Toggle — stops propagation so click doesn't expand card */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleChannel(ch.settingsKey) }}
                  className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isEnabled ? 'bg-green-500' : 'bg-muted'}`}
                  title={isEnabled ? t3(locale, 'Kanal deaktivieren', 'إيقاف القناة') : t3(locale, 'Kanal aktivieren', 'تفعيل القناة')}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${isEnabled ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'}`} />
                </button>

                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
              </div>

              {/* ── Expanded Panel ── */}
              {isExpanded && (
                <div className="border-t px-5 pb-5 pt-4 space-y-5" style={{ animation: 'fadeSlideDown 200ms ease-out' }}>
                  {/* Status Banner */}
                  {!isEnabled && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium">
                      <Power className="h-3.5 w-3.5" />
                      {t3(locale, 'Kanal ist pausiert — Feed gibt leere Antwort zurück. Produkt-Zuordnungen bleiben erhalten.', 'القناة متوقفة — الخلاصة ترجع فارغة. تعيينات المنتجات تبقى محفوظة.')}
                    </div>
                  )}

                  {/* Stats Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-muted/30 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold tabular-nums">{productCount}</p>
                      <p className="text-[10px] text-muted-foreground">{t3(locale, 'Produkte aktiv', 'منتج نشط')}</p>
                    </div>
                    <div className="bg-muted/30 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold tabular-nums">{feedExported}</p>
                      <p className="text-[10px] text-muted-foreground">{t3(locale, 'Im Feed exportiert', 'مصدّر في الخلاصة')}</p>
                    </div>
                    <div className="bg-muted/30 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold tabular-nums">{orderCount}</p>
                      <p className="text-[10px] text-muted-foreground">{t3(locale, 'Bestellungen', 'طلبات')}</p>
                    </div>
                    <div className="bg-muted/30 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-muted-foreground mb-1">{t3(locale, 'Letzter Abruf', 'آخر طلب')}</p>
                      <p className="text-xs font-medium flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3" />{fmtDate(lastAccess)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">{t3(locale, 'Generiert', 'أُنشئ')}: {fmtDate(lastGenerated)}</p>
                    </div>
                  </div>

                  {/* Feed URL */}
                  {feedUrl && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Feed URL</label>
                      <div className="flex items-center gap-2">
                        <code className="text-[10px] bg-muted px-3 py-2 rounded-xl flex-1 truncate font-mono">{feedUrl}</code>
                        <button onClick={() => copyUrl(feedUrl, ch.id)} className="p-2 rounded-xl hover:bg-muted transition-colors border flex-shrink-0">
                          {copied === ch.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
                        </button>
                        <a href={feedUrl} target="_blank" className="p-2 rounded-xl hover:bg-muted transition-colors border flex-shrink-0">
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Pixel Settings */}
                  {ch.pixelKey && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{ch.pixelLabel}</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={settings[ch.pixelKey] ?? ''}
                          onChange={(e) => setSettings((p) => ({ ...p, [ch.pixelKey!]: e.target.value }))}
                          placeholder={ch.id === 'facebook' ? '123456789012345' : 'ABCDEF123456'}
                          className="flex-1 h-10 px-3 rounded-xl border bg-background text-sm font-mono"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl h-10 px-4"
                          onClick={() => saveMut.mutate({ [ch.pixelKey!]: settings[ch.pixelKey!] ?? '' })}
                          disabled={saveMut.isPending}
                        >
                          {saveMut.isPending ? '...' : t3(locale, 'Speichern', 'حفظ')}
                        </Button>
                      </div>
                      {settings[ch.pixelKey] && (
                        <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" />{t3(locale, 'Pixel aktiv — Tracking-Events werden gesendet', 'البكسل نشط — يتم إرسال أحداث التتبع')}</p>
                      )}
                    </div>
                  )}

                  {/* Missing products warning */}
                  {productCount < totalProducts && isEnabled && (
                    <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-muted/30 text-xs text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                      <span>
                        {totalProducts - productCount} {t3(locale,
                          `Produkte sind NICHT auf diesem Kanal aktiv. Bearbeite die Produkte einzeln oder nutze die Bulk-Aktion auf der Produktseite.`,
                          `منتج غير نشط على هذه القناة. عدّل المنتجات فرديا أو استخدم الإجراء الجماعي في صفحة المنتجات.`
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ═══════ WHATSAPP ═══════ */}
      <div className={`bg-background border rounded-2xl overflow-hidden mb-6 transition-all duration-300 ${expandedChannel === 'whatsapp' ? 'ring-1 ring-[#d4a853]/30' : ''}`}>
        <div
          className="flex items-center gap-3 p-5 cursor-pointer hover:bg-muted/10 transition-colors"
          onClick={() => setExpandedChannel(expandedChannel === 'whatsapp' ? null : 'whatsapp')}
        >
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><MessageCircle className="h-5 w-5 text-green-500" /></div>
          <div className="flex-1">
            <p className="font-semibold text-sm">WhatsApp Business</p>
            <p className="text-xs text-muted-foreground">{settings.whatsapp_number || t3(locale, 'Nicht konfiguriert', 'غير معد')}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); const newVal = settings.whatsapp_enabled === 'true' ? 'false' : 'true'; setSettings((p) => ({ ...p, whatsapp_enabled: newVal })); saveMut.mutate({ whatsapp_enabled: newVal }) }}
            className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${settings.whatsapp_enabled === 'true' ? 'bg-green-500' : 'bg-muted'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.whatsapp_enabled === 'true' ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'}`} />
          </button>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 ${expandedChannel === 'whatsapp' ? 'rotate-180' : ''}`} />
        </div>

        {expandedChannel === 'whatsapp' && (
          <div className="border-t px-5 pb-5 pt-4 space-y-4" style={{ animation: 'fadeSlideDown 200ms ease-out' }}>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t3(locale, 'Telefonnummer', 'رقم الهاتف')}</label>
              <input
                value={settings.whatsapp_number}
                onChange={(e) => setSettings((p) => ({ ...p, whatsapp_number: e.target.value }))}
                placeholder="+491234567890"
                className="w-full h-10 px-3 rounded-xl border bg-background text-sm font-mono"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t3(locale, 'Begrüßung DE', 'رسالة الترحيب بالألمانية')}</label>
                <textarea
                  value={settings.whatsapp_message_de}
                  onChange={(e) => setSettings((p) => ({ ...p, whatsapp_message_de: e.target.value }))}
                  className="w-full h-20 px-3 py-2 rounded-xl border bg-background text-sm resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t3(locale, 'Begrüßung AR', 'رسالة الترحيب بالعربية')}</label>
                <textarea
                  value={settings.whatsapp_message_ar}
                  onChange={(e) => setSettings((p) => ({ ...p, whatsapp_message_ar: e.target.value }))}
                  className="w-full h-20 px-3 py-2 rounded-xl border bg-background text-sm resize-none" dir="rtl"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="bg-[#d4a853] hover:bg-[#c49b4a] text-black rounded-xl h-9 px-5"
                onClick={() => saveMut.mutate({
                  whatsapp_number: settings.whatsapp_number,
                  whatsapp_message_de: settings.whatsapp_message_de,
                  whatsapp_message_ar: settings.whatsapp_message_ar,
                })}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? '...' : t3(locale, 'Speichern', 'حفظ')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {saveError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{saveError}
        </div>
      )}

      {/* ═══════ GLOBAL FEED ACTIONS ═══════ */}
      <div className="bg-background border rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">{t3(locale, 'Feed-Verwaltung', 'إدارة الخلاصات')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t3(locale, 'Cache leeren und alle Feeds neu generieren', 'مسح الذاكرة المؤقتة وإعادة إنشاء جميع الخلاصات')}</p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 rounded-xl" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMut.isPending ? 'animate-spin' : ''}`} />
            {t3(locale, 'Alle Feeds aktualisieren', 'تحديث جميع الخلاصات')}
          </Button>
        </div>
      </div>

      <style>{`@keyframes fadeSlideDown { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 800px; } }`}</style>
    </div>
  )
}
