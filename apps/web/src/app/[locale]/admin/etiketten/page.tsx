'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Search, ImageIcon, Printer, Plus, Minus, Trash2, Layers, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import { getProductName, translateColor } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { openBatchFotoEtikettPrintWindow, SIZE_CONFIG } from '@/components/admin/foto-etikett/FotoEtikettDruck'
import { openBatchHangTagPrintWindow, HANG_TAG_SIZE_CONFIG } from '@/components/admin/haengetikett/BatchHaengetikettenDruck'
import type { FotoEtikettData } from '@/components/admin/foto-etikett/FotoEtikettDruck'

interface EtikettItem extends FotoEtikettData {
  qty: number
  id: string
}

export default function EtikettenPage() {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [activeTab, setActiveTab] = useState<'foto' | 'hang'>('foto')
  const [search, setSearch] = useState('')
  const [druckbogen, setDruckbogen] = useState<EtikettItem[]>([])
  const [selectedSize, setSelectedSize] = useState<'klein' | 'mittel' | 'gross'>('gross')

  // Search products
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['etiketten-search', search],
    queryFn: async () => {
      if (search.length < 2) return []
      const { data } = await api.get('/admin/products', { params: { search, limit: 10 } })
      return data?.data ?? data?.items ?? (Array.isArray(data) ? data : [])
    },
    enabled: search.length >= 2,
    staleTime: 10000,
  })

  const getCategoryStripe = (product: any): 'herren' | 'damen' | 'kinder' | 'unisex' => {
    const catName = (product.category?.translations?.find((t: any) => t.language === 'de')?.name ?? '').toLowerCase()
    if (catName.includes('herren') || catName.includes('männer') || catName.includes('jungen')) return 'herren'
    if (catName.includes('damen') || catName.includes('frauen') || catName.includes('mädchen')) return 'damen'
    if (catName.includes('kinder') || catName.includes('baby')) return 'kinder'
    return 'unisex'
  }

  const addVariant = (product: any, variant: any) => {
    const existing = druckbogen.find((d) => d.id === variant.id)
    if (existing) {
      setDruckbogen((prev) => prev.map((d) => d.id === variant.id ? { ...d, qty: d.qty + 1 } : d))
      return
    }

    const images = product.images ?? []
    const colorImg = images.find((img: any) => img.colorName?.toLowerCase() === (variant.color ?? '').toLowerCase())
    const primaryImg = images.find((img: any) => img.isPrimary)
    const imgUrl = colorImg?.url ?? primaryImg?.url ?? images[0]?.url ?? null

    setDruckbogen((prev) => [...prev, {
      id: variant.id,
      productName: getProductName(product.translations, 'de'),
      color: variant.color ?? '',
      colorHex: variant.colorHex ?? '#999',
      size: variant.size ?? '',
      sku: variant.sku,
      price: Number(product.basePrice ?? 0) + Number(variant.priceModifier ?? 0),
      imageUrl: imgUrl,
      categoryStripe: getCategoryStripe(product),
      qty: 1,
    }])
  }

  const updateQty = (id: string, delta: number) => {
    setDruckbogen((prev) => prev.map((d) => d.id === id ? { ...d, qty: Math.max(1, Math.min(100, d.qty + delta)) } : d))
  }

  const removeItem = (id: string) => {
    setDruckbogen((prev) => prev.filter((d) => d.id !== id))
  }

  const addAllVariants = (product: any) => {
    const variants = product.variants ?? []
    variants.forEach((v: any) => addVariant(product, v))
  }

  const totalLabels = druckbogen.reduce((s, d) => s + d.qty, 0)
  const cfgMap = activeTab === 'foto' ? SIZE_CONFIG : HANG_TAG_SIZE_CONFIG
  const cfg = cfgMap[selectedSize]
  const totalPages = Math.ceil(totalLabels / cfg.perPage)

  const handlePrint = () => {
    if (activeTab === 'foto') {
      const allLabels: FotoEtikettData[] = []
      druckbogen.forEach((item) => {
        for (let i = 0; i < item.qty; i++) {
          allLabels.push({ productName: item.productName, color: item.color, colorHex: item.colorHex, size: item.size, sku: item.sku, price: item.price, imageUrl: item.imageUrl, categoryStripe: item.categoryStripe })
        }
      })
      openBatchFotoEtikettPrintWindow(allLabels, { size: selectedSize })
    } else {
      const allTags: Array<{ productName: string; color: string; size: string; sku: string; price: number }> = []
      druckbogen.forEach((item) => {
        for (let i = 0; i < item.qty; i++) {
          allTags.push({ productName: item.productName, color: item.color, size: item.size, sku: item.sku, price: item.price })
        }
      })
      openBatchHangTagPrintWindow(allTags, { size: selectedSize })
    }
  }

  const FOTO_SIZES = [
    { key: 'klein' as const,  label: 'Klein',  labelAr: '\u0635\u063a\u064a\u0631',  desc: '30\u00d730mm',  perPage: 54 },
    { key: 'mittel' as const, label: 'Mittel', labelAr: '\u0645\u062a\u0648\u0633\u0637', desc: '50\u00d735mm',  perPage: 32 },
    { key: 'gross' as const,  label: 'Gro\u00df',  labelAr: '\u0643\u0628\u064a\u0631',  desc: '50\u00d750mm',  perPage: 20 },
  ]
  const HANG_SIZES = [
    { key: 'klein' as const,  label: 'Klein',  labelAr: '\u0635\u063a\u064a\u0631',  desc: '40\u00d770mm',  perPage: 16 },
    { key: 'mittel' as const, label: 'Mittel', labelAr: '\u0645\u062a\u0648\u0633\u0637', desc: '55\u00d790mm',  perPage: 9 },
    { key: 'gross' as const,  label: 'Gro\u00df',  labelAr: '\u0643\u0628\u064a\u0631',  desc: '60\u00d7100mm', perPage: 6 },
  ]
  const SIZES = activeTab === 'foto' ? FOTO_SIZES : HANG_SIZES

  return (
    <div className="space-y-6">
      <AdminBreadcrumb items={[{ label: t3('Etiketten', 'Labels', 'الملصقات') }]} />

      <div className="flex items-center gap-3">
        <Layers className="h-6 w-6 text-[#d4a853]" />
        <h1 className="text-2xl font-bold">{t3('Etiketten-Druckstation', 'Label Print Station', '\u0645\u062d\u0637\u0629 \u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0645\u0644\u0635\u0642\u0627\u062a')}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl w-fit">
        <button onClick={() => { setActiveTab('foto'); setSelectedSize('gross') }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'foto' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <ImageIcon className="h-4 w-4" />
          {t3('Foto-Etiketten', 'Photo Labels', '\u0645\u0644\u0635\u0642\u0627\u062a \u0627\u0644\u0635\u0648\u0631')}
        </button>
        <button onClick={() => { setActiveTab('hang'); setSelectedSize('mittel') }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'hang' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          <Tag className="h-4 w-4" />
          {t3('H\u00e4ngetiketten', 'Hang Tags', '\u0628\u0637\u0627\u0642\u0627\u062a \u0627\u0644\u062a\u0639\u0644\u064a\u0642')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Search + Add Products */}
        <div className="space-y-4">
          <div className="bg-background border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/20">
              <h2 className="text-sm font-semibold">{t3('Produkt suchen', 'Search Product', 'البحث عن منتج')}</h2>
              <div className="relative mt-2">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t3('Produktname, SKU oder Barcode...', 'Product name, SKU or barcode...', 'اسم المنتج، SKU أو الباركود...')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ps-9"
                />
              </div>
            </div>

            <div className="max-h-[500px] overflow-y-auto divide-y">
              {isLoading && <div className="p-8 text-center text-muted-foreground text-sm">{t3('Suche...', 'Searching...', 'جاري البحث...')}</div>}
              {!isLoading && search.length >= 2 && (searchResults ?? []).length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">{t3('Keine Ergebnisse', 'No results', 'لا توجد نتائج')}</div>
              )}
              {(searchResults ?? []).map((product: any) => {
                const name = getProductName(product.translations, locale)
                const variants = product.variants ?? []
                const images = product.images ?? []
                const primaryImg = images.find((img: any) => img.isPrimary) ?? images[0]
                return (
                  <div key={product.id} className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      {primaryImg?.url ? (
                        <img src={primaryImg.url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">{variants.length} {t3('Varianten', 'variants', 'متغيرات')}</p>
                      </div>
                      {variants.length > 0 && (
                        <button onClick={() => addAllVariants(product)} className="text-xs px-2 py-1 rounded-lg bg-[#d4a853]/10 text-[#d4a853] hover:bg-[#d4a853]/20 font-semibold transition-colors">
                          {t3('Alle hinzuf\u00fcgen', 'Add all', 'إضافة الكل')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {variants.map((v: any) => (
                        <button key={v.id} onClick={() => addVariant(product, v)}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs hover:bg-muted/50 transition-colors border border-transparent hover:border-border text-start">
                          <div className="w-3 h-3 rounded-full flex-shrink-0 border" style={{ backgroundColor: v.colorHex || '#ccc' }} />
                          <span className="truncate">{translateColor(v.color, locale)} / {v.size}</span>
                          <Plus className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Druckbogen (Print Sheet) */}
        <div className="space-y-4">
          <div className="bg-background border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#d4a853]" />
                <h2 className="text-sm font-semibold">{t3('Druckbogen', 'Print Sheet', 'ورقة الطباعة')}</h2>
                {druckbogen.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#d4a853]/20 text-[#d4a853] text-xs font-bold">{totalLabels}</span>
                )}
              </div>
              {druckbogen.length > 0 && (
                <button onClick={() => setDruckbogen([])} className="text-xs text-red-500 hover:text-red-600">
                  {t3('Alle entfernen', 'Remove all', 'إزالة الكل')}
                </button>
              )}
            </div>

            {druckbogen.length === 0 ? (
              <div className="p-12 text-center">
                <ImageIcon className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{t3('Produkte links suchen und Varianten hier hinzuf\u00fcgen', 'Search products on the left and add variants here', 'ابحث عن المنتجات على اليسار وأضف المتغيرات هنا')}</p>
              </div>
            ) : (
              <>
                <div className="max-h-[350px] overflow-y-auto divide-y">
                  {druckbogen.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="h-9 w-9 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: item.colorHex }}>
                          <span className="text-white font-bold text-xs">{item.productName.charAt(0)}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{item.productName}</p>
                        <p className="text-[10px] text-muted-foreground">{item.color} / {item.size} &middot; <span className="font-mono">{item.sku}</span></p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => updateQty(item.id, -1)} className="h-6 w-6 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80"><Minus className="h-3 w-3" /></button>
                        <span className="w-6 text-center text-xs font-bold">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="h-6 w-6 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80"><Plus className="h-3 w-3" /></button>
                      </div>
                      <button onClick={() => removeItem(item.id)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>

                {/* Size + Print */}
                <div className="p-4 border-t space-y-3">
                  <div className="flex gap-2">
                    {SIZES.map((s) => (
                      <button key={s.key} onClick={() => setSelectedSize(s.key)}
                        className={`flex-1 px-2 py-1.5 rounded-xl text-xs font-semibold text-center transition-all ${
                          selectedSize === s.key ? 'bg-[#d4a853] text-white shadow-sm' : 'bg-muted hover:bg-muted/80'
                        }`}>
                        {locale === 'ar' ? s.labelAr : s.label} <span className="font-normal opacity-70">{s.desc}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#d4a853]/10 border border-[#d4a853]/20">
                    <Printer className="h-3.5 w-3.5 text-[#d4a853] flex-shrink-0" />
                    <p className="text-xs text-[#d4a853] font-medium">
                      {t3(
                        `${totalLabels} Etiketten werden auf ${totalPages} A4-Seite(n) gedruckt`,
                        `${totalLabels} labels will be printed on ${totalPages} A4 page(s)`,
                        `سيتم طباعة ${totalLabels} ملصق على ${totalPages} صفحة A4`
                      )}
                    </p>
                  </div>
                  <Button className="w-full gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handlePrint}>
                    <Printer className="h-4 w-4" />{t3('Drucken', 'Print', 'طباعة')} ({totalLabels} {t3('Etiketten', 'labels', 'ملصق')})
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
