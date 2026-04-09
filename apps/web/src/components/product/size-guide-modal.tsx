'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { X, Ruler, Calculator, Info } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { motion, AnimatePresence } from 'motion/react'

interface SizeGuideModalProps {
  productId: string
  isOpen: boolean
  onClose: () => void
}

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

// ── Measurement definitions with colors ──
const MEASUREMENTS = [
  { key: 'shoulder', color: '#D85A30', de: 'Schulterbreite', en: 'Shoulder Width', ar: 'عرض الكتف', descDe: 'Von Schulteransatz zu Schulteransatz messen', descAr: 'قس من حافة الكتف إلى حافة الكتف الأخرى' },
  { key: 'bust', color: '#d4a853', de: 'Brustumfang', en: 'Bust', ar: 'محيط الصدر', descDe: 'Um die breiteste Stelle der Brust messen', descAr: 'قس حول أعرض جزء من الصدر' },
  { key: 'waist', color: '#378ADD', de: 'Taillenumfang', en: 'Waist', ar: 'محيط الخصر', descDe: 'Um die schmalste Stelle der Taille messen', descAr: 'قس حول أضيق جزء من الخصر' },
  { key: 'hip', color: '#1D9E75', de: 'Hüftumfang', en: 'Hip', ar: 'محيط الورك', descDe: 'Um die breiteste Stelle der Hüfte messen', descAr: 'قس حول أعرض جزء من الورك' },
  { key: 'length', color: '#7F77DD', de: 'Körpergröße', en: 'Body Height', ar: 'الطول', descDe: 'Barfuß von Kopf bis Fuß messen', descAr: 'قس من الرأس إلى القدم بدون حذاء' },
]

const FIELD_LABELS: Record<string, Record<string, string>> = {
  shoulder: { de: 'Schulter', en: 'Shoulder', ar: 'الكتف' },
  bust: { de: 'Brust', en: 'Bust', ar: 'الصدر' },
  waist: { de: 'Taille', en: 'Waist', ar: 'الخصر' },
  hip: { de: 'Hüfte', en: 'Hip', ar: 'الورك' },
  length: { de: 'Länge', en: 'Length', ar: 'الطول' },
  inseam: { de: 'Innenbein', en: 'Inseam', ar: 'طول الساق' },
  sleeve: { de: 'Ärmel', en: 'Sleeve', ar: 'الكم' },
  footLength: { de: 'Fuß', en: 'Foot', ar: 'القدم' },
  bodyHeight: { de: 'Größe', en: 'Height', ar: 'الطول' },
  euSize: { de: 'EU', en: 'EU', ar: 'EU' },
}

