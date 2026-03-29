'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Package, Save, Upload, Star, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { api } from '@/lib/api'
import { translateColor, getProductName, formatCurrency } from '@/lib/locale-utils'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { AddColorModal, AddSizeModal, VariantMatrix } from '@/components/admin/add-variant-modals'
import { PrintLabelButton } from '@/components/admin/label-printer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const LANGS = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
]

export default function EditProductPage({ params: { id } }: { params: { id: string; locale: string } }) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  const [activeLang, setActiveLang] = useState('de')
  const [translations, setTranslations] = useState<Record<string, { name: string; description: string; metaTitle: string; metaDesc: string }>>({
    de: { name: '', description: '', metaTitle: '', metaDesc: '' },
    en: { name: '', description: '', metaTitle: '', metaDesc: '' },
    ar: { name: '', description: '', metaTitle: '', metaDesc: '' },
  })
  const [basePrice, setBasePrice] = useState(0)
  const [salePrice, setSalePrice] = useState<number | null>(null)
  const [showAddColor, setShowAddColor] = useState(false)
  const [showAddSize, setShowAddSize] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null) // colorName being uploaded

  const { data: product, isLoading } = useQuery({
    queryKey: ['admin-product', id],
    queryFn: async () => { const { data } = await api.get(`/admin/products/${id}`); return data },
  })

  // Pre-fill from product data
  useEffect(() => {
    if (!product) return
    const t: Record<string, any> = { de: { name: '', description: '', metaTitle: '', metaDesc: '' }, en: { name: '', description: '', metaTitle: '', metaDesc: '' }, ar: { name: '', description: '', metaTitle: '', metaDesc: '' } }
    for (const tr of product.translations ?? []) {
      t[tr.language] = { name: tr.name ?? '', description: tr.description ?? '', metaTitle: tr.metaTitle ?? '', metaDesc: tr.metaDesc ?? '' }
    }
    setTranslations(t)
    setBasePrice(Number(product.basePrice) || 0)
    setSalePrice(product.salePrice ? Number(product.salePrice) : null)
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMut = useMutation({
    mutationFn: async (variantId: string) => { await api.delete(`/admin/products/${id}/variants/${variantId}`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-product', id] }),
  })

  // Image upload to Cloudinary via API
  const handleImageUpload = async (file: File, colorName?: string) => {
    setUploading(colorName ?? '__general__')
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (colorName) formData.append('colorName', colorName)

      const token = (await import('@/store/auth-store')).useAuthStore.getState().accessToken
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/admin/products/${id}/images/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      qc.invalidateQueries({ queryKey: ['admin-product', id] })
    } finally {
      setUploading(null)
    }
  }

  const handleDeleteImage = async (imageId: string) => {
    const token = (await import('@/store/auth-store')).useAuthStore.getState().accessToken
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/admin/products/images/${imageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    qc.invalidateQueries({ queryKey: ['admin-product', id] })
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.patch(`/admin/products/${id}/price`, { basePrice, salePrice })
      // Note: full product update (translations, category) would need a PUT /products/:id endpoint
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-product', id] }),
  })

  const handleSave = async () => {
    setSaving(true)
    try { await saveMut.mutateAsync() } finally { setSaving(false) }
  }

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (!product) return <p className="text-muted-foreground">{locale === 'ar' ? 'المنتج غير موجود' : 'Produkt nicht gefunden.'}</p>

  const productName = getProductName(product.translations, locale)

  // Group variants by color
  const colorGroups = new Map<string, any[]>()
  for (const v of product.variants ?? []) {
    const key = v.color ?? 'default'
    if (!colorGroups.has(key)) colorGroups.set(key, [])
    colorGroups.get(key)!.push(v)
  }

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <AdminBreadcrumb items={[{ label: t('products.title'), href: `/${locale}/admin/products` }, { label: productName }]} />
      <h1 className="text-2xl font-bold mb-8">{productName}</h1>

      {/* ── Section 1: Basics ── */}
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
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.basePrice')}</label>
              <Input type="number" min={0} step={0.01} value={basePrice || ''} onChange={(e) => setBasePrice(+e.target.value)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label>
              <Input type="number" min={0} step={0.01} value={salePrice ?? ''} onChange={(e) => setSalePrice(e.target.value ? +e.target.value : null)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label><Input value={19} readOnly className="rounded-xl bg-muted" /></div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Colors + Images ── */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b bg-muted/20 flex items-center justify-between">
          <span className="font-semibold text-sm">{t('wizard.colors')} + {t('wizard.images')}</span>
          <div className="flex gap-2">
            <button onClick={() => setShowAddColor(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#d4a853]/10 text-[#d4a853] hover:bg-[#d4a853]/20 border border-[#d4a853]/20"><Plus className="h-3 w-3" />{t('inventory.addNewColor')}</button>
            <button onClick={() => setShowAddSize(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"><Plus className="h-3 w-3" />{t('inventory.addNewSize')}</button>
          </div>
        </div>
        <div className="p-6">
          {/* Color cards with images */}
          {colorGroups.size > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
              {[...colorGroups.entries()].map(([color, variants]) => {
                const hex = variants[0]?.colorHex ?? '#999'
                const colorImg = (product.images ?? []).find((img: any) => img.colorName === color)
                const totalStock = variants.reduce((s: number, v: any) => s + (v.inventory ?? []).reduce((ss: number, inv: any) => ss + inv.quantityOnHand - inv.quantityReserved, 0), 0)
                const isUploadingThis = uploading === color
                return (
                  <div key={color} className="border rounded-xl overflow-hidden hover:border-primary/20 hover:shadow-md transition-all group">
                    {/* Clickable image area — uploads to Cloudinary */}
                    <label className="block aspect-square bg-muted/30 relative cursor-pointer overflow-hidden">
                      {isUploadingThis ? (
                        <div className="w-full h-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#d4a853]" /></div>
                      ) : colorImg ? (
                        <img src={colorImg.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40 group-hover:text-[#d4a853] transition-colors">
                          <Upload className="h-8 w-8 mb-1" />
                          <span className="text-[10px] font-medium">{locale === 'ar' ? 'رفع صورة' : 'Bild hochladen'}</span>
                        </div>
                      )}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, color) }} />
                      {/* Delete existing image */}
                      {colorImg && (
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteImage(colorImg.id) }}
                          className="absolute top-2 right-2 rtl:right-auto rtl:left-2 h-6 w-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      <div className={`absolute bottom-2 right-2 rtl:right-auto rtl:left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${totalStock <= 0 ? 'bg-red-100 text-red-700' : totalStock <= 5 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{totalStock}</div>
                    </label>
                    <div className="p-3">
                      <div className="flex items-center gap-2"><div className="h-4 w-4 rounded-full border" style={{ backgroundColor: hex }} /><span className="text-xs font-semibold">{translateColor(color, locale)}</span></div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{variants.length} {t('products.variants')}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm"><Package className="h-8 w-8 mx-auto mb-2 opacity-20" /></div>
          )}

          {/* General images (no color) */}
          <div className="mt-6 pt-6 border-t">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 block">{t('wizard.images')} ({locale === 'ar' ? 'عامة' : 'Allgemein'})</label>
            <div className="flex gap-3 flex-wrap">
              {(product.images ?? []).filter((img: any) => !img.colorName).map((img: any) => (
                <div key={img.id} className="relative h-20 w-20 rounded-xl overflow-hidden border group">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  {img.isPrimary && <Star className="absolute top-1 left-1 h-3 w-3 text-[#d4a853] fill-[#d4a853]" />}
                  <button onClick={() => handleDeleteImage(img.id)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
              <label className="h-20 w-20 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                {uploading === '__general__' ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Plus className="h-5 w-5 text-muted-foreground/40" />}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f) }} />
              </label>
            </div>
          </div>

          {/* Variant Matrix */}
          {colorGroups.size > 1 && <div className="mt-6"><VariantMatrix variants={product.variants ?? []} locale={locale} /></div>}
        </div>
      </section>

      {/* ── Section 3: Variants List ── */}
      <section className="bg-background border rounded-2xl overflow-hidden mb-6">
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm">{t('products.variants')} ({product.variants?.length ?? 0})</div>
        <div className="divide-y">
          {[...colorGroups.entries()].map(([color, variants]) => {
            const hex = variants[0]?.colorHex ?? '#999'
            return (
              <div key={color}>
                <div className="flex items-center gap-3 px-5 py-2 bg-muted/10">
                  <div className="h-5 w-5 rounded-full border-2 border-white shadow" style={{ backgroundColor: hex }} />
                  <span className="text-xs font-semibold">{translateColor(color, locale)}</span>
                </div>
                {variants.map((v: any) => {
                  const stock = (v.inventory ?? []).reduce((s: number, inv: any) => s + inv.quantityOnHand - inv.quantityReserved, 0)
                  const isLow = stock > 0 && stock <= 5
                  const isOut = stock <= 0
                  return (
                    <div key={v.id} className={`flex items-center gap-4 px-5 py-2.5 group hover:bg-muted/10 ${isOut ? 'bg-red-50/30' : isLow ? 'bg-orange-50/20' : ''}`}>
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-muted text-xs font-bold">{v.size}</span>
                      <span className="font-mono text-xs text-muted-foreground flex-1">{v.sku}</span>
                      <span className="text-xs font-medium">{formatCurrency(Number(product.basePrice) + Number(v.priceModifier ?? 0), locale)}</span>
                      <span className={`text-xs font-bold min-w-[32px] text-center ${isOut ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-green-600'}`}>{stock}</span>
                      <PrintLabelButton variant={{ sku: v.sku, barcode: v.barcode, color: v.color, size: v.size, price: Number(product.basePrice) + Number(v.priceModifier ?? 0), stock }} productName={getProductName(product.translations, 'de')} className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all" />
                      <button onClick={() => { if (confirm(t('inventory.deleteVariantConfirm'))) deleteMut.mutate(v.id) }} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
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
          <Button className="rounded-xl gap-2" onClick={handleSave} disabled={saving}>
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
