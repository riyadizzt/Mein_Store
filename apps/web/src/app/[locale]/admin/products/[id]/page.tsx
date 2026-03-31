'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, Plus, Trash2, Save, Upload, Star, X,
  Image as ImageIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { api } from '@/lib/api'
import { translateColor, getProductName } from '@/lib/locale-utils'
import { useConfirm } from '@/components/ui/confirm-modal'
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
  const confirmDialog = useConfirm()

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
  }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMut = useMutation({
    mutationFn: async (variantId: string) => { await api.delete(`/admin/products/${id}/variants/${variantId}`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-product', id] }),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/products/${id}`, {
        basePrice, salePrice,
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
    const token = (await import('@/store/auth-store')).useAuthStore.getState().accessToken
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      if (colorName) formData.append('colorName', colorName)
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/admin/products/${id}/images/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
      })
    }
    qc.invalidateQueries({ queryKey: ['admin-product', id] })
    setUploading(false)
  }

  const handleDeleteImage = async (imageId: string) => {
    const token = (await import('@/store/auth-store')).useAuthStore.getState().accessToken
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/admin/products/images/${imageId}`, {
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
          <label className="block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer hover:border-[#d4a853]/50 hover:bg-[#d4a853]/5 transition-all mb-4">
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
                        <button onClick={() => handleAssignColor(img.id, null)} className={`w-full text-left rtl:text-right px-2 py-1.5 rounded-lg text-xs hover:bg-muted ${!img.colorName ? 'bg-muted font-semibold' : ''}`}>
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
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.basePrice')}</label><Input type="number" min={0} step={0.01} value={basePrice || ''} onChange={(e) => setBasePrice(+e.target.value)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.salePrice')}</label><Input type="number" min={0} step={0.01} value={salePrice ?? ''} onChange={(e) => setSalePrice(e.target.value ? +e.target.value : null)} className="rounded-xl" /></div>
            <div><label className="text-sm font-medium mb-1.5 block">{t('wizard.taxRate')}</label><Input value={19} readOnly className="rounded-xl bg-muted" /></div>
          </div>
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
        <div className="px-6 py-4 border-b bg-muted/20 font-semibold text-sm">
          {locale === 'ar' ? 'تفاصيل المتغيرات' : 'Varianten-Details'} ({product.variants?.length ?? 0})
        </div>
        <div className="divide-y">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="w-6">{locale === 'ar' ? 'مقاس' : 'Gr.'}</span>
            <span className="flex-1">SKU</span>
            <span>{locale === 'ar' ? 'السعر النهائي' : 'Endpreis'}</span>
            <span className="w-16 text-center">{locale === 'ar' ? 'تعديل ±' : 'Aufpreis ±'}</span>
            <span className="w-16" />
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
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-lg bg-muted text-[11px] font-bold">{v.size}</span>
                      <span className="font-mono text-[11px] text-muted-foreground flex-1 truncate">{v.sku}</span>
                      <div className="flex items-center gap-2">
                        <div className="text-end">
                          <span className="text-xs font-medium">€{customerPrice.toFixed(2)}</span>
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
                      <PrintLabelButton variant={{ sku: v.sku, barcode: v.barcode, color: v.color, size: v.size, price: customerPrice, stock }} productName={getProductName(product.translations, 'de')} className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-all" />
                      <button onClick={async () => { const ok = await confirmDialog({ title: t('inventory.deleteVariant'), description: t('inventory.deleteVariantConfirm'), variant: 'danger', confirmLabel: t('categories.delete'), cancelLabel: t('categories.cancel') }); if (ok) deleteMut.mutate(v.id) }} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
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
