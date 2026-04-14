'use client'

import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Search, Trash2, Check, Camera, Package, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const CameraBarcodeScannerOverlay = lazy(() => import('@/components/admin/camera-barcode-scanner').then((m) => ({ default: m.CameraBarcodeScannerOverlay })))

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

interface TransferItem {
  sku: string
  productName: string
  color: string | null
  size: string | null
  quantity: number
  stock: number
  image: string | null
}

export default function TransferPage() {
  const locale = useLocale()
  const qc = useQueryClient()

  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [items, setItems] = useState<TransferItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [result, setResult] = useState<any>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // USB scanner
  const keyBuffer = useRef('')
  const lastKeyTime = useRef(0)

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data ?? [] },
  })

  const { data: searchResults } = useQuery({
    queryKey: ['transfer-search', searchQuery, locale, fromWarehouseId],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      // Scope stock to the source warehouse — transfers always ship
      // FROM fromWarehouseId, so that's the inventory the admin cares
      // about. Without this, the stock column summed all warehouses.
      const { data } = await api.get('/admin/suppliers/search-products', {
        params: { q: searchQuery, lang: locale, ...(fromWarehouseId ? { warehouseId: fromWarehouseId } : {}) },
      })
      return data ?? []
    },
    enabled: searchQuery.length >= 2 && !!fromWarehouseId,
  })

  const submitMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/admin/inventory/batch-transfer', {
        fromWarehouseId,
        toWarehouseId,
        items: items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
      })
      return data
    },
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['admin-inventory'] })
    },
  })

  // Add item — increment if already exists
  const addItem = useCallback((product: any) => {
    setItems((prev) => {
      const existing = prev.find((e) => e.sku === product.sku)
      if (existing) {
        return prev.map((e) => e.sku === product.sku ? { ...e, quantity: e.quantity + 1 } : e)
      }
      return [...prev, {
        sku: product.sku,
        productName: product.productName ?? product.name ?? product.sku,
        color: product.color,
        size: product.size,
        quantity: 1,
        stock: product.stock ?? 0,
        image: product.image ?? null,
      }]
    })
    setSearchQuery('')
    searchRef.current?.focus()
  }, [])

  // Barcode scan
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    try {
      const { data } = await api.get('/admin/suppliers/search-products', {
        params: { q: barcode.trim(), lang: locale, ...(fromWarehouseId ? { warehouseId: fromWarehouseId } : {}) },
      })
      if (data?.length === 1) addItem(data[0])
      else if (data?.length > 1) setSearchQuery(barcode.trim())
    } catch {}
  }, [addItem, locale, fromWarehouseId])

  // USB scanner detection
  useEffect(() => {
    if (!fromWarehouseId || !toWarehouseId) return
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      const now = Date.now()
      if (now - lastKeyTime.current > 200) keyBuffer.current = ''
      lastKeyTime.current = now
      if (e.key === 'Enter' && keyBuffer.current.length > 3) {
        handleBarcodeScan(keyBuffer.current)
        keyBuffer.current = ''
        e.preventDefault()
      } else if (e.key.length === 1) keyBuffer.current += e.key
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fromWarehouseId, toWarehouseId, handleBarcodeScan])

  const updateQty = (sku: string, qty: number) => setItems((prev) => prev.map((i) => i.sku === sku ? { ...i, quantity: Math.max(1, qty) } : i))
  const removeItem = (sku: string) => setItems((prev) => prev.filter((i) => i.sku !== sku))
  const totalItems = items.reduce((s, i) => s + i.quantity, 0)

  const fromName = (warehouses ?? []).find((w: any) => w.id === fromWarehouseId)?.name ?? ''
  const toName = (warehouses ?? []).find((w: any) => w.id === toWarehouseId)?.name ?? ''

  // Result screen
  if (result) {
    return (
      <div>
        <AdminBreadcrumb items={[
          { label: t3(locale, 'Bestand', 'Inventory', 'المخزون'), href: `/${locale}/admin/inventory` },
          { label: t3(locale, 'Transfer', 'Transfer', 'نقل') },
        ]} />
        <div className="max-w-xl mx-auto text-center space-y-6 py-12">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <Check className="h-8 w-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold">{t3(locale, 'Transfer abgeschlossen!', 'Transfer Complete!', 'تم النقل بنجاح!')}</h1>
          <div className="bg-background border rounded-xl p-6 text-start space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Von', 'From', 'من')}</span><span className="font-semibold">{fromName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Nach', 'To', 'إلى')}</span><span className="font-semibold">{toName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Erfolgreich', 'Transferred', 'تم نقلها')}</span><span className="font-bold text-green-500">{result.summary?.transferred}</span></div>
            {result.summary?.failed > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Fehlgeschlagen', 'Failed', 'فشل')}</span><span className="font-bold text-red-500">{result.summary?.failed}</span></div>
            )}
          </div>
          {result.results?.some((r: any) => !r.success) && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-4 text-start">
              <p className="text-sm font-semibold text-red-600 mb-2">{t3(locale, 'Fehler:', 'Errors:', 'أخطاء:')}</p>
              {result.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                <p key={i} className="text-xs text-red-500">{r.sku}: {r.error}</p>
              ))}
            </div>
          )}
          <Button variant="outline" onClick={() => { setResult(null); setItems([]) }}>
            {t3(locale, 'Neuer Transfer', 'New Transfer', 'نقل جديد')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <AdminBreadcrumb items={[
        { label: t3(locale, 'Bestand', 'Inventory', 'المخزون'), href: `/${locale}/admin/inventory` },
        { label: t3(locale, 'Transfer', 'Transfer', 'نقل') },
      ]} />

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <ArrowLeftRight className="h-6 w-6 text-[#d4a853]" />
        {t3(locale, 'Lager-Transfer', 'Warehouse Transfer', 'نقل بين المستودعات')}
      </h1>

      {/* Warehouse selection */}
      <div className="bg-background border rounded-2xl p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'Von (Quell-Lager) *', 'From (Source) *', 'من (المصدر) *')}</label>
            <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} className="w-full h-10 px-3 rounded-xl border bg-background text-base mt-1">
              <option value="">{t3(locale, '— Quell-Lager —', '— Source —', '— المصدر —')}</option>
              {(warehouses ?? []).map((w: any) => (
                <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ` (${t3(locale, 'Standard', 'Default', 'افتراضي')})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-center">
            <ArrowLeftRight className="h-5 w-5 text-[#d4a853]" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'Nach (Ziel-Lager) *', 'To (Target) *', 'إلى (الهدف) *')}</label>
            <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} className="w-full h-10 px-3 rounded-xl border bg-background text-base mt-1">
              <option value="">{t3(locale, '— Ziel-Lager —', '— Target —', '— الهدف —')}</option>
              {(warehouses ?? []).filter((w: any) => w.id !== fromWarehouseId).map((w: any) => (
                <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ` (${t3(locale, 'Standard', 'Default', 'افتراضي')})` : ''}</option>
              ))}
            </select>
          </div>
        </div>
        {fromWarehouseId && toWarehouseId && fromWarehouseId === toWarehouseId && (
          <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{t3(locale, 'Gleiche Lager!', 'Same warehouse!', 'نفس المستودع!')}</p>
        )}
      </div>

      {/* Scanner / Search */}
      {fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId && (
        <>
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t3(locale, 'Produkt scannen oder suchen...', 'Scan or search product...', 'مسح أو بحث عن منتج...')}
                className="w-full h-10 ltr:pl-10 rtl:pr-10 px-4 rounded-xl border bg-background text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchResults?.length === 1) addItem(searchResults[0])
                  else if (e.key === 'Enter' && searchQuery.length > 3) handleBarcodeScan(searchQuery)
                }}
              />
              {searchQuery.length >= 2 && (searchResults ?? []).length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-background border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                  {(searchResults ?? []).map((r: any) => (
                    <button key={r.variantId} onClick={() => addItem(r)} className="w-full flex items-center gap-3 px-4 py-2.5 text-start hover:bg-muted/50 transition-colors border-b border-border/20 last:border-0">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt={r.productName} className="h-9 w-9 rounded-lg object-cover bg-muted flex-shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-muted flex-shrink-0 flex items-center justify-center">
                          <Package className="h-4 w-4 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.productName}</div>
                        <div className="text-xs text-muted-foreground">{r.sku} {r.color && `· ${r.color}`} {r.size && `· ${r.size}`} · {t3(locale, 'Bestand', 'Stock', 'المخزون')}: {r.stock}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowCamera(true)} className="h-10 w-10 flex-shrink-0 rounded-xl border bg-background flex items-center justify-center hover:bg-muted transition-colors" title={t3(locale, 'Kamera-Scanner', 'Camera Scanner', 'ماسح الكاميرا')}>
              <Camera className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Scan hints */}
          {items.length === 0 && (
            <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                {t3(locale, 'USB/Bluetooth Scanner: Barcode einfach scannen', 'USB/Bluetooth Scanner: just scan the barcode', 'ماسح USB/بلوتوث: فقط امسح الباركود')}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30">
                <Camera className="h-3 w-3" />
                {t3(locale, 'Handy-Kamera: auf 📷 klicken', 'Phone Camera: tap 📷', 'كاميرا الهاتف: اضغط على 📷')}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30">
                <Search className="h-3 w-3" />
                {t3(locale, 'Manuell: Name oder SKU eintippen', 'Manual: type name or SKU', 'يدوي: اكتب الاسم أو SKU')}
              </span>
            </div>
          )}

          {showCamera && (
            <Suspense fallback={null}>
              <CameraBarcodeScannerOverlay
                mode="batch"
                locale={locale}
                onSingleResult={(product) => {
                  const name = Array.isArray(product.productName) ? (product.productName.find((t: any) => t.language === locale)?.name ?? product.productName[0]?.name ?? product.sku) : product.sku
                  addItem({ sku: product.sku, productName: name, color: product.color, size: product.size, stock: product.currentStock, image: (product as any).image ?? null })
                  // Camera stays open — keeps scanning
                }}
                onClose={() => setShowCamera(false)}
              />
            </Suspense>
          )}

          {/* Transfer list */}
          {items.length > 0 && (
            <div className="bg-background border rounded-2xl overflow-hidden mb-4">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 text-xs">
                <div className="px-4 py-2 bg-muted/30 font-semibold text-muted-foreground">{t3(locale, 'Produkt', 'Product', 'المنتج')}</div>
                <div className="px-4 py-2 bg-muted/30 font-semibold text-muted-foreground text-center w-20">{t3(locale, 'Bestand', 'Stock', 'المخزون')}</div>
                <div className="px-4 py-2 bg-muted/30 font-semibold text-muted-foreground text-center w-24">{t3(locale, 'Menge', 'Qty', 'الكمية')}</div>
                <div className="px-4 py-2 bg-muted/30 w-10"></div>
                {items.map((item) => (
                  <div key={item.sku} className="contents">
                    <div className="px-4 py-3 border-t border-border/10 flex items-center gap-3">
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image} alt={item.productName} className="h-10 w-10 rounded-lg object-cover bg-muted flex-shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-muted flex-shrink-0 flex items-center justify-center">
                          <Package className="h-4 w-4 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <p className="text-[10px] text-muted-foreground">{item.sku} {item.color && `· ${item.color}`} {item.size && `· ${item.size}`}</p>
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-border/10 text-center text-muted-foreground tabular-nums self-center">{item.stock}</div>
                    <div className="px-4 py-3 border-t border-border/10 flex items-center justify-center">
                      <input
                        type="number" min="1" max={item.stock}
                        value={item.quantity}
                        onChange={(e) => updateQty(item.sku, parseInt(e.target.value) || 1)}
                        className="w-16 h-8 text-center rounded-lg border bg-background text-sm tabular-nums"
                      />
                    </div>
                    <div className="px-2 py-3 border-t border-border/10 flex items-center">
                      <button onClick={() => removeItem(item.sku)} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit */}
          {items.length > 0 && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t -mx-4 px-4 py-4 md:-mx-6 md:px-6 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{items.length} {t3(locale, 'Produkte', 'products', 'منتجات')} · {totalItems} {t3(locale, 'Stück', 'pcs', 'قطعة')}</span>
              <Button
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending || items.length === 0}
                className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-2 h-11 px-6 rounded-xl"
              >
                <ArrowLeftRight className="h-4 w-4" />
                {submitMut.isPending ? '...' : t3(locale, 'Transfer bestätigen', 'Confirm Transfer', 'تأكيد النقل')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
