'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { X, Ruler, Calculator, Info } from 'lucide-react'
import { api } from '@/lib/api'
import { motion, AnimatePresence } from 'motion/react'

interface SizeGuideModalProps {
  productId: string
  isOpen: boolean
  onClose: () => void
}

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

const FIELD_LABELS: Record<string, Record<string, string>> = {
  bust: { de: 'Brust', en: 'Bust', ar: 'الصدر' },
  waist: { de: 'Taille', en: 'Waist', ar: 'الخصر' },
  hip: { de: 'Hüfte', en: 'Hip', ar: 'الورك' },
  length: { de: 'Länge', en: 'Length', ar: 'الطول' },
  inseam: { de: 'Innenbein', en: 'Inseam', ar: 'طول الساق' },
  shoulder: { de: 'Schulter', en: 'Shoulder', ar: 'الكتف' },
  sleeve: { de: 'Ärmel', en: 'Sleeve', ar: 'الكم' },
  footLength: { de: 'Fußlänge', en: 'Foot', ar: 'طول القدم' },
  bodyHeight: { de: 'Körpergröße', en: 'Height', ar: 'الطول' },
  euSize: { de: 'EU', en: 'EU', ar: 'EU' },
}

export function SizeGuideModal({ productId, isOpen, onClose }: SizeGuideModalProps) {
  const locale = useLocale()
  const [tab, setTab] = useState<'table' | 'finder' | 'fit'>('table')
  const [chart, setChart] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [measurements, setMeasurements] = useState({ heightCm: '', bustCm: '', waistCm: '', hipCm: '', footLengthCm: '' })
  const [recommendation, setRecommendation] = useState<any>(null)
  const [recommending, setRecommending] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    api.get(`/sizing/products/${productId}/chart`).then(({ data }) => {
      setChart(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [isOpen, productId])

  const handleRecommend = async () => {
    setRecommending(true)
    try {
      const body: Record<string, number> = {}
      if (measurements.heightCm) body.heightCm = Number(measurements.heightCm)
      if (measurements.bustCm) body.bustCm = Number(measurements.bustCm)
      if (measurements.waistCm) body.waistCm = Number(measurements.waistCm)
      if (measurements.hipCm) body.hipCm = Number(measurements.hipCm)
      if (measurements.footLengthCm) body.footLengthCm = Number(measurements.footLengthCm)

      const { data } = await api.post(`/sizing/products/${productId}/recommend`, body)
      setRecommendation(data)
    } catch { /* ignore */ }
    setRecommending(false)
  }

  const fields = chart?.entries?.[0] ? Object.keys(chart.entries[0]).filter(k =>
    !['id', 'sizeChartId', 'size', 'sortOrder', 'createdAt'].includes(k) && chart.entries.some((e: any) => e[k] != null)
  ) : []

  const fitNote = locale === 'ar' ? (chart?.fitNoteAr || chart?.fitNote) : locale === 'en' ? (chart?.fitNoteEn || chart?.fitNote) : chart?.fitNote

  const TABS = [
    { id: 'table' as const, icon: Ruler, label: t3(locale, 'Größentabelle', 'Size Chart', 'جدول المقاسات') },
    { id: 'finder' as const, icon: Calculator, label: t3(locale, 'Größe finden', 'Find Your Size', 'اعثر على مقاسك') },
    { id: 'fit' as const, icon: Info, label: t3(locale, 'Passform', 'Fit Info', 'معلومات التصميم') },
  ]

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="bg-background rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Ruler className="h-5 w-5 text-[#d4a853]" />
              {t3(locale, 'Größenberatung', 'Size Guide', 'دليل المقاسات')}
            </h2>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-3 text-sm font-medium transition-colors relative ${tab === t.id ? 'text-[#d4a853]' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <t.icon className="h-4 w-4 mx-auto mb-1" />
                {t.label}
                {tab === t.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d4a853]" />}
              </button>
            ))}
          </div>

          <div className="p-5">
            {loading ? (
              <div className="py-12 text-center text-muted-foreground">{t3(locale, 'Laden...', 'Loading...', 'جاري التحميل...')}</div>
            ) : !chart ? (
              <div className="py-12 text-center text-muted-foreground">
                <Ruler className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>{t3(locale, 'Keine Größentabelle für dieses Produkt verfügbar', 'No size chart available for this product', 'لا يوجد جدول مقاسات لهذا المنتج')}</p>
              </div>
            ) : (
              <>
                {/* Tab 1: Size Table */}
                {tab === 'table' && (
                  <div className="space-y-4">
                    {chart.supplier && (
                      <p className="text-xs text-muted-foreground">{t3(locale, 'Lieferant', 'Supplier', 'المورد')}: {chart.supplier.name}</p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-start font-semibold">{t3(locale, 'Größe', 'Size', 'المقاس')}</th>
                            {fields.map((f: string) => (
                              <th key={f} className="px-3 py-2 text-center font-semibold">
                                {FIELD_LABELS[f]?.[locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'de'] ?? f}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {chart.entries.map((entry: any) => (
                            <tr key={entry.id} className="border-b hover:bg-muted/30">
                              <td className="px-3 py-2 font-bold">{entry.size}</td>
                              {fields.map((f: string) => (
                                <td key={f} className="px-3 py-2 text-center tabular-nums">
                                  {entry[f] != null ? `${Number(entry[f])}` : '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Measurement illustration */}
                    <div className="bg-muted/30 rounded-xl p-4 text-center">
                      <p className="text-xs text-muted-foreground mb-2">{t3(locale, 'So misst du richtig:', 'How to measure:', 'كيف تقيس بشكل صحيح:')}</p>
                      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
                        <div className="text-center"><div className="h-8 w-8 mx-auto rounded-full bg-[#d4a853]/10 flex items-center justify-center text-[#d4a853] font-bold mb-1">1</div>{t3(locale, 'Brust: um die breiteste Stelle', 'Bust: around widest part', 'الصدر: حول أعرض جزء')}</div>
                        <div className="text-center"><div className="h-8 w-8 mx-auto rounded-full bg-[#d4a853]/10 flex items-center justify-center text-[#d4a853] font-bold mb-1">2</div>{t3(locale, 'Taille: schmalste Stelle', 'Waist: narrowest part', 'الخصر: أضيق جزء')}</div>
                        <div className="text-center"><div className="h-8 w-8 mx-auto rounded-full bg-[#d4a853]/10 flex items-center justify-center text-[#d4a853] font-bold mb-1">3</div>{t3(locale, 'Hüfte: breiteste Stelle', 'Hip: widest part', 'الورك: أعرض جزء')}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Find Your Size */}
                {tab === 'finder' && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {t3(locale, 'Gib deine Maße ein und wir empfehlen dir die passende Größe.', 'Enter your measurements and we\'ll recommend the right size.', 'أدخل مقاساتك وسنوصي لك بالمقاس المناسب.')}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-medium mb-1 block">{t3(locale, 'Körpergröße (cm)', 'Height (cm)', 'الطول (سم)')}</label>
                        <input type="number" value={measurements.heightCm} onChange={e => setMeasurements({ ...measurements, heightCm: e.target.value })} className="w-full h-10 px-3 rounded-lg border text-sm" placeholder="170" />
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1 block">{t3(locale, 'Brust (cm)', 'Bust (cm)', 'الصدر (سم)')}</label>
                        <input type="number" value={measurements.bustCm} onChange={e => setMeasurements({ ...measurements, bustCm: e.target.value })} className="w-full h-10 px-3 rounded-lg border text-sm" placeholder="92" />
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1 block">{t3(locale, 'Taille (cm)', 'Waist (cm)', 'الخصر (سم)')}</label>
                        <input type="number" value={measurements.waistCm} onChange={e => setMeasurements({ ...measurements, waistCm: e.target.value })} className="w-full h-10 px-3 rounded-lg border text-sm" placeholder="72" />
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1 block">{t3(locale, 'Hüfte (cm)', 'Hip (cm)', 'الورك (سم)')}</label>
                        <input type="number" value={measurements.hipCm} onChange={e => setMeasurements({ ...measurements, hipCm: e.target.value })} className="w-full h-10 px-3 rounded-lg border text-sm" placeholder="96" />
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1 block">{t3(locale, 'Fußlänge (cm)', 'Foot (cm)', 'طول القدم (سم)')}</label>
                        <input type="number" value={measurements.footLengthCm} onChange={e => setMeasurements({ ...measurements, footLengthCm: e.target.value })} className="w-full h-10 px-3 rounded-lg border text-sm" placeholder="26" />
                      </div>
                    </div>
                    <button
                      onClick={handleRecommend}
                      disabled={recommending || (!measurements.bustCm && !measurements.waistCm && !measurements.hipCm && !measurements.footLengthCm && !measurements.heightCm)}
                      className="w-full h-12 rounded-xl bg-[#d4a853] text-white font-semibold hover:bg-[#c49b45] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {recommending ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Calculator className="h-4 w-4" />}
                      {t3(locale, 'Größe empfehlen', 'Recommend Size', 'اقتراح المقاس')}
                    </button>

                    {/* Recommendation Result */}
                    {recommendation?.recommendation && (
                      <div className={`p-5 rounded-xl border-2 text-center ${
                        recommendation.confidence === 'high' ? 'border-green-300 bg-green-50' :
                        recommendation.confidence === 'medium' ? 'border-orange-300 bg-orange-50' :
                        'border-red-300 bg-red-50'
                      }`}>
                        <p className="text-xs text-muted-foreground mb-1">{t3(locale, 'Unsere Empfehlung', 'Our recommendation', 'توصيتنا')}</p>
                        <p className="text-4xl font-bold mb-2">{recommendation.recommendation}</p>
                        <p className={`text-sm font-medium ${
                          recommendation.confidence === 'high' ? 'text-green-700' :
                          recommendation.confidence === 'medium' ? 'text-orange-700' :
                          'text-red-700'
                        }`}>
                          {recommendation.confidence === 'high'
                            ? t3(locale, 'Perfekte Passform', 'Perfect fit', 'مقاس مثالي')
                            : recommendation.confidence === 'medium'
                              ? t3(locale, 'Gute Passform', 'Good fit', 'مقاس جيد')
                              : t3(locale, 'Könnte eng/weit sein', 'May be tight/loose', 'قد يكون ضيقاً/واسعاً')}
                        </p>
                      </div>
                    )}
                    {recommendation && !recommendation.recommendation && (
                      <p className="text-sm text-muted-foreground text-center">{t3(locale, 'Keine passende Größe gefunden', 'No matching size found', 'لم يتم العثور على مقاس مناسب')}</p>
                    )}
                  </div>
                )}

                {/* Tab 3: Fit Info */}
                {tab === 'fit' && (
                  <div className="space-y-4">
                    {fitNote ? (
                      <div className="p-4 rounded-xl bg-orange-50 border border-orange-200">
                        <p className="text-sm font-semibold text-orange-800 mb-1">{t3(locale, 'Passform-Hinweis', 'Fit Note', 'ملاحظة التصميم')}</p>
                        <p className="text-sm text-orange-700">{fitNote}</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                        <p className="text-sm font-semibold text-green-800 mb-1">{t3(locale, 'Passform', 'Fit', 'التصميم')}</p>
                        <p className="text-sm text-green-700">{t3(locale, 'Normal geschnitten — wähle deine übliche Größe', 'Regular fit — choose your usual size', 'قصة عادية — اختر مقاسك المعتاد')}</p>
                      </div>
                    )}
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>{t3(locale, 'Alle Maße in cm. Die Maße beziehen sich auf das Kleidungsstück, nicht auf den Körper.', 'All measurements in cm. Measurements refer to the garment, not the body.', 'جميع المقاسات بالسنتيمتر. المقاسات تشير إلى الملابس وليس الجسم.')}</p>
                      {chart.supplier?.country && (
                        <p>{t3(locale, `Hergestellt in: ${chart.supplier.country}`, `Made in: ${chart.supplier.country}`, `بلد الصنع: ${chart.supplier.country}`)}</p>
                      )}
                    </div>
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
