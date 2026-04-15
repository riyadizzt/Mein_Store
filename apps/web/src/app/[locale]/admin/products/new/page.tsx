'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Save, Eye, Globe, ChevronDown, X, Plus, Upload, Star, Image as ImageIcon,
  AlertTriangle, ExternalLink, Shirt, Footprints, Baby,
  Package, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, getProductName } from '@/lib/locale-utils'
import { COLOR_PRESETS, getColorStyle } from '@/lib/color-presets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

// Flattened preset list backed by the shared COLOR_PRESETS source of truth.
// We keep the DE name as the canonical identifier (`name`) so existing
// variants saved with e.g. `color: 'Schwarz'` still match on re-edit, but
// we also expose `labels` so the picker can render in the admin's locale.
const PRESET_COLORS = COLOR_PRESETS.map((c) => ({
  name: c.name.de,
  hex: c.hex,
  labels: c.name,
}))

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

  // Images — ONE unified gallery, colorName nullable
  const [images, setImages] = useState<ImageEntry[]>([])
  const [assigningImageId, setAssigningImageId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Colors
  const [colors, setColors] = useState<ColorEntry[]>([])
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [customColorName, setCustomColorName] = useState('')
  const [customColorHex, setCustomColorHex] = useState('#000000')

  // Sizes
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

  // ── Image Handlers ──
  const addImages = (files: FileList | File[]) => {
    const newImages: ImageEntry[] = Array.from(files).map((file, i) => ({
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      url: URL.createObjectURL(file),
      file,
      colorName: null,
      isPrimary: images.length === 0 && i === 0,
    }))
    setImages((prev) => [...prev, ...newImages])
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id)
      if (filtered.length > 0 && !filtered.some((i) => i.isPrimary)) filtered[0].isPrimary = true
      return filtered
    })
  }

  const setPrimaryImage = (id: string) => setImages((prev) => prev.map((i) => ({ ...i, isPrimary: i.id === id })))

  const assignImageToColor = (imageId: string, colorName: string | null) => {
    setImages((prev) => prev.map((img) => img.id === imageId ? { ...img, colorName } : img))
    setAssigningImageId(null)
  }

  // ── Other Handlers ──
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
    if (color) setImages((prev) => prev.map((img) => img.colorName === color.name ? { ...img, colorName: null } : img))
  }

  const toggleSize = (size: string) => { const n = new Set(selectedSizes); n.has(size) ? n.delete(size) : n.add(size); setSelectedSizes(n) }
  const addCustomSize = () => { const s = customSizeInput.trim(); if (!s || selectedSizes.has(s)) return; setSelectedSizes(new Set([...selectedSizes, s])); setCustomSizeInput('') }

  const variants = colors.flatMap((color) =>
    [...selectedSizes].map((size) => ({
      key: `${color.name}-${size}`, color: color.name, colorHex: color.hex, size,
      sku: `MAL-${slug ? slug.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') : 'NEW'}-${color.name.slice(0, 3).toUpperCase()}-${size}`,
    }))
  )

  const applyBulkStock = () => { if (bulkStock === '') return; const n: Record<string, number> = {}; for (const v of variants) n[v.key] = Number(bulkStock); setVariantStocks(n) }

  const [imageWarning, setImageWarning] = useState(false)

  const validate = () => {
    const e: Record<string, string> = {}
    if (!translations.de.name.trim()) e.name = t('wizard.nameRequired')
    if (!categoryId) e.category = t('wizard.categoryRequired')
    if (!basePrice || basePrice <= 0) e.price = t('wizard.priceRequired')
    setErrors(e)
    setImageWarning(images.length === 0)
    if (Object.keys(e).length > 0) document.getElementById(`section-${Object.keys(e)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return Object.keys(e).length === 0
  }

  const handleSave = async (isActive: boolean) => {
    if (!validate()) return
    setSaving(true)
    try {
      // 1. Create product + variants
      const { data: created } = await api.post('/products', {
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

      const productId = created?.id

      // 2. Upload images to Supabase (if product was created and images exist)
      if (productId && images.length > 0) {
        // Admin routes require the admin token, not the customer token.
        // /admin/products/:id/images/upload is admin-only and used to 401
        // silently because this block grabbed accessToken instead.
        const store = (await import('@/store/auth-store')).useAuthStore.getState()
        const token = store.adminAccessToken || store.accessToken
        let uploadFailed = 0

        for (const img of images) {
          if (!img.file) continue
          try {
            const formData = new FormData()
            formData.append('file', img.file)
            if (img.colorName) formData.append('colorName', img.colorName)

            const res = await fetch(`${API_BASE_URL}/api/v1/admin/products/${productId}/images/upload`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              credentials: 'include',
              body: formData,
            })
            if (!res.ok) {
              uploadFailed++
              // eslint-disable-next-line no-console
              console.error(`[new-product] image upload failed: ${res.status} ${res.statusText}`)
            }
          } catch (e: any) {
            uploadFailed++
            // eslint-disable-next-line no-console
            console.error('[new-product] image upload threw:', e?.message ?? e)
          }
        }

        if (uploadFailed > 0) {
          setErrors({ save: `${locale === 'ar' ? 'تم إنشاء المنتج لكن فشل رفع' : 'Produkt erstellt, aber'} ${uploadFailed} ${locale === 'ar' ? 'صور' : 'Bilder fehlgeschlagen'}` })
          // Still redirect — product was created, only some images failed
        }
      }

      router.push(`/${locale}/admin/products`)
    } catch (err: any) { setErrors({ save: err?.message ?? 'Error' }) }
    finally { setSaving(false) }
  }

  const duplicates = dupResult?.duplicates ?? []
  const hasDup = duplicates.length > 0 && !dupDismissed

  // Image counts per color
  const getColorImages = (colorName: string) => images.filter((img) => img.colorName === colorName)

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <AdminBreadcrumb items={[{ label: t('products.title'), href: `/${locale}/admin/products` }, { label: t('wizard.newProduct') }]} />
      <h1 className="text-2xl font-bold mb-8">{t('wizard.newProduct')}</h1>

      {/* ══════════ Section 1: BILDER-GALERIE ══════════ */}
      <section className={`bg-background border rounded-2xl overflow-hidden mb-6 ${imageWarning ? 'border-orange-300' : ''}`} style={{ animation: 'fadeSlideUp 400ms ease-out' }}>
        <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2"><ImageIcon className="h-4 w-4" />{t('wizard.images')}</span>
          <span className="text-xs text-muted-foreground">{images.length} {locale === 'ar' ? 'صورة' : 'Bilder'}</span>
        </div>
        {imageWarning && (
          <div className="mx-6 mt-4 px-4 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-xs flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {locale === 'ar' ? 'لم يتم إضافة صور — المنتج سيظهر بدون صورة' : 'Keine Bilder hinzugefügt — Produkt wird ohne Bild angezeigt'}
          </div>
        )}
        <div className="p-6">
          {/* Upload Zone — click (via hidden input) OR drag & drop */}
          <label
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isDragOver) setIsDragOver(true)
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // Only clear when leaving the label itself (not its children)
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setIsDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragOver(false)
              const dropped = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
              if (dropped.length > 0) addImages(dropped)
            }}
            className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all mb-4 ${
              isDragOver
                ? 'border-[#d4a853] bg-[#d4a853]/10 scale-[1.01]'
                : 'hover:border-[#d4a853]/50 hover:bg-[#d4a853]/5'
            }`}
          >
            <Upload
              className={`h-8 w-8 mx-auto mb-2 transition-colors ${
                isDragOver ? 'text-[#d4a853]' : 'text-muted-foreground/40'
              }`}
            />
            <p className="text-sm text-muted-foreground">{t('wizard.uploadZone')}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('wizard.uploadHint')}</p>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addImages(e.target.files) }} />
          </label>

          {/* Image Grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {images.map((img) => {
                const assignedColor = img.colorName ? colors.find((c) => c.name === img.colorName) : null
                return (
                  <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden border-2 group hover:shadow-lg transition-all cursor-pointer"
                    style={{ borderColor: assignedColor ? assignedColor.hex : 'transparent' }}>
                    <img src={img.url} alt="" className="w-full h-full object-cover" />

                    {/* Primary badge */}
                    {img.isPrimary && (
                      <div className="absolute top-1.5 left-1.5 rtl:left-auto rtl:right-1.5">
                        <Star className="h-4 w-4 text-[#d4a853] fill-[#d4a853] drop-shadow" />
                      </div>
                    )}

                    {/* Color assignment badge */}
                    {assignedColor && (
                      <div className="absolute bottom-1.5 left-1.5 rtl:left-auto rtl:right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm">
                        <div className="h-3 w-3 rounded-full border border-white/50" style={{ backgroundColor: assignedColor.hex }} />
                        <span className="text-[9px] text-white font-medium">{translateColor(assignedColor.name, locale)}</span>
                      </div>
                    )}

                    {/* Hover overlay with actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                      {/* Set as primary */}
                      {!img.isPrimary && (
                        <button onClick={(e) => { e.stopPropagation(); setPrimaryImage(img.id) }}
                          className="w-full py-1 rounded-lg bg-white/90 text-[10px] font-medium text-gray-800 hover:bg-white transition-colors flex items-center justify-center gap-1">
                          <Star className="h-3 w-3" />{locale === 'ar' ? 'رئيسي' : 'Hauptbild'}
                        </button>
                      )}

                      {/* Assign to color */}
                      {colors.length > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); setAssigningImageId(assigningImageId === img.id ? null : img.id) }}
                          className="w-full py-1 rounded-lg bg-white/90 text-[10px] font-medium text-gray-800 hover:bg-white transition-colors">
                          {img.colorName ? (locale === 'ar' ? 'تغيير اللون' : 'Farbe ändern') : (locale === 'ar' ? 'تعيين لون' : 'Farbe zuweisen')}
                        </button>
                      )}

                      {/* Remove */}
                      <button onClick={(e) => { e.stopPropagation(); removeImage(img.id) }}
                        className="w-full py-1 rounded-lg bg-red-500/90 text-[10px] font-medium text-white hover:bg-red-600 transition-colors flex items-center justify-center gap-1">
                        <X className="h-3 w-3" />{locale === 'ar' ? 'حذف' : 'Entfernen'}
                      </button>
                    </div>

                    {/* Color assignment dropdown */}
                    {assigningImageId === img.id && (
                      <div className="absolute inset-x-0 bottom-0 bg-white rounded-b-xl shadow-lg border-t z-10 p-2" onClick={(e) => e.stopPropagation()} style={{ animation: 'fadeSlideUp 150ms ease-out' }}>
                        <button onClick={() => assignImageToColor(img.id, null)}
                          className={`w-full text-start px-2 py-1.5 rounded-lg text-xs hover:bg-muted transition-colors ${!img.colorName ? 'bg-muted font-semibold' : ''}`}>
                          {locale === 'ar' ? 'بدون لون (عام)' : 'Kein Farbe (Allgemein)'}
                        </button>
                        {colors.map((c) => (
                          <button key={c.id} onClick={() => assignImageToColor(img.id, c.name)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-muted transition-colors ${img.colorName === c.name ? 'bg-muted font-semibold' : ''}`}>
                            <div className="h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} />
                            {translateColor(c.name, locale)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ══════════ Section 2: GRUNDDATEN ══════════ */}
      <section id="section-name" className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 50ms both' }}>
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
              dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
            {errors.name && activeLang === 'de' && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            {hasDup && (
              <div className="mt-3 rounded-xl border p-3 bg-amber-50 border-amber-200" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                <div className="flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-sm font-semibold text-amber-800">{locale === 'ar' ? 'منتجات مشابهة:' : 'Ähnliche Produkte:'}</span></div>
                {duplicates.slice(0, 3).map((d: any) => (
                  <div key={d.product.id} className="flex items-center gap-2 bg-white/80 rounded-lg p-2 mt-1">
                    <span className="text-sm flex-1 truncate">{getProductName(d.product.translations, locale)}</span>
                    <a href={`/${locale}/admin/products/${d.product.id}`} className="text-xs text-primary"><ExternalLink className="h-3 w-3" /></a>
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
                <select value={selectedDept} onChange={(e) => { setSelectedDept(e.target.value); setCategoryId('') }} className="w-1/2 h-10 px-3 rounded-xl border bg-background text-sm"><option value="">—</option>{(categories ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name ?? d.translations?.[0]?.name ?? d.slug}</option>)}</select>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`w-1/2 h-10 px-3 rounded-xl border bg-background text-sm ${errors.category ? 'border-destructive' : ''}`} disabled={!selectedDept}>
                  <option value="">{t('wizard.selectCategory')}</option>{(categories ?? []).find((d: any) => d.id === selectedDept)?.children?.map((s: any) => <option key={s.id} value={s.id}>{s.name ?? s.translations?.[0]?.name}</option>)}</select>
              </div>
              {errors.category && <p className="text-xs text-destructive mt-1">{errors.category}</p>}
            </div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.slug')}</label><Input value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-xl font-mono text-sm" /></div>
          </div>
          <div id="section-price" className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.basePrice')} <span className="text-destructive">*</span></label>
              <Input type="number" min={0} step={0.01} value={basePrice || ''} onChange={(e) => setBasePrice(+e.target.value)} className={`rounded-xl ${errors.price ? 'border-destructive' : ''}`} placeholder="29.99" />{errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}</div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label><Input type="number" min={0} step={0.01} value={salePrice ?? ''} onChange={(e) => setSalePrice(e.target.value ? +e.target.value : null)} className="rounded-xl" placeholder="Optional" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label><Input value={19} readOnly className="rounded-xl bg-muted" /></div>
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

      {/* ══════════ Section 3: FARBEN ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 100ms both' }}>
        <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
          <span className="font-semibold text-sm">{t('wizard.colors')}</span>
          <button onClick={() => setShowColorPicker(!showColorPicker)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#d4a853]/10 text-[#d4a853] hover:bg-[#d4a853]/20 border border-[#d4a853]/20"><Plus className="h-3 w-3" />{t('inventory.addNewColor')}</button>
        </div>
        <div className="p-6">
          {showColorPicker && (
            <div className="mb-4 p-4 rounded-xl border bg-muted/10" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {PRESET_COLORS.filter((c) => !colors.some((cc) => cc.name === c.name)).map((c) => (
                  <button key={c.name} onClick={() => { addColor(c.name, c.hex); setShowColorPicker(false) }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-muted-foreground/15 hover:border-primary/40 hover:bg-primary/5 transition-all text-xs">
                    <div className="h-4 w-4 rounded-full border border-white shadow-sm" style={getColorStyle(c.hex)} />
                    {locale === 'ar' ? c.labels.ar : locale === 'en' ? c.labels.en : c.labels.de}
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

          {/* Selected colors with image count */}
          {colors.length > 0 ? (
            <div className="space-y-2">
              {colors.map((color) => {
                const colorImgs = getColorImages(color.name)
                return (
                  <div key={color.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border hover:border-primary/20 transition-all group" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                    <div className="h-8 w-8 rounded-full border-2 border-white shadow" style={getColorStyle(color.hex)} />
                    <div className="flex-1">
                      <span className="text-sm font-semibold">{translateColor(color.name, locale)}</span>
                      <span className="text-xs text-muted-foreground ms-2">
                        {colorImgs.length > 0 ? `${colorImgs.length} ${locale === 'ar' ? 'صور' : 'Bilder'}` : (locale === 'ar' ? 'بدون صور — عيّن صوراً من المعرض' : 'Keine Bilder — weise Bilder aus der Galerie zu')}
                      </span>
                    </div>
                    {/* Mini thumbnails of assigned images */}
                    {colorImgs.length > 0 && (
                      <div className="flex -space-x-2">{colorImgs.slice(0, 3).map((img) => (
                        <img key={img.id} src={img.url} alt="" className="h-8 w-8 rounded-lg object-cover border-2 border-white" />
                      ))}</div>
                    )}
                    <button onClick={() => removeColor(color.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-sm"><Package className="h-6 w-6 mx-auto mb-2 opacity-20" />{locale === 'ar' ? 'أضف لوناً للبدء' : 'Farbe hinzufügen'}</div>
          )}
        </div>
      </section>

      {/* ══════════ Section 4: GRÖßEN ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 150ms both' }}>
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm">{locale === 'ar' ? 'المقاسات' : 'Größen'}</div>
        <div className="p-6">
          <div className="flex gap-2 mb-4">
            {Object.entries(SIZE_PRESETS).map(([key, sys]) => { const Icon = sys.icon; return (
              <button key={key} onClick={() => setSizePreset(key)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${sizePreset === key ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}><Icon className="h-4 w-4" />{sys.label}</button>
            )})}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {SIZE_PRESETS[sizePreset].sizes.map((size) => (
              <button key={size} onClick={() => toggleSize(size)} className={`h-10 min-w-[44px] px-3 rounded-xl text-sm font-bold transition-all ${selectedSizes.has(size) ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>{size}</button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <Input value={customSizeInput} onChange={(e) => setCustomSizeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSize() } }}
              placeholder={locale === 'ar' ? 'مقاس مخصص...' : 'Eigene Größe...'} className="rounded-xl text-sm max-w-xs" />
            <Button size="sm" variant="outline" className="rounded-xl" onClick={addCustomSize} disabled={!customSizeInput.trim()}><Plus className="h-3 w-3" /></Button>
          </div>
          {[...selectedSizes].filter((s) => !SIZE_PRESETS[sizePreset].sizes.includes(s)).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
              {[...selectedSizes].filter((s) => !SIZE_PRESETS[sizePreset].sizes.includes(s)).map((size) => (
                <button key={size} onClick={() => toggleSize(size)} className="h-10 px-3 rounded-xl text-sm font-bold bg-[#1a1a2e] text-white shadow-md flex items-center gap-1.5">{size} <X className="h-3 w-3 opacity-60" /></button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ══════════ Section 5: VARIANTEN ══════════ */}
      {variants.length > 0 && (
        <section className="bg-background border rounded-2xl overflow-hidden mb-6" style={{ animation: 'fadeSlideUp 400ms ease-out 200ms both' }}>
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
                <th className="text-start px-4 py-2.5 text-sm font-semibold text-muted-foreground">{t('inventory.variant')}</th>
                <th className="text-start px-4 py-2.5 text-sm font-semibold text-muted-foreground">SKU</th>
                <th className="text-center px-4 py-2.5 text-sm font-semibold text-muted-foreground">{t('products.price')}</th>
                <th className="text-center px-4 py-2.5 text-sm font-semibold text-muted-foreground">{t('products.stock')}</th>
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

      {/* ══════════ Sticky Save Bar ══════════ */}
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
