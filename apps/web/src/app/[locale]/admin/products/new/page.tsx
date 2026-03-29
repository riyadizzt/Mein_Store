'use client'

import { useState, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Save, Eye, Globe, ChevronDown, X, Plus, Upload, Star,
  AlertTriangle, ExternalLink, Shirt, Footprints, Baby,
  Package, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, getProductName } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

const PRESET_COLORS = [
  { name: 'Schwarz', hex: '#000000' }, { name: 'Weiß', hex: '#ffffff' },
  { name: 'Blau', hex: '#2563eb' }, { name: 'Rot', hex: '#dc2626' },
  { name: 'Grün', hex: '#16a34a' }, { name: 'Grau', hex: '#6b7280' },
  { name: 'Beige', hex: '#d2b48c' }, { name: 'Navy', hex: '#1e3a5f' },
  { name: 'Braun', hex: '#8b4513' }, { name: 'Rosa', hex: '#ec4899' },
  { name: 'Gelb', hex: '#eab308' }, { name: 'Orange', hex: '#f97316' },
  { name: 'Lila', hex: '#9333ea' }, { name: 'Türkis', hex: '#06b6d4' },
  { name: 'Bordeaux', hex: '#7f1d1d' }, { name: 'Khaki', hex: '#a3a23a' },
  { name: 'Silber', hex: '#c0c0c0' }, { name: 'Gold', hex: '#d4a853' },
]

const SIZE_PRESETS: Record<string, { label: string; icon: any; sizes: string[] }> = {
  clothing: { label: 'Kleidung', icon: Shirt, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] },
  shoes: { label: 'Schuhe', icon: Footprints, sizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  kids: { label: 'Kinder', icon: Baby, sizes: ['50', '56', '62', '68', '74', '80', '86', '92', '98', '104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164'] },
}

interface ColorEntry { id: string; name: string; hex: string }
interface ImageEntry { id: string; url: string; file?: File; colorName: string | null; isPrimary: boolean }

