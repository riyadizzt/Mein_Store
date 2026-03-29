'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Globe, AlertTriangle, ExternalLink, Plus } from 'lucide-react'
import Link from 'next/link'
import { useProductWizardStore } from '@/store/product-wizard-store'
import { api } from '@/lib/api'
import { getProductName, getCategoryName, formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

export function StepBasics() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const {
    translations, categoryId, slug, basePrice, salePrice, taxRate,
    setTranslation, setCategoryId, setSlug, setBasePrice, setSalePrice, setStep,
  } = useProductWizardStore()

  const [activeLang, setActiveLang] = useState('de')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedDept, setSelectedDept] = useState('')

  // Duplicate detection
  const [dupQuery, setDupQuery] = useState('')
  const [dupDismissed, setDupDismissed] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => { const { data } = await api.get('/categories'); return Array.isArray(data) ? data : data?.data ?? data?.items ?? [] },
  })

  // Debounced duplicate check
  const { data: dupResult } = useQuery({
    queryKey: ['check-duplicate', dupQuery],
    queryFn: async () => {
      if (!dupQuery || dupQuery.length < 3) return null
      const { data } = await api.get('/admin/products/check-duplicate', { params: { name: dupQuery } })
      return data
    },
    enabled: dupQuery.length >= 3 && !dupDismissed,
  })

  const duplicates = dupResult?.duplicates ?? []

  // Trigger debounced search when name changes
  const handleNameChange = (value: string) => {
    setTranslation(activeLang, { name: value })
    setDupDismissed(false)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDupQuery(value.trim())
    }, 500)
  }

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const currentTrans = translations[activeLang]

  const validate = () => {
    const e: Record<string, string> = {}
    if (!translations.de.name) e.name = t('wizard.nameRequired')
    if (!categoryId) e.category = t('wizard.categoryRequired')
    if (!basePrice || basePrice <= 0) e.price = t('wizard.priceRequired')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => {
    if (!validate()) return
    setStep('variants')
  }

  const hasExact = duplicates.some((d: any) => d.type === 'exact_name')
  const hasSimilar = duplicates.length > 0

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('wizard.basics')}</h2>
        <p className="text-sm text-muted-foreground">{t('wizard.basicsDesc')}</p>
      </div>

      {/* Language Tabs */}
      <div className="border rounded-xl overflow-hidden">
        <div className="flex border-b bg-muted/30">
          {LANGS.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setActiveLang(lang.code)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                activeLang === lang.code ? 'bg-background border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{lang.flag}</span>
              {lang.label}
              {translations[lang.code]?.name && <span className="h-2 w-2 rounded-full bg-green-500" />}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {t('wizard.productName')} ({activeLang.toUpperCase()}) {activeLang === 'de' && <span className="text-destructive">*</span>}
            </label>
            <Input
              value={currentTrans?.name ?? ''}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={activeLang === 'de' ? 'z.B. Winterjacke Classic' : activeLang === 'en' ? 'e.g. Classic Winter Jacket' : 'مثال: جاكيت شتوي كلاسيكي'}
              className={errors.name && activeLang === 'de' ? 'border-destructive' : hasExact ? 'border-red-500 ring-2 ring-red-500/20' : hasSimilar && !dupDismissed ? 'border-orange-500 ring-2 ring-orange-500/20' : ''}
              dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
            />
            {errors.name && activeLang === 'de' && <p className="text-xs text-destructive mt-1">{errors.name}</p>}

            {/* ── Duplicate Warning ── */}
            {hasSimilar && !dupDismissed && (
              <div className={`mt-3 rounded-xl border p-4 ${hasExact ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`} style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className={`h-4 w-4 ${hasExact ? 'text-red-600' : 'text-amber-600'}`} />
                  <span className={`text-sm font-semibold ${hasExact ? 'text-red-800' : 'text-amber-800'}`}>
                    {hasExact
                      ? (locale === 'ar' ? 'المنتج موجود بالفعل!' : locale === 'en' ? 'Product already exists!' : 'Produkt existiert bereits!')
                      : (locale === 'ar' ? 'منتجات مشابهة موجودة:' : locale === 'en' ? 'Similar products found:' : 'Ähnliche Produkte gefunden:')}
                  </span>
                </div>

                <div className="space-y-2">
                  {duplicates.map((dup: any) => (
                    <div key={dup.product.id} className="flex items-center gap-3 bg-white/80 rounded-lg p-3 border border-white">
                      {/* Thumbnail */}
                      {dup.product.image ? (
                        <img src={dup.product.image} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'صورة' : 'IMG'}</span>
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{getProductName(dup.product.translations, locale)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {dup.product.sku && <span className="font-mono">{dup.product.sku}</span>}
                          {dup.product.category && <span className="ml-2">{getCategoryName(dup.product.category, locale)}</span>}
                          <span className="ml-2">{formatCurrency(dup.product.price, locale)}</span>
                        </div>
                        <div className="text-[10px] mt-0.5">
                          {dup.type === 'exact_name' && <span className="text-red-600 font-semibold">{locale === 'ar' ? 'تطابق تام' : locale === 'en' ? 'Exact match' : 'Exakter Treffer'}</span>}
                          {dup.type === 'similar_name' && <span className="text-amber-600 font-semibold">{locale === 'ar' ? 'تشابه' : locale === 'en' ? 'Similar' : 'Ähnlich'}</span>}
                          {dup.type === 'sku' && <span className="text-red-600 font-semibold">SKU {locale === 'ar' ? 'موجود' : locale === 'en' ? 'exists' : 'vergeben'}</span>}
                          {dup.type === 'barcode' && <span className="text-red-600 font-semibold">{locale === 'ar' ? 'باركود موجود' : locale === 'en' ? 'Barcode exists' : 'Barcode vergeben'}</span>}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Link href={`/${locale}/admin/products/${dup.product.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                          <ExternalLink className="h-3 w-3" />
                          {locale === 'ar' ? 'فتح' : locale === 'en' ? 'Open' : 'Öffnen'}
                        </Link>
                        <Link href={`/${locale}/admin/products/${dup.product.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors">
                          <Plus className="h-3 w-3" />
                          {locale === 'ar' ? 'إضافة متغير' : locale === 'en' ? 'Add variant' : 'Variante'}
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={() => setDupDismissed(true)}
                  className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {locale === 'ar' ? 'إنشاء منتج جديد على أي حال' : locale === 'en' ? 'Create new product anyway' : 'Trotzdem neu erstellen'}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('wizard.description')} ({activeLang.toUpperCase()})</label>
            <textarea
              value={currentTrans?.description ?? ''}
              onChange={(e) => setTranslation(activeLang, { description: e.target.value })}
              placeholder={activeLang === 'ar' ? 'وصف المنتج...' : 'Produktbeschreibung...'}
              className="w-full h-32 px-3 py-2 rounded-lg border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* SEO Fields */}
          <details className="group">
            <summary className="flex items-center gap-2 text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
              <Globe className="h-4 w-4" />
              {t('wizard.seoFields')} ({activeLang.toUpperCase()})
            </summary>
            <div className="mt-3 space-y-3 pl-6">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t('wizard.metaTitle')}</label>
                <Input
                  value={currentTrans?.metaTitle ?? ''}
                  onChange={(e) => setTranslation(activeLang, { metaTitle: e.target.value })}
                  placeholder="Meta-Titel"
                  className="text-sm"
                  dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t('wizard.metaDescription')}</label>
                <textarea
                  value={currentTrans?.metaDesc ?? ''}
                  onChange={(e) => setTranslation(activeLang, { metaDesc: e.target.value })}
                  placeholder="Meta-Beschreibung (max. 160 Zeichen)"
                  maxLength={160}
                  className="w-full h-20 px-3 py-2 rounded-lg border bg-background text-sm resize-none"
                  dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
                />
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* Category (Two-step) + Price */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('wizard.category')} <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2">
            <select
              value={selectedDept}
              onChange={(e) => { setSelectedDept(e.target.value); setCategoryId('') }}
              className="w-1/2 h-10 px-3 rounded-lg border bg-background text-sm"
            >
              <option value="">—</option>
              {(categories ?? []).map((dept: any) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name ?? dept.translations?.[0]?.name ?? dept.slug}
                </option>
              ))}
            </select>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={`w-1/2 h-10 px-3 rounded-lg border bg-background text-sm ${errors.category ? 'border-destructive' : ''}`}
              disabled={!selectedDept}
            >
              <option value="">{t('wizard.selectCategory')}</option>
              {(categories ?? []).find((d: any) => d.id === selectedDept)?.children?.map((sub: any) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name ?? sub.translations?.[0]?.name ?? sub.slug}
                </option>
              ))}
            </select>
          </div>
          {errors.category && <p className="text-xs text-destructive mt-1">{errors.category}</p>}
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('wizard.slug')}</label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="automatisch-generiert" className="font-mono text-sm" />
          <p className="text-xs text-muted-foreground mt-1">/{slug || 'produkt-name'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('wizard.basePrice')} <span className="text-destructive">*</span>
          </label>
          <Input
            type="number"
            min={0}
            step={0.01}
            value={basePrice || ''}
            onChange={(e) => setBasePrice(Number(e.target.value))}
            placeholder="29.99"
            className={errors.price ? 'border-destructive' : ''}
          />
          {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label>
          <Input
            type="number"
            min={0}
            step={0.01}
            value={salePrice ?? ''}
            onChange={(e) => setSalePrice(e.target.value ? Number(e.target.value) : null)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label>
          <Input type="number" value={taxRate} readOnly className="bg-muted" />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleNext} size="lg" className="gap-2">
          {t('wizard.nextVariants')} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <style>{`@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
