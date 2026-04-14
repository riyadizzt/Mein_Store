'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Sparkles, Loader2, Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface AiResult {
  de: string; ar: string; en: string
  seo?: { metaTitleDe: string; metaTitleAr: string; metaTitleEn: string; metaDescDe: string; metaDescAr: string; metaDescEn: string }
}

interface Props {
  productId: string
  productName: string
  category?: string
  onApply: (result: AiResult) => void
}

export function AiDescriptionButton({ productId, productName, category, onApply }: Props) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const { data } = await api.post('/admin/ai/generate-product-description', {
        name: productName,
        category,
        productId,
      })
      setResult({ de: data.de || '', ar: data.ar || '', en: data.en || '', seo: data.seo })
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t3('Fehler bei der KI-Generierung', 'AI generation failed', 'فشل في إنشاء الوصف'))
    }
    setLoading(false)
  }

  if (result) {
    return (
      <div className="border border-[#d4a853]/30 rounded-2xl overflow-hidden bg-[#d4a853]/5">
        <div className="px-5 py-3 border-b border-[#d4a853]/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#d4a853]" />
            <span className="text-sm font-bold">{t3('KI-Vorschlag', 'AI Suggestion', 'اقتراح الذكاء الاصطناعي')}</span>
          </div>
          <button onClick={() => setResult(null)} className="p-1 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Descriptions */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t3('Beschreibungen', 'Descriptions', 'الأوصاف')}</h4>
            {[
              { flag: '🇩🇪', label: 'Deutsch', text: result.de },
              { flag: '🇸🇦', label: 'العربية', text: result.ar },
              { flag: '🇬🇧', label: 'English', text: result.en },
            ].map(({ flag, label, text }) => (
              <div key={label}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">{flag}</span>
                  <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                </div>
                <p className="text-sm leading-relaxed bg-background rounded-xl p-3 border" dir={label === 'العربية' ? 'rtl' : 'ltr'}>{text}</p>
              </div>
            ))}
          </div>

          {/* SEO Meta Tags */}
          {result.seo && (result.seo.metaTitleDe || result.seo.metaDescDe) && (
            <div className="space-y-3 pt-3 border-t">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">SEO Meta-Tags</h4>
              {[
                { flag: '🇩🇪', title: result.seo.metaTitleDe, desc: result.seo.metaDescDe },
                { flag: '🇸🇦', title: result.seo.metaTitleAr, desc: result.seo.metaDescAr },
                { flag: '🇬🇧', title: result.seo.metaTitleEn, desc: result.seo.metaDescEn },
              ].map(({ flag, title, desc }) => (
                <div key={flag} className="bg-background rounded-xl p-3 border">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-sm">{flag}</span>
                    <span className="text-xs font-bold text-blue-600 truncate">{title}</span>
                  </div>
                  <p className="text-xs text-green-700 truncate">{desc}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setResult(null)}>
              {t3('Verwerfen', 'Discard', 'تجاهل')}
            </Button>
            <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={() => { onApply(result); setResult(null) }}>
              <Check className="h-4 w-4" />
              {t3('Übernehmen', 'Apply', 'تطبيق')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant="outline"
        onClick={generate}
        disabled={loading}
        className="gap-2 border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/10"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {loading
          ? t3('KI analysiert Produkt...', 'AI analyzing product...', 'الذكاء الاصطناعي يحلل المنتج...')
          : t3('KI-Beschreibung generieren', 'Generate AI Description', 'إنشاء وصف بالذكاء الاصطناعي')}
      </Button>
      {error && <p className="text-xs text-red-500">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
    </div>
  )
}