export default function NewProductPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()

  // Basics
  const [activeLang, setActiveLang] = useState('de')
  const [translations, setTranslations] = useState<Record<string, { name: string; description: string; metaTitle: string; metaDesc: string }>>({
    de: { name: '', description: '', metaTitle: '', metaDesc: '' },
    en: { name: '', description: '', metaTitle: '', metaDesc: '' },
    ar: { name: '', description: '', metaTitle: '', metaDesc: '' },
  })
  const [categoryId, setCategoryId] = useState('')
  const [selectedDept, setSelectedDept] = useState('')
  const [slug, setSlug] = useState('')
  const [basePrice, setBasePrice] = useState<number>(0)
  const [salePrice, setSalePrice] = useState<number | null>(null)
  const [showSeo, setShowSeo] = useState(false)

  // Colors
  const [colors, setColors] = useState<ColorEntry[]>([])
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [customColorName, setCustomColorName] = useState('')
  const [customColorHex, setCustomColorHex] = useState('#000000')

  // UNIFIED images — one array, colorName nullable
  const [images, setImages] = useState<ImageEntry[]>([])

  // Sizes — flexible
  const [sizePreset, setSizePreset] = useState<string>('clothing')
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set())
  const [customSizeInput, setCustomSizeInput] = useState('')

  // Variants
  const [variantStocks, setVariantStocks] = useState<Record<string, number>>({})
  const [variantPrices, setVariantPrices] = useState<Record<string, number>>({})
  const [bulkStock, setBulkStock] = useState<number | ''>('')

  // Save
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Duplicate detection
  const [dupQuery, setDupQuery] = useState('')
  const [dupDismissed, setDupDismissed] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => { const { data } = await api.get('/categories'); return Array.isArray(data) ? data : data?.data ?? [] },
  })

  const { data: dupResult } = useQuery({
    queryKey: ['check-duplicate', dupQuery],
    queryFn: async () => { if (!dupQuery || dupQuery.length < 3) return null; const { data } = await api.get('/admin/products/check-duplicate', { params: { name: dupQuery } }); return data },
    enabled: dupQuery.length >= 3 && !dupDismissed,
  })

  // ── Handlers ──

  const handleNameChange = (lang: string, value: string) => {
    setTranslations((prev) => ({ ...prev, [lang]: { ...prev[lang], name: value } }))
    if (lang === 'de') {
      setSlug(value.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss'))
      setDupDismissed(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => setDupQuery(value.trim()), 500)
    }
  }

  const addColor = (name: string, hex: string) => {
    if (colors.some((c) => c.name === name)) return
    setColors([...colors, { id: `c-${Date.now()}`, name, hex }])
  }

  const removeColor = (id: string) => {
    const color = colors.find((c) => c.id === id)
    setColors(colors.filter((c) => c.id !== id))
    // Remove images assigned to this color
    if (color) setImages(images.filter((img) => img.colorName !== color.name))
  }

  // Add image for a specific color
  const addColorImage = (colorName: string, file: File) => {
    const url = URL.createObjectURL(file)
    // Remove existing image for this color, add new one
    setImages((prev) => {
      const filtered = prev.filter((img) => img.colorName !== colorName)
      return [...filtered, { id: `img-${Date.now()}`, url, file, colorName, isPrimary: filtered.length === 0 }]
    })
  }

  // Add general image (no color)
  const addGeneralImage = (file: File) => {
    const url = URL.createObjectURL(file)
    setImages((prev) => [...prev, { id: `img-${Date.now()}-${Math.random()}`, url, file, colorName: null, isPrimary: prev.length === 0 }])
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id)
      if (filtered.length > 0 && !filtered.some((i) => i.isPrimary)) filtered[0].isPrimary = true
      return filtered
    })
  }

  const setPrimaryImage = (id: string) => setImages((prev) => prev.map((i) => ({ ...i, isPrimary: i.id === id })))

  // Sizes
  const toggleSize = (size: string) => {
    const next = new Set(selectedSizes)
    next.has(size) ? next.delete(size) : next.add(size)
    setSelectedSizes(next)
  }

  const addCustomSize = () => {
    const s = customSizeInput.trim()
    if (!s || selectedSizes.has(s)) return
    setSelectedSizes(new Set([...selectedSizes, s]))
    setCustomSizeInput('')
  }

  // Variants
  const variants = colors.flatMap((color) =>
    [...selectedSizes].map((size) => ({
      key: `${color.name}-${size}`,
      color: color.name, colorHex: color.hex, size,
      sku: `MAL-${slug ? slug.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') : 'NEW'}-${color.name.slice(0, 3).toUpperCase()}-${size}`,
    }))
  )

  const applyBulkStock = () => {
    if (bulkStock === '') return
    const next: Record<string, number> = {}
    for (const v of variants) next[v.key] = Number(bulkStock)
    setVariantStocks(next)
  }

  // Validate + Save
  const validate = () => {
    const e: Record<string, string> = {}
    if (!translations.de.name.trim()) e.name = t('wizard.nameRequired')
    if (!categoryId) e.category = t('wizard.categoryRequired')
    if (!basePrice || basePrice <= 0) e.price = t('wizard.priceRequired')
    setErrors(e)
    if (Object.keys(e).length > 0) document.getElementById(`section-${Object.keys(e)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return Object.keys(e).length === 0
  }

  const handleSave = async (isActive: boolean) => {
    if (!validate()) return
    setSaving(true)
    try {
      await api.post('/products', {
        slug, categoryId, basePrice, salePrice, taxRate: 19, isActive,
        translations: Object.entries(translations).filter(([, t]) => t.name).map(([lang, t]) => ({
          language: lang, name: t.name, description: t.description || undefined, metaTitle: t.metaTitle || undefined, metaDesc: t.metaDesc || undefined,
        })),
        variants: variants.map((v) => ({
          sku: v.sku, color: v.color, colorHex: v.colorHex, size: v.size,
          priceModifier: (variantPrices[v.key] ?? basePrice) - basePrice,
          weightGrams: 500, initialStock: variantStocks[v.key] ?? 0,
        })),
      })
      router.push(`/${locale}/admin/products`)
    } catch (err: any) {
      setErrors({ save: err?.message ?? 'Error' })
    } finally { setSaving(false) }
  }

  const duplicates = dupResult?.duplicates ?? []
  const hasDup = duplicates.length > 0 && !dupDismissed
  const generalImages = images.filter((img) => !img.colorName)
  const getColorImage = (colorName: string) => images.find((img) => img.colorName === colorName)

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <AdminBreadcrumb items={[{ label: t('products.title'), href: `/${locale}/admin/products` }, { label: t('wizard.newProduct') }]} />
      <h1 className="text-2xl font-bold mb-8">{t('wizard.newProduct')}</h1>

      {/* ── Section 1: Basics ── */}
      <section id="section-name" className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm">{t('wizard.basics')}</div>
        <div className="flex border-b">
          {LANGS.map((lang) => (
            <button key={lang.code} onClick={() => setActiveLang(lang.code)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${activeLang === lang.code ? 'bg-background border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {lang.flag} {lang.label} {translations[lang.code]?.name && <span className="h-2 w-2 rounded-full bg-green-500" />}
            </button>
          ))}
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('wizard.productName')} ({activeLang.toUpperCase()}) {activeLang === 'de' && <span className="text-destructive">*</span>}</label>
            <Input value={translations[activeLang]?.name ?? ''} onChange={(e) => handleNameChange(activeLang, e.target.value)}
              className={`text-lg h-12 rounded-xl ${errors.name && activeLang === 'de' ? 'border-destructive ring-2 ring-destructive/20' : ''}`}
              dir={activeLang === 'ar' ? 'rtl' : 'ltr'} placeholder={activeLang === 'de' ? 'z.B. Winterjacke Classic' : activeLang === 'en' ? 'e.g. Classic Winter Jacket' : 'جاكيت شتوي كلاسيكي'} />
            {errors.name && activeLang === 'de' && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            {hasDup && (
              <div className="mt-3 rounded-xl border p-4 bg-amber-50 border-amber-200" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                <div className="flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-sm font-semibold text-amber-800">{locale === 'ar' ? 'منتجات مشابهة:' : 'Ähnliche Produkte:'}</span></div>
                {duplicates.slice(0, 3).map((d: any) => (
                  <div key={d.product.id} className="flex items-center gap-3 bg-white/80 rounded-lg p-2 mt-1">
                    {d.product.image && <img src={d.product.image} alt="" className="h-8 w-8 rounded object-cover" />}
                    <span className="text-sm flex-1 truncate">{getProductName(d.product.translations, locale)}</span>
                    <a href={`/${locale}/admin/products/${d.product.id}`} className="text-xs text-primary flex items-center gap-1"><ExternalLink className="h-3 w-3" /></a>
                  </div>
                ))}
                <button onClick={() => setDupDismissed(true)} className="text-xs text-muted-foreground mt-2">{locale === 'ar' ? 'إنشاء على أي حال' : 'Trotzdem erstellen'}</button>
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('wizard.description')}</label>
            <textarea value={translations[activeLang]?.description ?? ''} onChange={(e) => setTranslations((p) => ({ ...p, [activeLang]: { ...p[activeLang], description: e.target.value } }))}
              className="w-full h-28 px-4 py-3 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
          </div>
          <div id="section-category" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">{t('wizard.category')} <span className="text-destructive">*</span></label>
              <div className="flex gap-2">
                <select value={selectedDept} onChange={(e) => { setSelectedDept(e.target.value); setCategoryId('') }} className="w-1/2 h-10 px-3 rounded-xl border bg-background text-sm"><option value="">—</option>
                  {(categories ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name ?? d.translations?.[0]?.name ?? d.slug}</option>)}</select>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`w-1/2 h-10 px-3 rounded-xl border bg-background text-sm ${errors.category ? 'border-destructive' : ''}`} disabled={!selectedDept}>
                  <option value="">{t('wizard.selectCategory')}</option>
                  {(categories ?? []).find((d: any) => d.id === selectedDept)?.children?.map((s: any) => <option key={s.id} value={s.id}>{s.name ?? s.translations?.[0]?.name}</option>)}</select>
              </div>
              {errors.category && <p className="text-xs text-destructive mt-1">{errors.category}</p>}
            </div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.slug')}</label><Input value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-xl font-mono text-sm" /></div>
          </div>
          <div id="section-price" className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.basePrice')} <span className="text-destructive">*</span></label>
              <Input type="number" min={0} step={0.01} value={basePrice || ''} onChange={(e) => setBasePrice(+e.target.value)} className={`rounded-xl ${errors.price ? 'border-destructive' : ''}`} placeholder="29.99" />
              {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}</div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label><Input type="number" min={0} step={0.01} value={salePrice ?? ''} onChange={(e) => setSalePrice(e.target.value ? +e.target.value : null)} className="rounded-xl" placeholder="Optional" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label><Input type="number" value={19} readOnly className="rounded-xl bg-muted" /></div>
          </div>
          <button onClick={() => setShowSeo(!showSeo)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><Globe className="h-4 w-4" />{t('wizard.seoFields')} <ChevronDown className={`h-3 w-3 transition-transform ${showSeo ? 'rotate-180' : ''}`} /></button>
          {showSeo && (
            <div className="space-y-3 pl-6" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
              <Input value={translations[activeLang]?.metaTitle ?? ''} onChange={(e) => setTranslations((p) => ({ ...p, [activeLang]: { ...p[activeLang], metaTitle: e.target.value } }))} placeholder={t('wizard.metaTitle')} className="rounded-xl text-sm" dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
              <textarea value={translations[activeLang]?.metaDesc ?? ''} onChange={(e) => setTranslations((p) => ({ ...p, [activeLang]: { ...p[activeLang], metaDesc: e.target.value } }))} placeholder={t('wizard.metaDescription')} maxLength={160} className="w-full h-16 px-3 py-2 rounded-xl border bg-background text-sm resize-none" dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
            </div>
          )}
        </div>
      </section>

      {/* ── Section 2: Colors + Images (UNIFIED) ── */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 100ms both' }}>
        <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
          <span className="font-semibold text-sm">{t('wizard.colors')} + {t('wizard.images')}</span>
          <button onClick={() => setShowColorPicker(!showColorPicker)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#d4a853]/10 text-[#d4a853] hover:bg-[#d4a853]/20 border border-[#d4a853]/20"><Plus className="h-3 w-3" />{t('inventory.addNewColor')}</button>
        </div>
        <div className="p-6">
          {showColorPicker && (
            <div className="mb-6 p-4 rounded-xl border bg-muted/10" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {PRESET_COLORS.filter((c) => !colors.some((cc) => cc.name === c.name)).map((c) => (
                  <button key={c.name} onClick={() => { addColor(c.name, c.hex); setShowColorPicker(false) }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-muted-foreground/15 hover:border-primary/40 hover:bg-primary/5 transition-all text-xs">
                    <div className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: c.hex }} />{translateColor(c.name, locale)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <Input value={customColorName} onChange={(e) => setCustomColorName(e.target.value)} placeholder={t('inventory.colorName')} className="rounded-lg text-sm flex-1" />
                <input type="color" value={customColorHex} onChange={(e) => setCustomColorHex(e.target.value)} className="h-9 w-9 rounded-lg border cursor-pointer" />
                <Button size="sm" className="rounded-lg" disabled={!customColorName.trim()} onClick={() => { addColor(customColorName.trim(), customColorHex); setCustomColorName(''); setShowColorPicker(false) }}><Plus className="h-3 w-3" /></Button>
              </div>
            </div>
          )}

          {colors.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm"><Package className="h-8 w-8 mx-auto mb-2 opacity-20" />{locale === 'ar' ? 'أضف لوناً للبدء' : 'Farbe hinzufügen um zu starten'}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {colors.map((color) => {
                const colorImg = getColorImage(color.name)
                return (
                  <div key={color.id} className="relative border rounded-xl overflow-hidden group hover:border-primary/30 hover:shadow-md transition-all" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                    <label className="block aspect-square bg-muted/30 cursor-pointer relative overflow-hidden">
                      {colorImg ? <img src={colorImg.url} alt="" className="w-full h-full object-cover" /> : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40"><Upload className="h-8 w-8 mb-1" /><span className="text-[10px]">{locale === 'ar' ? 'رفع صورة' : 'Bild hochladen'}</span></div>
                      )}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addColorImage(color.name, f) }} />
                    </label>
                    <div className="p-3 flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full border-2 border-white shadow" style={{ backgroundColor: color.hex }} />
                      <span className="text-xs font-semibold flex-1">{translateColor(color.name, locale)}</span>
                    </div>
                    <button onClick={() => removeColor(color.id)} className="absolute top-2 right-2 rtl:right-auto rtl:left-2 h-6 w-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"><X className="h-3 w-3" /></button>
                  </div>
                )
              })}
            </div>
          )}

          {/* General Images (no color assigned) */}
          <div className="mt-6 pt-6 border-t">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 block">{t('wizard.images')} ({locale === 'ar' ? 'عامة' : 'Allgemein'})</label>
            <div className="flex gap-3 flex-wrap">
              {generalImages.map((img) => (
                <div key={img.id} className="relative h-20 w-20 rounded-xl overflow-hidden border group">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  {img.isPrimary && <Star className="absolute top-1 left-1 h-3 w-3 text-[#d4a853] fill-[#d4a853]" />}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {!img.isPrimary && <button onClick={() => setPrimaryImage(img.id)} className="h-5 w-5 rounded-full bg-white flex items-center justify-center"><Star className="h-2.5 w-2.5" /></button>}
                    <button onClick={() => removeImage(img.id)} className="h-5 w-5 rounded-full bg-white flex items-center justify-center"><X className="h-2.5 w-2.5" /></button>
                  </div>
                </div>
              ))}
              <label className="h-20 w-20 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                <Plus className="h-5 w-5 text-muted-foreground/40" />
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) addGeneralImage(f) }} />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Sizes (FLEXIBLE) ── */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 200ms both' }}>
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm">{locale === 'ar' ? 'المقاسات' : 'Größen'}</div>
        <div className="p-6">
          {/* Preset buttons (SUGGESTIONS, not forced) */}
          <div className="flex gap-2 mb-4">
            {Object.entries(SIZE_PRESETS).map(([key, sys]) => {
              const Icon = sys.icon
              return (
                <button key={key} onClick={() => setSizePreset(key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${sizePreset === key ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
                  <Icon className="h-4 w-4" />{sys.label}
                </button>
              )
            })}
          </div>

          {/* Preset chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {SIZE_PRESETS[sizePreset].sizes.map((size) => (
              <button key={size} onClick={() => toggleSize(size)}
                className={`h-10 min-w-[44px] px-3 rounded-xl text-sm font-bold transition-all ${selectedSizes.has(size) ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>{size}</button>
            ))}
          </div>

          {/* Custom size input */}
          <div className="flex gap-2 items-center">
            <Input value={customSizeInput} onChange={(e) => setCustomSizeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSize() } }}
              placeholder={locale === 'ar' ? 'مقاس مخصص: One Size, 7XL, 50/52...' : 'Eigene Größe: One Size, 7XL, 50/52...'}
              className="rounded-xl text-sm max-w-xs" />
            <Button size="sm" variant="outline" className="rounded-xl" onClick={addCustomSize} disabled={!customSizeInput.trim()}><Plus className="h-3 w-3" /></Button>
          </div>

          {/* Show custom sizes that aren't in preset */}
          {[...selectedSizes].filter((s) => !SIZE_PRESETS[sizePreset].sizes.includes(s)).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground self-center">{locale === 'ar' ? 'مخصص:' : 'Eigene:'}</span>
              {[...selectedSizes].filter((s) => !SIZE_PRESETS[sizePreset].sizes.includes(s)).map((size) => (
                <button key={size} onClick={() => toggleSize(size)}
                  className="h-10 px-3 rounded-xl text-sm font-bold bg-[#1a1a2e] text-white shadow-md flex items-center gap-1.5">
                  {size} <X className="h-3 w-3 opacity-60" />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: Variants ── */}
      {variants.length > 0 && (
        <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 300ms both' }}>
          <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
            <span className="font-semibold text-sm">{variants.length} {t('products.variants')}</span>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} value={bulkStock} onChange={(e) => setBulkStock(e.target.value ? +e.target.value : '')} placeholder={t('wizard.stockForAll')} className="w-32 h-8 rounded-lg text-xs" />
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={applyBulkStock}>{t('wizard.set')}</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground">{t('inventory.variant')}</th>
                <th className="text-start px-4 py-2.5 text-xs font-semibold text-muted-foreground">SKU</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">{t('products.price')}</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">{t('products.stock')}</th>
              </tr></thead>
              <tbody>{variants.map((v, i) => (
                <tr key={v.key} className="border-b hover:bg-muted/10" style={{ animationDelay: `${i * 15}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="h-4 w-4 rounded-full border" style={{ backgroundColor: v.colorHex }} /><span className="text-xs font-medium">{translateColor(v.color, locale)} / {v.size}</span></div></td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{v.sku}</td>
                  <td className="px-4 py-2.5 text-center"><Input type="number" min={0} step={0.01} value={variantPrices[v.key] ?? basePrice} onChange={(e) => setVariantPrices({ ...variantPrices, [v.key]: +e.target.value })} className="w-20 h-7 rounded-lg text-xs text-center mx-auto" /></td>
                  <td className="px-4 py-2.5 text-center"><Input type="number" min={0} value={variantStocks[v.key] ?? ''} onChange={(e) => setVariantStocks({ ...variantStocks, [v.key]: +e.target.value })} className="w-20 h-7 rounded-lg text-xs text-center mx-auto" placeholder="0" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Sticky Save Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {variants.length > 0 && <span>{variants.length} {t('products.variants')}</span>}
            {images.length > 0 && <span className="ml-3">{images.length} {t('wizard.images')}</span>}
            {errors.save && <span className="text-destructive ml-2">{errors.save}</span>}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="rounded-xl gap-2" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}{t('wizard.saveAsDraft')}
            </Button>
            <Button className="rounded-xl gap-2 bg-green-600 hover:bg-green-700" onClick={() => handleSave(true)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('wizard.saveAsActive')}
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}