export function SizeGuideModal({ productId, isOpen, onClose }: SizeGuideModalProps) {
  const locale = useLocale()
  const { isAuthenticated } = useAuthStore()
  const [tab, setTab] = useState<'measure' | 'table' | 'mysize'>('measure')
  // activeMeasure removed — using card-based layout instead of interactive mannequin
  const [chart, setChart] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [customerMeasurements, setCustomerMeasurements] = useState<any>(null)
  const [recommendation, setRecommendation] = useState<any>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    Promise.all([
      api.get(`/sizing/products/${productId}/chart`).then(r => r.data).catch(() => null),
      isAuthenticated ? api.get('/sizing/me/measurements').then(r => r.data).catch(() => null) : null,
    ]).then(([chartData, measData]) => {
      setChart(chartData)
      setCustomerMeasurements(measData)
      // Auto-recommend if customer has measurements
      if (measData && chartData) {
        api.post(`/sizing/products/${productId}/recommend`, {
          bustCm: measData.bustCm ? Number(measData.bustCm) : undefined,
          waistCm: measData.waistCm ? Number(measData.waistCm) : undefined,
          hipCm: measData.hipCm ? Number(measData.hipCm) : undefined,
          heightCm: measData.heightCm ? Number(measData.heightCm) : undefined,
        }).then(r => setRecommendation(r.data)).catch(() => {})
      }
      setLoading(false)
    })
  }, [isOpen, productId, isAuthenticated])

  const entries = chart?.entries ?? []
  const fields = entries.length > 0 ? Object.keys(entries[0]).filter(k =>
    !['id', 'sizeChartId', 'size', 'sortOrder', 'createdAt'].includes(k) && entries.some((e: any) => e[k] != null)
  ) : []
  const fitNote = chart ? (locale === 'ar' ? (chart.fitNoteAr || chart.fitNote) : locale === 'en' ? (chart.fitNoteEn || chart.fitNote) : chart.fitNote) : null

  const TABS = [
    { id: 'measure' as const, icon: Ruler, label: t3(locale, 'Wie messe ich mich?', 'How to Measure', 'كيف تقيس نفسك') },
    { id: 'table' as const, icon: Calculator, label: t3(locale, 'Größentabelle', 'Size Chart', 'جدول المقاسات') },
    { id: 'mysize' as const, icon: Info, label: t3(locale, 'Meine Größe', 'My Size', 'مقاسي') },
  ]

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-[#faf8f5] rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-[#e5e0d8]">
            <h2 className="text-lg font-bold flex items-center gap-2 text-[#1a1a2e]">
              <Ruler className="h-5 w-5 text-[#d4a853]" />
              {t3(locale, 'Größenführer', 'Size Guide', 'دليل المقاسات')}
            </h2>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-[#1a1a2e]/5 flex items-center justify-center transition-colors">
              <X className="h-4 w-4 text-[#1a1a2e]/60" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#e5e0d8]">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${tab === t.id ? 'text-[#d4a853]' : 'text-[#1a1a2e]/40 hover:text-[#1a1a2e]/60'}`}
              >
                <t.icon className="h-4 w-4 mx-auto mb-1" />
                {t.label}
                {tab === t.id && <motion.div layoutId="sizing-tab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#d4a853]" />}
              </button>
            ))}
          </div>

          <div className="p-6">
            {loading ? (
              <div className="py-16 text-center text-[#1a1a2e]/30">{t3(locale, 'Laden...', 'Loading...', 'جاري التحميل...')}</div>
            ) : (
              <>
                {/* ═══ TAB 1: How to Measure — Mannequin ═══ */}
                {tab === 'measure' && (
                  <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
                    {/* Left: Elegant outline silhouette */}
                    <div className="flex justify-center">
                      <svg viewBox="0 0 160 420" className="w-40 h-auto" xmlns="http://www.w3.org/2000/svg">
                        {/* Elegant female silhouette — outline only, fashion sketch style */}
                        <g fill="none" stroke="#1a1a2e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
                          {/* Head */}
                          <ellipse cx="80" cy="38" rx="16" ry="20" />
                          {/* Neck */}
                          <line x1="74" y1="58" x2="74" y2="72" />
                          <line x1="86" y1="58" x2="86" y2="72" />
                          {/* Shoulders + Arms */}
                          <path d="M74 72 Q60 72 48 78 Q36 85 32 110 Q30 130 34 155" />
                          <path d="M86 72 Q100 72 112 78 Q124 85 128 110 Q130 130 126 155" />
                          {/* Torso */}
                          <path d="M48 78 Q46 95 50 120 Q54 145 52 168" />
                          <path d="M112 78 Q114 95 110 120 Q106 145 108 168" />
                          {/* Waist curve */}
                          <path d="M52 168 Q55 170 58 175 Q65 182 80 185 Q95 182 102 175 Q105 170 108 168" />
                          {/* Hips + Legs */}
                          <path d="M58 175 Q52 195 48 220 Q44 260 48 300 Q50 330 54 365 L66 365 Q64 330 62 300 Q58 260 62 220 Q66 195 72 185" />
                          <path d="M102 175 Q108 195 112 220 Q116 260 112 300 Q110 330 106 365 L94 365 Q96 330 98 300 Q102 260 98 220 Q94 195 88 185" />
                          {/* Feet */}
                          <path d="M54 365 Q50 370 48 375 L68 375 Q66 370 66 365" />
                          <path d="M94 365 Q94 370 92 375 L112 375 Q110 370 106 365" />
                        </g>

                        {/* ═══ MEASUREMENT INDICATORS ═══ */}
                        {/* 1: Shoulder — horizontal line with arrows */}
                        <g>
                          <line x1="42" y1="78" x2="118" y2="78" stroke="#D85A30" strokeWidth="1.5" strokeDasharray="5 3" />
                          <polygon points="42,75 42,81 36,78" fill="#D85A30" />
                          <polygon points="118,75 118,81 124,78" fill="#D85A30" />
                          <text x="80" y="73" textAnchor="middle" fill="#D85A30" fontSize="8" fontWeight="600">1</text>
                        </g>

                        {/* 2: Bust — arc with arrows */}
                        <g>
                          <path d="M44 110 Q80 128 116 110" fill="none" stroke="#d4a853" strokeWidth="1.5" strokeDasharray="5 3" />
                          <circle cx="44" cy="110" r="2.5" fill="#d4a853" />
                          <circle cx="116" cy="110" r="2.5" fill="#d4a853" />
                          <text x="80" y="124" textAnchor="middle" fill="#d4a853" fontSize="8" fontWeight="600">2</text>
                        </g>

                        {/* 3: Waist — arc with arrows */}
                        <g>
                          <path d="M48 148 Q80 162 112 148" fill="none" stroke="#378ADD" strokeWidth="1.5" strokeDasharray="5 3" />
                          <circle cx="48" cy="148" r="2.5" fill="#378ADD" />
                          <circle cx="112" cy="148" r="2.5" fill="#378ADD" />
                          <text x="80" y="160" textAnchor="middle" fill="#378ADD" fontSize="8" fontWeight="600">3</text>
                        </g>

                        {/* 4: Hip — arc with arrows */}
                        <g>
                          <path d="M46 195 Q80 212 114 195" fill="none" stroke="#1D9E75" strokeWidth="1.5" strokeDasharray="5 3" />
                          <circle cx="46" cy="195" r="2.5" fill="#1D9E75" />
                          <circle cx="114" cy="195" r="2.5" fill="#1D9E75" />
                          <text x="80" y="210" textAnchor="middle" fill="#1D9E75" fontSize="8" fontWeight="600">4</text>
                        </g>

                        {/* 5: Height — vertical line */}
                        <g>
                          <line x1="145" y1="18" x2="145" y2="375" stroke="#7F77DD" strokeWidth="1" strokeDasharray="4 3" />
                          <polygon points="142,18 148,18 145,12" fill="#7F77DD" />
                          <polygon points="142,375 148,375 145,381" fill="#7F77DD" />
                          <text x="145" y="200" textAnchor="middle" fill="#7F77DD" fontSize="8" fontWeight="600" transform="rotate(-90,145,200)">5</text>
                        </g>
                      </svg>
                    </div>

                    {/* Right: Measurement descriptions */}
                    <div className="space-y-2.5">
                      {MEASUREMENTS.map((m, i) => (
                        <div key={m.key} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#e5e0d8]">
                          <div className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: m.color }}>
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#1a1a2e]">
                              {locale === 'ar' ? m.ar : locale === 'en' ? m.en : m.de}
                            </p>
                            <p className="text-[11px] text-[#1a1a2e]/35 leading-snug">
                              {locale === 'ar' ? m.descAr : m.descDe}
                            </p>
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-[#1a1a2e]/25 text-center pt-2">
                        {t3(locale, 'Alle Maße in cm · Maßband eng anlegen, nicht einschnürend', 'All measurements in cm · Keep tape snug, not tight', 'جميع المقاسات بالسم · ضع الشريط بإحكام دون شد')}
                      </p>
                    </div>
                  </div>
                )}

                {/* ═══ TAB 2: Size Table ═══ */}
                {tab === 'table' && (
                  <div className="space-y-4">
                    {fitNote && (
                      <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-sm text-orange-800">
                        {fitNote}
                      </div>
                    )}
                    {entries.length > 0 ? (
                      <div className="overflow-x-auto rounded-xl border border-[#e5e0d8]">
                        {/* Header */}
                        <div className={`grid gap-x-1 bg-[#1a1a2e]/[0.04] border-b border-[#e5e0d8]`} style={{ gridTemplateColumns: `1fr repeat(${fields.length}, 1fr)` }}>
                          <div className="px-3 py-3 text-sm font-semibold text-[#1a1a2e] text-center">{t3(locale, 'Größe', 'Size', 'المقاس')}</div>
                          {fields.map(f => (
                            <div key={f} className="px-2 py-3 text-center text-xs font-semibold text-[#1a1a2e]/50">
                              {FIELD_LABELS[f]?.[locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'de'] ?? f}
                              <span className="text-[#1a1a2e]/20 font-normal"> cm</span>
                            </div>
                          ))}
                        </div>
                        {/* Rows */}
                        {entries.map((entry: any) => {
                          const isRecommended = recommendation?.recommendation === entry.size
                          return (
                            <div key={entry.id} className={`grid gap-x-1 border-b border-[#e5e0d8] last:border-0 transition-colors ${isRecommended ? 'bg-[#d4a853]/10' : 'hover:bg-white'}`} style={{ gridTemplateColumns: `1fr repeat(${fields.length}, 1fr)` }}>
                              <div className="px-3 py-3 text-sm font-bold text-center">
                                {entry.size}
                                {isRecommended && <span className="text-[9px] text-[#d4a853] font-medium block">{t3(locale, 'Empfohlen', 'Rec.', 'موصى')}</span>}
                              </div>
                              {fields.map(f => (
                                <div key={f} className="px-2 py-3 text-center text-sm tabular-nums text-[#1a1a2e]/65">
                                  {entry[f] != null ? Number(entry[f]) : '—'}
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-[#1a1a2e]/25">
                        <Ruler className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>{t3(locale, 'Keine Größentabelle verfügbar', 'No size chart available', 'لا يوجد جدول مقاسات')}</p>
                      </div>
                    )}
                    {chart?.supplier && (
                      <p className="text-xs text-[#1a1a2e]/25">{t3(locale, 'Hersteller', 'Manufacturer', 'الشركة المصنعة')}: {chart.supplier.name}</p>
                    )}
                  </div>
                )}

                {/* ═══ TAB 3: My Size ═══ */}
                {tab === 'mysize' && (
                  <div className="space-y-4">
                    {isAuthenticated && customerMeasurements ? (
                      <>
                        {recommendation?.recommendation ? (
                          <div className={`p-6 rounded-2xl text-center border-2 ${
                            recommendation.confidence === 'high' ? 'border-green-300 bg-green-50' :
                            recommendation.confidence === 'medium' ? 'border-orange-300 bg-orange-50' :
                            'border-red-300 bg-red-50'
                          }`}>
                            <p className="text-xs text-[#1a1a2e]/40 mb-1">{t3(locale, 'Deine empfohlene Größe', 'Your recommended size', 'مقاسك الموصى به')}</p>
                            <p className="text-5xl font-bold text-[#1a1a2e] mb-2">{recommendation.recommendation}</p>
                            <p className={`text-sm font-medium ${
                              recommendation.confidence === 'high' ? 'text-green-700' :
                              recommendation.confidence === 'medium' ? 'text-orange-700' : 'text-red-700'
                            }`}>
                              {recommendation.confidence === 'high'
                                ? t3(locale, 'Perfekte Passform', 'Perfect fit', 'مقاس مثالي')
                                : recommendation.confidence === 'medium'
                                  ? t3(locale, 'Gute Passform', 'Good fit', 'مقاس جيد')
                                  : t3(locale, 'Könnte eng/weit sein', 'May be tight/loose', 'قد يكون ضيقاً/واسعاً')}
                            </p>
                          </div>
                        ) : (
                          <p className="text-center text-[#1a1a2e]/40 py-8">{t3(locale, 'Keine Empfehlung möglich', 'No recommendation available', 'لا توجد توصية متاحة')}</p>
                        )}
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          {customerMeasurements.heightCm && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Größe', 'Height', 'الطول')}</p><p className="font-bold tabular-nums">{Number(customerMeasurements.heightCm)} cm</p></div>}
                          {customerMeasurements.bustCm && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Brust', 'Bust', 'الصدر')}</p><p className="font-bold tabular-nums">{Number(customerMeasurements.bustCm)} cm</p></div>}
                          {customerMeasurements.waistCm && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Taille', 'Waist', 'الخصر')}</p><p className="font-bold tabular-nums">{Number(customerMeasurements.waistCm)} cm</p></div>}
                          {customerMeasurements.hipCm && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Hüfte', 'Hip', 'الورك')}</p><p className="font-bold tabular-nums">{Number(customerMeasurements.hipCm)} cm</p></div>}
                          {customerMeasurements.weightKg && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Gewicht', 'Weight', 'الوزن')}</p><p className="font-bold tabular-nums">{Number(customerMeasurements.weightKg)} kg</p></div>}
                          {customerMeasurements.usualSizeTop && <div className="bg-white rounded-xl p-3 text-center"><p className="text-xs text-[#1a1a2e]/30 mb-1">{t3(locale, 'Üblich', 'Usual', 'المعتاد')}</p><p className="font-bold">{customerMeasurements.usualSizeTop}</p></div>}
                        </div>
                        <a href={`/${locale}/account/measurements`} className="block text-center text-sm text-[#d4a853] underline underline-offset-4 hover:text-[#c49b45]">
                          {t3(locale, 'Maße bearbeiten', 'Edit measurements', 'تعديل المقاسات')}
                        </a>
                      </>
                    ) : (
                      <div className="py-12 text-center space-y-4">
                        <Ruler className="h-10 w-10 mx-auto text-[#1a1a2e]/15" />
                        <p className="text-[#1a1a2e]/40">{t3(locale, 'Melde dich an und speichere deine Maße für personalisierte Größenempfehlungen.', 'Sign in and save your measurements for personalized size recommendations.', 'سجل دخولك واحفظ مقاساتك للحصول على توصيات مقاسات مخصصة.')}</p>
                        <a href={`/${locale}/auth/login?redirect=account/measurements`} className="inline-block px-6 py-2.5 bg-[#d4a853] text-white rounded-xl text-sm font-medium hover:bg-[#c49b45] transition-colors">
                          {t3(locale, 'Anmelden', 'Sign In', 'تسجيل الدخول')}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
