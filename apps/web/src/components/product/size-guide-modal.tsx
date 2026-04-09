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
  const [activeMeasure, setActiveMeasure] = useState<string | null>(null)
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
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-8">
                    {/* Left: Premium Fashion Mannequin */}
                    <div className="flex justify-center py-4">
                      <svg viewBox="0 0 220 440" className="w-52 h-auto" xmlns="http://www.w3.org/2000/svg">
                        {/* Shadow */}
                        <ellipse cx="110" cy="425" rx="40" ry="6" fill="#1a1a2e" opacity="0.06" />

                        {/* Hair */}
                        <ellipse cx="110" cy="32" rx="26" ry="30" fill="#2a1a0e" />
                        <ellipse cx="110" cy="28" rx="24" ry="22" fill="#3d2a18" />

                        {/* Head */}
                        <ellipse cx="110" cy="42" rx="18" ry="22" fill="#d4b8a0" />
                        {/* Face details */}
                        <ellipse cx="103" cy="39" rx="2" ry="1.5" fill="#1a1a2e" opacity="0.3" />
                        <ellipse cx="117" cy="39" rx="2" ry="1.5" fill="#1a1a2e" opacity="0.3" />
                        <path d="M106 48 Q110 51 114 48" fill="none" stroke="#c4988a" strokeWidth="1" />

                        {/* Neck */}
                        <path d="M102 62 L102 78 Q110 80 118 78 L118 62" fill="#d4b8a0" />

                        {/* Upper body - Blouse/Top */}
                        <path d="M68 85 Q72 78 102 78 L118 78 Q148 78 152 85 L155 95 Q158 140 152 175 Q130 182 110 183 Q90 182 68 175 Q62 140 65 95 Z" fill="#f5efe8" stroke="#e8e0d4" strokeWidth="0.5" />
                        {/* Collar detail */}
                        <path d="M98 78 Q110 88 122 78" fill="none" stroke="#d4b8a0" strokeWidth="1.5" />
                        {/* Center line */}
                        <line x1="110" y1="85" x2="110" y2="175" stroke="#e8e0d4" strokeWidth="0.5" />
                        {/* Buttons */}
                        <circle cx="110" cy="100" r="2" fill="#d4a853" opacity="0.4" />
                        <circle cx="110" cy="120" r="2" fill="#d4a853" opacity="0.4" />
                        <circle cx="110" cy="140" r="2" fill="#d4a853" opacity="0.4" />

                        {/* Belt */}
                        <rect x="68" y="173" width="84" height="10" rx="2" fill="#1a1a2e" />
                        <rect x="105" y="174" width="10" height="8" rx="1.5" fill="#d4a853" />

                        {/* Skirt / Bottom */}
                        <path d="M66 183 Q60 260 72 370 L88 370 Q85 300 82 220 L82 188 Q95 192 110 192 Q125 192 138 188 L138 220 Q135 300 132 370 L148 370 Q160 260 154 183 Q132 190 110 192 Q88 190 66 183 Z" fill="#1a1a2e" />
                        {/* Pant crease */}
                        <line x1="82" y1="200" x2="80" y2="360" stroke="#0f0f20" strokeWidth="0.8" opacity="0.3" />
                        <line x1="138" y1="200" x2="140" y2="360" stroke="#0f0f20" strokeWidth="0.8" opacity="0.3" />

                        {/* Arms */}
                        <path d="M68 85 Q52 90 42 140 Q38 158 40 170 L48 172 Q50 155 52 140 Q58 108 68 95" fill="#f5efe8" stroke="#e8e0d4" strokeWidth="0.5" />
                        <path d="M152 85 Q168 90 178 140 Q182 158 180 170 L172 172 Q170 155 168 140 Q162 108 152 95" fill="#f5efe8" stroke="#e8e0d4" strokeWidth="0.5" />

                        {/* Hands */}
                        <ellipse cx="44" cy="174" rx="7" ry="8" fill="#d4b8a0" />
                        <ellipse cx="176" cy="174" rx="7" ry="8" fill="#d4b8a0" />

                        {/* Shoes */}
                        <path d="M68 368 L68 380 Q68 388 78 388 L92 388 Q92 380 88 372 Z" fill="#1a1a2e" />
                        <path d="M128 372 Q124 380 128 388 L142 388 Q152 388 152 380 L152 368 Z" fill="#1a1a2e" />
                        {/* Shoe soles */}
                        <line x1="68" y1="388" x2="92" y2="388" stroke="#d4a853" strokeWidth="1.5" />
                        <line x1="128" y1="388" x2="152" y2="388" stroke="#d4a853" strokeWidth="1.5" />

                        {/* ═══ MEASUREMENT LINES ═══ */}
                        {/* Shoulder */}
                        <g opacity={!activeMeasure || activeMeasure === 'shoulder' ? 1 : 0.12} className="transition-opacity duration-400">
                          <line x1="58" y1="86" x2="162" y2="86" stroke="#D85A30" strokeWidth="2" strokeDasharray="6 3" />
                          <circle cx="58" cy="86" r="3.5" fill="#D85A30" />
                          <circle cx="162" cy="86" r="3.5" fill="#D85A30" />
                          {activeMeasure === 'shoulder' && <>
                            <circle cx="58" cy="86" r="6" fill="none" stroke="#D85A30" strokeWidth="1.5" opacity="0.4"><animate attributeName="r" from="4" to="10" dur="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.6" to="0" dur="1.2s" repeatCount="indefinite" /></circle>
                            <circle cx="162" cy="86" r="6" fill="none" stroke="#D85A30" strokeWidth="1.5" opacity="0.4"><animate attributeName="r" from="4" to="10" dur="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.6" to="0" dur="1.2s" repeatCount="indefinite" /></circle>
                          </>}
                        </g>

                        {/* Bust */}
                        <g opacity={!activeMeasure || activeMeasure === 'bust' ? 1 : 0.12} className="transition-opacity duration-400">
                          <ellipse cx="110" cy="115" rx="48" ry="13" fill="none" stroke="#d4a853" strokeWidth="2" strokeDasharray="6 3" />
                          {activeMeasure === 'bust' && <ellipse cx="110" cy="115" rx="48" ry="13" fill="none" stroke="#d4a853" strokeWidth="1" opacity="0.3"><animate attributeName="rx" from="48" to="54" dur="1.2s" repeatCount="indefinite" /><animate attributeName="ry" from="13" to="16" dur="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.4" to="0" dur="1.2s" repeatCount="indefinite" /></ellipse>}
                        </g>

                        {/* Waist */}
                        <g opacity={!activeMeasure || activeMeasure === 'waist' ? 1 : 0.12} className="transition-opacity duration-400">
                          <ellipse cx="110" cy="160" rx="40" ry="10" fill="none" stroke="#378ADD" strokeWidth="2" strokeDasharray="6 3" />
                          {activeMeasure === 'waist' && <ellipse cx="110" cy="160" rx="40" ry="10" fill="none" stroke="#378ADD" strokeWidth="1" opacity="0.3"><animate attributeName="rx" from="40" to="46" dur="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.4" to="0" dur="1.2s" repeatCount="indefinite" /></ellipse>}
                        </g>

                        {/* Hip */}
                        <g opacity={!activeMeasure || activeMeasure === 'hip' ? 1 : 0.12} className="transition-opacity duration-400">
                          <ellipse cx="110" cy="195" rx="48" ry="12" fill="none" stroke="#1D9E75" strokeWidth="2" strokeDasharray="6 3" />
                          {activeMeasure === 'hip' && <ellipse cx="110" cy="195" rx="48" ry="12" fill="none" stroke="#1D9E75" strokeWidth="1" opacity="0.3"><animate attributeName="rx" from="48" to="54" dur="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" from="0.4" to="0" dur="1.2s" repeatCount="indefinite" /></ellipse>}
                        </g>

                        {/* Height */}
                        <g opacity={!activeMeasure || activeMeasure === 'length' ? 1 : 0.12} className="transition-opacity duration-400">
                          <line x1="198" y1="18" x2="198" y2="388" stroke="#7F77DD" strokeWidth="1.5" strokeDasharray="4 3" />
                          <line x1="192" y1="18" x2="204" y2="18" stroke="#7F77DD" strokeWidth="1.5" />
                          <line x1="192" y1="388" x2="204" y2="388" stroke="#7F77DD" strokeWidth="1.5" />
                          <circle cx="198" cy="18" r="3" fill="#7F77DD" />
                          <circle cx="198" cy="388" r="3" fill="#7F77DD" />
                        </g>
                      </svg>
                    </div>

                    {/* Right: Measurement list */}
                    <div className="space-y-2">
                      {MEASUREMENTS.map(m => (
                        <button
                          key={m.key}
                          onClick={() => setActiveMeasure(activeMeasure === m.key ? null : m.key)}
                          className={`w-full text-start p-3 rounded-xl border transition-all duration-200 ${
                            activeMeasure === m.key
                              ? 'bg-[#fef9ef] border-[#d4a853]/30 shadow-sm'
                              : 'bg-white/50 border-transparent hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                            <div>
                              <p className="text-sm font-semibold text-[#1a1a2e]">
                                {locale === 'ar' ? m.ar : locale === 'en' ? m.en : m.de}
                              </p>
                              <p className="text-xs text-[#1a1a2e]/40 mt-0.5">
                                {locale === 'ar' ? m.descAr : m.descDe}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}

                      {/* Tip box */}
                      {activeMeasure && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          className="p-3 rounded-xl bg-[#d4a853]/10 border border-[#d4a853]/20 text-xs text-[#1a1a2e]/70"
                        >
                          💡 {locale === 'ar' ? 'استخدم شريط قياس مرن وقف بشكل مستقيم' : 'Verwende ein flexibles Maßband und stehe gerade'}
                        </motion.div>
                      )}
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
