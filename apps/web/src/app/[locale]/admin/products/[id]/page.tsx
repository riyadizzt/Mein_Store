'use client'

import { API_BASE_URL } from '@/lib/env'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, Plus, Trash2, Save, Upload, Star, X,
  Image as ImageIcon, Globe, ShoppingBag, ChevronRight, Sparkles,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { api } from '@/lib/api'
import { translateColor, getProductName } from '@/lib/locale-utils'
import { useConfirm } from '@/components/ui/confirm-modal'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { AddColorModal, AddSizeModal, VariantMatrix } from '@/components/admin/add-variant-modals'
import { PrintLabelButton } from '@/components/admin/label-printer'
import { HaengetikettenButton } from '@/components/admin/haengetikett/HaengetikettenModal'
import { FotoEtikettButton } from '@/components/admin/foto-etikett/FotoEtikettModal'
import { BatchFotoEtikettButton } from '@/components/admin/foto-etikett/BatchFotoEtikettButton'
import { AiDescriptionButton } from '@/components/admin/ai-description-button'
import { BatchHaengetikettenButton } from '@/components/admin/haengetikett/BatchHaengetikettenButton'
import { WhatsAppShareButton } from '@/components/admin/whatsapp-share-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAdminCategories } from '@/hooks/use-categories'

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

export default function EditProductPage({ params: { id } }: { params: { id: string; locale: string } }) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const confirmDialog = useConfirm()

  const [activeLang, setActiveLang] = useState('de')
  const [translations, setTranslations] = useState<Record<string, { name: string; description: string; metaTitle: string; metaDesc: string }>>({
    de: { name: '', description: '', metaTitle: '', metaDesc: '' },
    en: { name: '', description: '', metaTitle: '', metaDesc: '' },
    ar: { name: '', description: '', metaTitle: '', metaDesc: '' },
  })
  const [basePrice, setBasePrice] = useState(0)
  const [salePrice, setSalePrice] = useState<number | null>(null)
  const [channelFacebook, setChannelFacebook] = useState(false)
  const [channelTiktok, setChannelTiktok] = useState(false)
  const [channelGoogle, setChannelGoogle] = useState(false)
  const [channelWhatsapp, setChannelWhatsapp] = useState(false)
  const [excludeFromReturns, setExcludeFromReturns] = useState(false)
  const [returnExclusionReason, setReturnExclusionReason] = useState<string | null>(null)
  // Category re-categorize: two cascading dropdowns.
  // parentCategoryId is the top-level category (Herren/Damen/...) derived
  // from either a direct parent selection or by walking up from the current
  // subcategory's parentId. subCategoryId is the leaf we'll PUT on save.
  const [parentCategoryId, setParentCategoryId] = useState<string>('')
  const [subCategoryId, setSubCategoryId] = useState<string>('')
  // Admin variant → returns ALL translations per category (de/en/ar),
  // not filtered to one language, so the dropdown can fall back cleanly
  // AR → DE → EN → slug when a translation row is missing in the DB.
  const { data: allCategories } = useAdminCategories()
  const [showAddColor, setShowAddColor] = useState(false)
  const [showAddSize, setShowAddSize] = useState(false)
  const [showSeo, setShowSeo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [assigningImageId, setAssigningImageId] = useState<string | null>(null)

  const { data: product, isLoading } = useQuery({
    queryKey: ['admin-product', id],
    queryFn: async () => { const { data } = await api.get(`/admin/products/${id}`); return data },
  })

  // Pre-fill
  useEffect(() => {
    if (!product) return
    const t: Record<string, any> = { de: { name: '', description: '', metaTitle: '', metaDesc: '' }, en: { name: '', description: '', metaTitle: '', metaDesc: '' }, ar: { name: '', description: '', metaTitle: '', metaDesc: '' } }
    for (const tr of product.translations ?? []) {
      t[tr.language] = { name: tr.name ?? '', description: tr.description ?? '', metaTitle: tr.metaTitle ?? '', metaDesc: tr.metaDesc ?? '' }
    }
    setTranslations(t)
    setBasePrice(Number(product.basePrice) || 0)
    setSalePrice(product.salePrice ? Number(product.salePrice) : null)
    setChannelFacebook(product.channelFacebook ?? false)
    setChannelTiktok(product.channelTiktok ?? false)
    setChannelGoogle(product.channelGoogle ?? false)
    setChannelWhatsapp(product.channelWhatsapp ?? false)
    setExcludeFromReturns(product.excludeFromReturns ?? false)
    setReturnExclusionReason(product.returnExclusionReason ?? null)
    // Pre-fill the category dropdowns. product.categoryId is the LEAF
    // category. We also need its parent (top-level) so the cascading UI
    // can highlight both rows. product.category.parentId is included in
    // the response from GET /admin/products/:id.
    if (product.categoryId) {
      setSubCategoryId(product.categoryId)
      const parentId = product.category?.parentId ?? null
      setParentCategoryId(parentId ?? product.categoryId) // if it IS a top-level, treat as parent
    }
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMut = useMutation({
    mutationFn: async (variantId: string) => { await api.delete(`/admin/products/${id}/variants/${variantId}`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-product', id] }),
  })

  // Chart preview: ask the backend what SizeChart this product currently
  // resolves to, AND what chart it would resolve to if the admin saved
  // the new categoryId. Lets us warn the admin BEFORE they click save
  // that the customer-visible size guide will change. See sizing
  // controller /admin/chart-preview (Gruppe: Size-Charts Hardening D).
  const chartPreviewTarget = subCategoryId && product?.categoryId && subCategoryId !== product.categoryId
    ? subCategoryId
    : (product?.categoryId ?? null)
  const { data: chartPreview } = useQuery({
    queryKey: ['chart-preview', id, chartPreviewTarget],
    queryFn: async () => {
      const { data } = await api.get(`/sizing/admin/chart-preview`, {
        params: { productId: id, categoryId: chartPreviewTarget },
      })
      return data
    },
    enabled: !!chartPreviewTarget,
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/products/${id}`, {
        basePrice, salePrice,
        // Only send categoryId when the user actually picked something;
        // sending undefined leaves the existing value untouched on the
        // backend (Prisma partial-update semantic). Defensive fallback
        // to the original product.categoryId so we never accidentally
        // null it out on save.
        categoryId: subCategoryId || product?.categoryId,
        channelFacebook, channelTiktok, channelGoogle, channelWhatsapp,
        excludeFromReturns, returnExclusionReason: excludeFromReturns ? returnExclusionReason : null,
        translations: Object.entries(translations)
          .filter(([, t]) => t.name)
          .map(([lang, t]) => ({
            language: lang, name: t.name,
            description: t.description || undefined,
            metaTitle: t.metaTitle || undefined,
            metaDesc: t.metaDesc || undefined,
          })),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-product', id] }),
  })


  // Image upload to Supabase
  const handleImageUpload = async (files: FileList | File[], colorName?: string) => {
    setUploading(true)
    const store = (await import('@/store/auth-store')).useAuthStore.getState()
    const token = store.adminAccessToken || store.accessToken
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      if (colorName) formData.append('colorName', colorName)
      await fetch(`${API_BASE_URL}/api/v1/admin/products/${id}/images/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
      })
    }
    qc.invalidateQueries({ queryKey: ['admin-product', id] })
    setUploading(false)
  }

  const handleDeleteImage = async (imageId: string) => {
    const store = (await import('@/store/auth-store')).useAuthStore.getState()
    const token = store.adminAccessToken || store.accessToken
    await fetch(`${API_BASE_URL}/api/v1/admin/products/images/${imageId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    qc.invalidateQueries({ queryKey: ['admin-product', id] })
  }

  const handleAssignColor = async (imageId: string, colorName: string | null) => {
    await api.patch(`/admin/products/images/${imageId}/color`, { colorName })
    qc.invalidateQueries({ queryKey: ['admin-product', id] })
    setAssigningImageId(null)
  }

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (!product) return <p className="text-muted-foreground">{locale === 'ar' ? 'المنتج غير موجود' : 'Produkt nicht gefunden.'}</p>

  const productName = getProductName(product.translations, locale)
  const productImages = product.images ?? []
  const productColors = [...new Map((product.variants ?? []).map((v: any) => [v.color, v.colorHex])).entries()].map(([name, hex]) => ({ name: name as string, hex: hex as string }))

  // Group variants by color, sorted by size
  const sizeSort = (a: any, b: any) => {
    const na = parseFloat(a.size) || 0
    const nb = parseFloat(b.size) || 0
    return na - nb || (a.size ?? '').localeCompare(b.size ?? '')
  }
  const colorGroups = new Map<string, any[]>()
  for (const v of (product.variants ?? []).slice().sort(sizeSort)) {
    const key = v.color ?? 'default'
    if (!colorGroups.has(key)) colorGroups.set(key, [])
    colorGroups.get(key)!.push(v)
  }

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <AdminBreadcrumb items={[{ label: t('products.title'), href: `/${locale}/admin/products` }, { label: productName }]} />
      <h1 className="text-2xl font-bold mb-8">{productName}</h1>

      {/* ══════════ BILDER-GALERIE ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2"><ImageIcon className="h-4 w-4" />{t('wizard.images')}</span>
          <span className="text-xs text-muted-foreground">{productImages.length} {locale === 'ar' ? 'صورة' : 'Bilder'}</span>
        </div>
        <div className="p-6">
          {/* Upload zone */}
          <label
            className="block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer hover:border-[#d4a853]/50 hover:bg-[#d4a853]/5 transition-all mb-4"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-[#d4a853]', 'bg-[#d4a853]/10') }}
            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-[#d4a853]', 'bg-[#d4a853]/10') }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-[#d4a853]', 'bg-[#d4a853]/10'); if (e.dataTransfer.files?.length) handleImageUpload(e.dataTransfer.files) }}
          >
            {uploading ? <Loader2 className="h-6 w-6 mx-auto mb-1 animate-spin text-[#d4a853]" /> : <Upload className="h-6 w-6 mx-auto mb-1 text-muted-foreground/40" />}
            <p className="text-sm text-muted-foreground">{t('wizard.uploadZone')}</p>
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) handleImageUpload(e.target.files) }} />
          </label>

          {/* Image grid */}
          {productImages.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {productImages.map((img: any) => {
                const assignedColor = img.colorName ? productColors.find((c) => c.name === img.colorName) : null
                return (
                  <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden border-2 group hover:shadow-lg transition-all"
                    style={{ borderColor: assignedColor ? assignedColor.hex : 'transparent' }}>
                    <img src={img.url} alt="" className="w-full h-full object-cover" />

                    {img.isPrimary && <Star className="absolute top-1.5 left-1.5 rtl:left-auto rtl:right-1.5 h-4 w-4 text-[#d4a853] fill-[#d4a853] drop-shadow" />}

                    {assignedColor && (
                      <div className="absolute bottom-1.5 left-1.5 rtl:left-auto rtl:right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm">
                        <div className="h-3 w-3 rounded-full border border-white/50" style={{ backgroundColor: assignedColor.hex }} />
                        <span className="text-[9px] text-white font-medium">{translateColor(assignedColor.name, locale)}</span>
                      </div>
                    )}

                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                      {productColors.length > 0 && (
                        <button onClick={() => setAssigningImageId(assigningImageId === img.id ? null : img.id)}
                          className="w-full py-1 rounded-lg bg-white/90 text-[10px] font-medium text-gray-800 hover:bg-white">
                          {img.colorName ? (locale === 'ar' ? 'تغيير اللون' : 'Farbe ändern') : (locale === 'ar' ? 'تعيين لون' : 'Farbe zuweisen')}
                        </button>
                      )}
                      <button onClick={() => handleDeleteImage(img.id)}
                        className="w-full py-1 rounded-lg bg-red-500/90 text-[10px] font-medium text-white hover:bg-red-600 flex items-center justify-center gap-1">
                        <X className="h-3 w-3" />{locale === 'ar' ? 'حذف' : 'Entfernen'}
                      </button>
                    </div>

                    {/* Color assignment dropdown */}
                    {assigningImageId === img.id && (
                      <div className="absolute inset-x-0 bottom-0 bg-white rounded-b-xl shadow-lg border-t z-10 p-2" onClick={(e) => e.stopPropagation()} style={{ animation: 'fadeSlideUp 150ms ease-out' }}>
                        <button onClick={() => handleAssignColor(img.id, null)} className={`w-full text-start px-2 py-1.5 rounded-lg text-xs hover:bg-muted ${!img.colorName ? 'bg-muted font-semibold' : ''}`}>
                          {locale === 'ar' ? 'بدون لون (عام)' : 'Allgemein (kein Farbe)'}
                        </button>
                        {productColors.map((c) => (
                          <button key={c.name} onClick={() => handleAssignColor(img.id, c.name)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-muted ${img.colorName === c.name ? 'bg-muted font-semibold' : ''}`}>
                            <div className="h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} />{translateColor(c.name, locale)}
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

      {/* ══════════ GRUNDDATEN ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
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
            <label className="text-sm font-medium mb-1.5 block">{t('wizard.productName')} ({activeLang.toUpperCase()})</label>
            <Input value={translations[activeLang]?.name ?? ''} onChange={(e) => setTranslations((p) => ({ ...p, [activeLang]: { ...p[activeLang], name: e.target.value } }))}
              className="text-lg h-12 rounded-xl" dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('wizard.description')}</label>
            <textarea value={translations[activeLang]?.description ?? ''} onChange={(e) => setTranslations((p) => ({ ...p, [activeLang]: { ...p[activeLang], description: e.target.value } }))}
              className="w-full h-28 px-4 py-3 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" dir={activeLang === 'ar' ? 'rtl' : 'ltr'} />
            <div className="mt-2">
              <AiDescriptionButton
                productId={id}
                productName={translations.de?.name || translations.en?.name || ''}
                category={product.category?.translations?.find((t: any) => t.language === 'de')?.name}
                onApply={(desc) => {
                  setTranslations((p) => ({
                    ...p,
                    de: { ...p.de, description: desc.de, metaTitle: desc.seo?.metaTitleDe || p.de.metaTitle, metaDesc: desc.seo?.metaDescDe || p.de.metaDesc },
                    ar: { ...p.ar, description: desc.ar, metaTitle: desc.seo?.metaTitleAr || p.ar.metaTitle, metaDesc: desc.seo?.metaDescAr || p.ar.metaDesc },
                    en: { ...p.en, description: desc.en, metaTitle: desc.seo?.metaTitleEn || p.en.metaTitle, metaDesc: desc.seo?.metaDescEn || p.en.metaDesc },
                  }))
                }}
              />
            </div>
          </div>

          {/* ── SEO / Google Meta fields — collapsible per-language editor ── */}
          {(() => {
            const metaTitle = translations[activeLang]?.metaTitle ?? ''
            const metaDesc = translations[activeLang]?.metaDesc ?? ''
            const titleLen = metaTitle.length
            const descLen = metaDesc.length
            const titleLimit = 60
            const descLimit = 160
            const seoFilled = titleLen > 0 || descLen > 0
            return (
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowSeo((v) => !v)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-start"
                >
                  <ChevronRight
                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showSeo ? 'rotate-90' : ''} rtl:rotate-180 ${showSeo ? 'rtl:rotate-90' : ''}`}
                  />
                  <Sparkles className="h-4 w-4 text-[#d4a853]" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {locale === 'ar'
                        ? 'إعدادات SEO (محركات البحث)'
                        : locale === 'en'
                        ? 'SEO settings (search engines)'
                        : 'SEO-Einstellungen (Suchmaschinen)'}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {locale === 'ar'
                        ? 'ما يظهر في نتائج Google والمشاركات على وسائل التواصل الاجتماعي'
                        : locale === 'en'
                        ? 'What appears in Google search results and social media shares'
                        : 'Was in Google-Suchergebnissen und Social-Media-Vorschauen erscheint'}
                    </div>
                  </div>
                  {seoFilled && (
                    <span className="text-[10px] font-medium text-[#d4a853] bg-[#d4a853]/10 px-2 py-0.5 rounded-full">
                      {locale === 'ar' ? 'مكتمل' : locale === 'en' ? 'filled' : 'gefüllt'}
                    </span>
                  )}
                </button>
                {showSeo && (
                  <div className="p-4 space-y-4 bg-background">
                    {/* Meta Title */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium">
                          {locale === 'ar'
                            ? `عنوان Google (${activeLang.toUpperCase()})`
                            : locale === 'en'
                            ? `Google Title (${activeLang.toUpperCase()})`
                            : `Google-Titel (${activeLang.toUpperCase()})`}
                        </label>
                        <span
                          className={`text-[11px] tabular-nums ${
                            titleLen > titleLimit
                              ? 'text-red-600 font-semibold'
                              : titleLen > titleLimit - 10
                              ? 'text-amber-600'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {titleLen} / {titleLimit}
                        </span>
                      </div>
                      <Input
                        value={metaTitle}
                        onChange={(e) =>
                          setTranslations((p) => ({
                            ...p,
                            [activeLang]: { ...p[activeLang], metaTitle: e.target.value },
                          }))
                        }
                        className="rounded-xl"
                        dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
                        placeholder={
                          locale === 'ar'
                            ? 'مثال: تي شيرت رجالي أسود — ملبوسات ملك'
                            : locale === 'en'
                            ? 'e.g. Men\'s Black T-Shirt Organic Cotton | Malak'
                            : 'z.B. Herren T-Shirt Schwarz Bio-Baumwolle | Malak'
                        }
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {locale === 'ar'
                          ? 'الرابط الأزرق القابل للنقر في نتائج Google. الطول المُوصى به 55-60 حرفاً.'
                          : locale === 'en'
                          ? 'The blue clickable link in Google results. 55–60 characters recommended.'
                          : 'Der blaue anklickbare Link in Google-Ergebnissen. 55–60 Zeichen empfohlen.'}
                      </p>
                    </div>

                    {/* Meta Description */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium">
                          {locale === 'ar'
                            ? `وصف Google (${activeLang.toUpperCase()})`
                            : locale === 'en'
                            ? `Google Description (${activeLang.toUpperCase()})`
                            : `Google-Beschreibung (${activeLang.toUpperCase()})`}
                        </label>
                        <span
                          className={`text-[11px] tabular-nums ${
                            descLen > descLimit
                              ? 'text-red-600 font-semibold'
                              : descLen > descLimit - 20
                              ? 'text-amber-600'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {descLen} / {descLimit}
                        </span>
                      </div>
                      <textarea
                        value={metaDesc}
                        onChange={(e) =>
                          setTranslations((p) => ({
                            ...p,
                            [activeLang]: { ...p[activeLang], metaDesc: e.target.value },
                          }))
                        }
                        className="w-full h-20 px-4 py-2.5 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                        dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
                        placeholder={
                          locale === 'ar'
                            ? 'مثال: تي شيرت رجالي من القطن العضوي 100%. قصة كلاسيكية. شحن مجاني من 100€.'
                            : locale === 'en'
                            ? 'e.g. Premium Men\'s T-Shirt from 100% organic cotton. Classic cut. Free shipping from €100.'
                            : 'z.B. Premium Herren T-Shirt aus 100% Bio-Baumwolle. Klassischer Schnitt. Versand ab €100 gratis.'
                        }
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {locale === 'ar'
                          ? 'النص الرمادي أسفل الرابط الأزرق في Google. الطول المُوصى به 150-160 حرفاً.'
                          : locale === 'en'
                          ? 'The gray text below the blue link in Google. 150–160 characters recommended.'
                          : 'Der graue Text unter dem blauen Link in Google. 150–160 Zeichen empfohlen.'}
                      </p>
                    </div>

                    {/* Google preview card */}
                    {(metaTitle || metaDesc) && (
                      <div className="mt-2 p-3 rounded-lg bg-muted/20 border border-border/40">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          {locale === 'ar' ? 'معاينة Google' : locale === 'en' ? 'Google preview' : 'Google-Vorschau'}
                        </div>
                        <div dir={activeLang === 'ar' ? 'rtl' : 'ltr'}>
                          <div className="text-[13px] text-[#4d5156] truncate">
                            malak-bekleidung.com › produkt › {product?.slug ?? '...'}
                          </div>
                          <div className="text-[18px] text-[#1a0dab] leading-snug hover:underline cursor-pointer truncate">
                            {metaTitle || translations[activeLang]?.name || '—'}
                          </div>
                          <div className="text-[13px] text-[#4d5156] leading-snug line-clamp-2 mt-0.5">
                            {metaDesc || translations[activeLang]?.description || '—'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.basePrice')}</label><Input type="number" min={0} step={0.01} value={basePrice || ''} onChange={(e) => setBasePrice(+e.target.value)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label><Input type="number" min={0} step={0.01} value={salePrice ?? ''} onChange={(e) => setSalePrice(e.target.value ? +e.target.value : null)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label><Input value={19} readOnly className="rounded-xl bg-muted" /></div>
          </div>

          {/* Category re-categorize — two cascading dropdowns.
              Picks the parent (Herren/Damen/Kinder/Baby) first, then the
              leaf (Pyjamas/T-Shirts/...). The leaf is the value that ends
              up on the saved product. Shown only when the categories list
              finished loading, otherwise the dropdowns would render empty
              and confuse the user. */}
          {allCategories && allCategories.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-border/40">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {locale === 'ar' ? 'الفئة الرئيسية' : locale === 'en' ? 'Main Category' : 'Hauptkategorie'}
                </label>
                <select
                  value={parentCategoryId}
                  onChange={(e) => {
                    const newParent = e.target.value
                    setParentCategoryId(newParent)
                    // Clear the sub-selection when the parent changes so the
                    // user is forced to make a conscious leaf choice.
                    setSubCategoryId('')
                  }}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm"
                >
                  <option value="">—</option>
                  {allCategories.map((cat: any) => {
                    const label = cat.translations?.find((t: any) => t.language === locale)?.name
                      ?? cat.translations?.find((t: any) => t.language === 'de')?.name
                      ?? cat.translations?.find((t: any) => t.language === 'en')?.name
                      ?? cat.slug
                    return <option key={cat.id} value={cat.id}>{label}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {locale === 'ar' ? 'الفئة الفرعية' : locale === 'en' ? 'Sub Category' : 'Unterkategorie'}
                </label>
                <select
                  value={subCategoryId}
                  onChange={(e) => setSubCategoryId(e.target.value)}
                  disabled={!parentCategoryId}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm disabled:opacity-50"
                >
                  <option value="">—</option>
                  {(() => {
                    const parent = allCategories.find((c: any) => c.id === parentCategoryId)
                    const children = parent?.children ?? []
                    return children.map((sub: any) => {
                      const label = sub.translations?.find((t: any) => t.language === locale)?.name
                        ?? sub.translations?.find((t: any) => t.language === 'de')?.name
                        ?? sub.translations?.find((t: any) => t.language === 'en')?.name
                        ?? sub.slug
                      return <option key={sub.id} value={sub.id}>{label}</option>
                    })
                  })()}
                </select>
                {subCategoryId && subCategoryId !== product?.categoryId && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
                    {locale === 'ar'
                      ? '⚠ سيتم نقل المنتج إلى فئة جديدة عند الحفظ'
                      : locale === 'en'
                      ? '⚠ Product will be moved to the new category on save'
                      : '⚠ Produkt wird beim Speichern in die neue Kategorie verschoben'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Resolved size chart badge + category-change chart warning.
              The badge always reflects what the customer sees today; the
              warning fires only when the selected category would resolve to
              a different chart on save. See sizing service
              previewChartForCategory (Gruppe: Size-Charts Hardening D). */}
          {chartPreview && (
            <div className="mt-4 pt-4 border-t border-border/40 space-y-2">
              <div className="flex items-start gap-2 flex-wrap text-[13px]">
                <span className="text-muted-foreground">
                  {locale === 'ar' ? 'جدول المقاسات المعروض:' : locale === 'en' ? 'Resolved size chart:' : 'Größentabelle (aktuell):'}
                </span>
                {chartPreview.current ? (
                  <a
                    href={`/${locale}/admin/sizing`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#d4a853]/15 text-[#d4a853] font-medium hover:bg-[#d4a853]/25 transition-colors"
                  >
                    {chartPreview.current.name}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {locale === 'ar' ? 'لا يوجد جدول' : locale === 'en' ? 'No chart' : 'Keine Tabelle'}
                  </span>
                )}
              </div>

              {chartPreview.willChange && subCategoryId && subCategoryId !== product?.categoryId && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-[12px] text-amber-900 dark:text-amber-200">
                  <p className="font-semibold mb-1">
                    {locale === 'ar'
                      ? '⚠ سيتغير جدول المقاسات'
                      : locale === 'en'
                      ? '⚠ Size chart will change'
                      : '⚠ Größentabelle wird sich ändern'}
                  </p>
                  <p className="leading-relaxed">
                    {locale === 'ar'
                      ? `سيرى العملاء "${chartPreview.preview?.name ?? 'لا يوجد جدول'}" بدلاً من "${chartPreview.current?.name ?? 'لا يوجد جدول'}" بعد الحفظ.`
                      : locale === 'en'
                      ? `Customers will see "${chartPreview.preview?.name ?? 'no chart'}" instead of "${chartPreview.current?.name ?? 'no chart'}" after save.`
                      : `Kunden werden "${chartPreview.preview?.name ?? 'keine Tabelle'}" statt "${chartPreview.current?.name ?? 'keine Tabelle'}" sehen nach dem Speichern.`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ══════════ VERKAUFSKANÄLE ══════════ */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">{locale === 'ar' ? 'قنوات البيع' : 'Verkaufskanäle'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(() => {
            const productActive = product?.isActive !== false
            const channels = [
              { key: 'shop', name: locale === 'ar' ? 'المتجر' : 'Shop', sub: locale === 'ar' ? 'الموقع' : 'Website', color: '#d4a853', ownToggle: true, isShop: true,
                toggle: () => {},
                logo: <ShoppingBag className="h-[18px] w-[18px]" /> },
              { key: 'facebook', name: 'Facebook', sub: 'Instagram', color: '#1877F2', ownToggle: channelFacebook,
                toggle: () => setChannelFacebook(!channelFacebook),
                logo: <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> },
              { key: 'tiktok', name: 'TikTok', sub: 'Shop', color: '#010101', ownToggle: channelTiktok,
                toggle: () => setChannelTiktok(!channelTiktok),
                logo: <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.21 8.21 0 004.76 1.52V7.05a4.84 4.84 0 01-1-.36z"/></svg> },
              { key: 'google', name: 'Google', sub: 'Shopping', color: '#EA4335', ownToggle: channelGoogle,
                toggle: () => setChannelGoogle(!channelGoogle),
                logo: <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> },
              { key: 'whatsapp', name: 'WhatsApp', sub: 'Catalog', color: '#25D366', ownToggle: channelWhatsapp,
                toggle: () => setChannelWhatsapp(!channelWhatsapp),
                logo: <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> },
            ]
            return channels.map((ch) => {
              // Effective state: product must be active AND channel must be on
              const effectiveOn = productActive && ch.ownToggle
              const disabled = !!ch.isShop || !productActive

              return (
                <div key={ch.key} className="relative overflow-hidden rounded-2xl border bg-background transition-all duration-300">
                  {/* Color accent bar — start side */}
                  <div
                    className="absolute top-0 bottom-0 ltr:left-0 rtl:right-0 w-1 transition-all duration-300"
                    style={{ backgroundColor: effectiveOn ? ch.color : 'transparent' }}
                  />

                  {/* Frost overlay when OFF */}
                  <div className={`absolute inset-0 bg-white/60 dark:bg-[#1a1a2e]/60 rounded-2xl pointer-events-none transition-opacity duration-300 ${effectiveOn ? 'opacity-0' : 'opacity-100'}`} style={{ zIndex: 1 }} />

                  {/* Content */}
                  <div className="relative flex items-center gap-3 p-3.5 ltr:pl-4 rtl:pr-4" style={{ zIndex: 2 }}>
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${effectiveOn ? '' : 'grayscale opacity-40'}`}
                      style={{ backgroundColor: effectiveOn ? ch.color + '18' : undefined, color: effectiveOn ? ch.color : undefined }}
                    >
                      {ch.logo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold leading-tight transition-colors duration-300 ${effectiveOn ? '' : 'text-muted-foreground'}`}>{ch.name}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {!productActive && !ch.isShop
                          ? (locale === 'ar' ? 'المنتج غير نشط' : 'Produkt inaktiv')
                          : ch.sub}
                      </p>
                    </div>
                    <button
                      onClick={disabled ? undefined : ch.toggle}
                      disabled={disabled}
                      className={`w-10 h-[22px] rounded-full flex-shrink-0 transition-colors duration-300 ${disabled ? 'cursor-not-allowed' : ''}`}
                      style={{ backgroundColor: effectiveOn ? ch.color : 'hsl(var(--muted))' }}
                      title={!productActive ? (locale === 'ar' ? 'المنتج غير نشط — فعّله أولا' : 'Produkt inaktiv — zuerst aktivieren') : ch.isShop ? (locale === 'ar' ? 'نشط دائما' : 'Immer aktiv') : undefined}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 mt-[3px] ${effectiveOn ? 'ltr:translate-x-[21px] rtl:-translate-x-[21px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]'}`} />
                    </button>
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </section>

      {/* ══════════ WHATSAPP-SMART-LINK (C7) ══════════ */}
      {/* Only visible when the WhatsApp channel is enabled on this
           product AND the product has at least one variant. Generates
           a copy-paste message — no Meta Commerce API call. */}
      {channelWhatsapp && (product?.variants?.length ?? 0) > 0 && (
        <section className="bg-background border rounded-2xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-muted/20">
            <h2 className="font-semibold text-sm">WhatsApp-Nachricht</h2>
          </div>
          <div className="p-6">
            <WhatsAppShareButton
              product={{
                id,
                slug: product?.slug ?? '',
                basePrice,
                salePrice: salePrice ?? null,
                variants: product?.variants ?? [],
                translations: Object.entries(translations).map(([language, t]) => ({
                  language,
                  name: t.name,
                  description: t.description,
                })),
              }}
              appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://malak-bekleidung.com'}
            />
          </div>
        </section>
      )}

      {/* ══════════ RÜCKGABE-EINSTELLUNGEN ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b bg-muted/20">
          <h2 className="font-semibold text-sm">{locale === 'ar' ? 'إعدادات الإرجاع' : 'Rückgabe-Einstellungen'}</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{locale === 'ar' ? 'مستثنى من حق الإرجاع' : 'Vom Widerrufsrecht ausgenommen'}</p>
              <p className="text-xs text-muted-foreground">{locale === 'ar' ? 'لن يتمكن العملاء من إرجاع هذا المنتج' : 'Kunden können dieses Produkt nicht retournieren'}</p>
            </div>
            <button
              onClick={() => setExcludeFromReturns(!excludeFromReturns)}
              className={`relative w-10 h-[22px] rounded-full flex-shrink-0 transition-colors duration-300`}
              style={{ backgroundColor: excludeFromReturns ? '#ef4444' : 'hsl(var(--muted))' }}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 mt-[3px] ${excludeFromReturns ? 'ltr:translate-x-[21px] rtl:-translate-x-[21px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]'}`} />
            </button>
          </div>
          {excludeFromReturns && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                {locale === 'ar' ? 'سبب الاستثناء' : 'Ausschlussgrund'}
              </label>
              <select
                value={returnExclusionReason ?? ''}
                onChange={(e) => setReturnExclusionReason(e.target.value || null)}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
              >
                <option value="">{locale === 'ar' ? 'اختر السبب...' : 'Grund wählen...'}</option>
                <option value="hygiene">{locale === 'ar' ? 'منتج صحي / نظافة' : 'Hygieneartikel'}</option>
                <option value="custom_made">{locale === 'ar' ? 'مصنوع حسب الطلب' : 'Maßanfertigung'}</option>
                <option value="sealed">{locale === 'ar' ? 'بضاعة مختومة' : 'Versiegelte Ware'}</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {/* ══════════ BESTANDSÜBERSICHT (Matrix) ══════════ */}
      {colorGroups.size > 0 && (
        <section className="bg-background border rounded-2xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
            <div>
              <span className="font-semibold text-sm">{locale === 'ar' ? 'نظرة عامة على المخزون' : 'Bestandsübersicht'}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">{locale === 'ar' ? 'انقر على الرقم لتعديل المخزون' : 'Klicke auf eine Zahl um den Bestand zu ändern'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddColor(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#d4a853]/10 text-[#d4a853] hover:bg-[#d4a853]/20 border border-[#d4a853]/20"><Plus className="h-3 w-3" />{t('inventory.addNewColor')}</button>
              <button onClick={() => setShowAddSize(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"><Plus className="h-3 w-3" />{t('inventory.addNewSize')}</button>
            </div>
          </div>
          <div className="p-6">
            <VariantMatrix productId={id} variants={product.variants ?? []} locale={locale} />
          </div>
        </section>
      )}

      {/* ══════════ VARIANTEN-DETAILS ══════════ */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm flex items-center justify-between">
          <span>{locale === 'ar' ? 'تفاصيل المتغيرات' : 'Varianten-Details'} ({product.variants?.length ?? 0})</span>
          {(() => {
            const catName = (product.category?.translations?.find((t: any) => t.language === 'de')?.name ?? '').toLowerCase()
            const stripe: 'herren' | 'damen' | 'kinder' | 'unisex' = catName.includes('herren') || catName.includes('männer') || catName.includes('jungen') ? 'herren' : catName.includes('damen') || catName.includes('frauen') || catName.includes('mädchen') ? 'damen' : catName.includes('kinder') || catName.includes('baby') ? 'kinder' : 'unisex'
            const batchItems = (product.variants ?? []).map((v: any) => {
              const colorImg = productImages.find((img: any) => img.colorName?.toLowerCase() === (v.color ?? '').toLowerCase())
              const primaryImg = productImages.find((img: any) => img.isPrimary)
              return { productName: getProductName(product.translations, 'de'), color: v.color ?? '', colorHex: v.colorHex ?? '#999', size: v.size ?? '', sku: v.sku, price: (salePrice ?? basePrice) + Number(v.priceModifier ?? 0), imageUrl: colorImg?.url ?? primaryImg?.url ?? productImages[0]?.url ?? null, categoryStripe: stripe, qty: 1 }
            })
            const hangTagItems = (product.variants ?? []).map((v: any) => ({ productName: getProductName(product.translations, 'de'), color: v.color ?? '', size: v.size ?? '', sku: v.sku, price: (salePrice ?? basePrice) + Number(v.priceModifier ?? 0), qty: 1 }))
            return batchItems.length > 0 ? <div className="flex gap-2"><BatchHaengetikettenButton items={hangTagItems} /><BatchFotoEtikettButton items={batchItems} /></div> : null
          })()}
        </div>
        <div className="divide-y">
          {/* Column headers — mirrors the data row structure below so each
              title sits centered above its column. Arabic "مقاس" and
              "السعر النهائي" are wider than their data cells, so we give
              them fixed centered widths matching the data widths exactly. */}
          <div className="flex items-center gap-3 px-5 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="w-6 text-center">{locale === 'ar' ? 'مقاس' : 'Gr.'}</span>
            <span className="flex-1 text-center">SKU</span>
            <div className="flex items-center gap-2">
              <span className="w-20 text-center">{locale === 'ar' ? 'السعر النهائي' : 'Endpreis'}</span>
              <span className="w-16 text-center">{locale === 'ar' ? 'تعديل ±' : 'Aufpreis ±'}</span>
            </div>
            <span className="w-32 text-center">{locale === 'ar' ? 'إجراءات' : locale === 'en' ? 'Actions' : 'Aktionen'}</span>
          </div>
          {[...colorGroups.entries()].map(([color, variants]) => {
            const hex = variants[0]?.colorHex ?? '#999'
            return (
              <div key={color}>
                <div className="flex items-center gap-3 px-5 py-2.5 bg-muted/10 border-b">
                  <div className="h-5 w-5 rounded-full border-2 border-white shadow" style={{ backgroundColor: hex }} />
                  <span className="text-xs font-semibold">{translateColor(color, locale)}</span>
                  <span className="text-[10px] text-muted-foreground">({variants.length})</span>
                  {/* Color image thumbnails */}
                  {(() => { const ci = productImages.filter((img: any) => img.colorName === color); return ci.length > 0 ? (
                    <div className="flex -space-x-1.5 ml-auto">{ci.slice(0, 3).map((img: any) => <img key={img.id} src={img.url} alt="" className="h-6 w-6 rounded object-cover border border-white" />)}</div>
                  ) : null })()}
                </div>
                {variants.map((v: any) => {
                  const stock = (v.inventory ?? []).reduce((s: number, inv: any) => s + inv.quantityOnHand - inv.quantityReserved, 0)
                  const customerPrice = (salePrice ?? basePrice) + Number(v.priceModifier ?? 0)
                  return (
                    <div key={v.id} className="flex items-center gap-3 px-5 py-2 group hover:bg-muted/10 transition-colors">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-lg bg-muted text-[11px] font-bold flex-shrink-0">{v.size}</span>
                      <span className="font-mono text-[11px] text-muted-foreground flex-1 truncate text-center">{v.sku}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 text-center">
                          <span className="text-xs font-medium tabular-nums">€{customerPrice.toFixed(2)}</span>
                          {salePrice && <span className="text-[9px] text-muted-foreground line-through ml-1">€{basePrice.toFixed(2)}</span>}
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={Number(v.priceModifier ?? 0)}
                          className="w-16 h-7 text-center text-[11px] rounded-lg border bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/30"
                          title={locale === 'ar' ? 'تعديل السعر (+ أو -)' : 'Preisanpassung (+/-)'}
                          placeholder="±0"
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val !== Number(v.priceModifier ?? 0)) {
                              api.patch(`/admin/products/variants/${v.id}`, { priceModifier: val })
                                .then(() => qc.invalidateQueries({ queryKey: ['admin-product'] }))
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                      </div>
                      <div className="w-32 flex items-center justify-center gap-1 flex-shrink-0">
                        <PrintLabelButton variant={{ sku: v.sku, barcode: v.barcode, color: v.color, size: v.size, price: customerPrice, stock }} productName={getProductName(product.translations, 'de')} className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all" />
                        <HaengetikettenButton variant={{ sku: v.sku, color: v.color ?? '', size: v.size ?? '', price: customerPrice }} productName={getProductName(product.translations, 'de')} className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all" />
                        {(() => {
                          const colorImg = productImages.find((img: any) => img.colorName?.toLowerCase() === (v.color ?? '').toLowerCase())
                          const primaryImg = productImages.find((img: any) => img.isPrimary)
                          const imgUrl = colorImg?.url ?? primaryImg?.url ?? productImages[0]?.url ?? null
                          const catName = (product.category?.translations?.find((t: any) => t.language === 'de')?.name ?? '').toLowerCase()
                          const stripe: 'herren' | 'damen' | 'kinder' | 'unisex' = catName.includes('herren') || catName.includes('männer') || catName.includes('jungen') ? 'herren' : catName.includes('damen') || catName.includes('frauen') || catName.includes('mädchen') ? 'damen' : catName.includes('kinder') || catName.includes('baby') ? 'kinder' : 'unisex'
                          return <FotoEtikettButton variant={{ sku: v.sku, color: v.color ?? '', colorHex: v.colorHex ?? '#999', size: v.size ?? '', price: customerPrice, imageUrl: imgUrl }} productName={getProductName(product.translations, 'de')} categoryStripe={stripe} className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all" />
                        })()}
                        <button onClick={async () => { const ok = await confirmDialog({ title: t('inventory.deleteVariant'), description: t('inventory.deleteVariantConfirm'), variant: 'danger', confirmLabel: t('categories.delete'), cancelLabel: t('categories.cancel') }); if (ok) deleteMut.mutate(v.id) }} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </section>

      {/* Sticky Save */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-end gap-3">
          {saveMessage && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${saveMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
              style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
              {saveMessage.type === 'success' ? '✓' : '✕'} {saveMessage.text}
            </div>
          )}
          <Button className="rounded-xl gap-2" onClick={async () => {
            setSaving(true); setSaveMessage(null)
            try {
              await saveMut.mutateAsync()
              setSaveMessage({ type: 'success', text: locale === 'ar' ? 'تم الحفظ بنجاح' : 'Erfolgreich gespeichert' })
              setTimeout(() => setSaveMessage(null), 3000)
            } catch {
              setSaveMessage({ type: 'error', text: locale === 'ar' ? 'خطأ في الحفظ' : 'Fehler beim Speichern' })
            } finally { setSaving(false) }
          }} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('inventory.save')}
          </Button>
        </div>
      </div>

      {showAddColor && <AddColorModal productId={id} onClose={() => setShowAddColor(false)} onSuccess={() => qc.invalidateQueries({ queryKey: ['admin-product', id] })} />}
      {showAddSize && <AddSizeModal productId={id} onClose={() => setShowAddSize(false)} onSuccess={() => qc.invalidateQueries({ queryKey: ['admin-product', id] })} />}

      <style>{`@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}
