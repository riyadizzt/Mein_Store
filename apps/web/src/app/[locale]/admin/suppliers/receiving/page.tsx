'use client'

import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PackageOpen, Search, Plus, Trash2, Check, Printer, Package, Camera } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { LabelPrinter } from '@/components/admin/label-printer'
import { TranslateButton } from '@/components/admin/translate-button'
import { COLOR_PRESETS, type ColorPreset } from '@/lib/color-presets'

const CameraBarcodeScannerOverlay = lazy(() => import('@/components/admin/camera-barcode-scanner').then((m) => ({ default: m.CameraBarcodeScannerOverlay })))

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

// Runtime-extensible copy of the shared preset list — the "add custom
// color" button at the bottom of the picker pushes into this local array
// so per-session custom colors persist while the page is open.
let COLORS_LIST: ColorPreset[] = [...COLOR_PRESETS]

const SIZE_PRESETS: Record<string, string[]> = {
  'damen-ober': ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  'damen-hosen': ['34', '36', '38', '40', '42', '44', '46'],
  'herren-ober': ['S', 'M', 'L', 'XL', 'XXL', '3XL'],
  'herren-hosen': ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '44', '46'],
  'kinder': ['92', '98', '104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164'],
  'kinder-alter': ['1J', '2J', '3J', '4J', '5J', '6J', '7J', '8J', '9J', '10J', '11J', '12J', '13J', '14J', '15J', '16J'],
  'damen-schuhe': ['36', '37', '38', '39', '40', '41', '42'],
  'herren-schuhe': ['40', '41', '42', '43', '44', '45', '46', '47'],
  'kinder-schuhe': ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35'],
  'baby': ['50', '56', '62', '68', '74', '80', '86'],
  'einheit': ['Einheitsgröße'],
}

const SIZE_PRESET_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  'damen-ober': { de: 'Damen Oberbekleidung', en: 'Women Tops', ar: 'قياسات الملابس العلوية النسائية' },
  'damen-hosen': { de: 'Damen Hosen', en: 'Women Pants', ar: 'قياسات البنطلون النسائي' },
  'herren-ober': { de: 'Herren Oberbekleidung', en: 'Men Tops', ar: 'قياسات الملابس العلوية الرجالية' },
  'herren-hosen': { de: 'Herren Hosen', en: 'Men Pants', ar: 'قياسات البنطلون الرجالي' },
  'kinder': { de: 'Kinder', en: 'Kids', ar: 'قياسات الأطفال' },
  'kinder-alter': { de: 'Kinder (Alter)', en: 'Kids (Age)', ar: 'قياسات الأطفال حسب العمر' },
  'damen-schuhe': { de: 'Damen Schuhe', en: 'Women Shoes', ar: 'قياسات الأحذية النسائية' },
  'herren-schuhe': { de: 'Herren Schuhe', en: 'Men Shoes', ar: 'قياسات الأحذية الرجالية' },
  'kinder-schuhe': { de: 'Kinder Schuhe', en: 'Kids Shoes', ar: 'قياسات الأحذية للأطفال' },
  'baby': { de: 'Baby', en: 'Baby', ar: 'قياسات البيبي' },
  'einheit': { de: 'Einheitsgröße', en: 'One Size', ar: 'مقاس موحد' },
}

interface ExistingItem {
  variantId: string
  sku: string
  productName: string
  color: string | null
  size: string | null
  quantity: number
  purchasePrice: number
  salePrice: number
}

interface NewProduct {
  productName: string
  productNameDe?: string
  categoryId: string
  colors: string[]
  sizes: string[]
  purchasePrice: number
  salePrice: number
  quantities: Record<string, number>
}

export default function ReceivingPage() {
  const locale = useLocale()
  const qc = useQueryClient()

  // Step state
  const [supplierId, setSupplierId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [notes, setNotes] = useState('')

  // Existing product items
  const [existingItems, setExistingItems] = useState<ExistingItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // New product form
  const [newProducts, setNewProducts] = useState<NewProduct[]>([])
  const [npForm, setNpForm] = useState({ productName: '', productNameDe: '', categoryId: '', purchasePrice: '', salePrice: '' })
  const [selectedColors, setSelectedColors] = useState<string[]>([])
  const [selectedSizes, setSelectedSizes] = useState<string[]>([])
  const [sizePreset, setSizePreset] = useState('')

  // Result
  const [result, setResult] = useState<any>(null)
  const [showLabels, setShowLabels] = useState(false)
  const [showCamera, setShowCamera] = useState(false)

  // USB/Bluetooth barcode scanner detection
  const keyBuffer = useRef('')
  const lastKeyTime = useRef(0)

  // Queries
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: async () => { const { data } = await api.get('/admin/suppliers', { params: { limit: 200 } }); return data?.data ?? [] },
  })

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data ?? [] },
  })

  const { data: categories } = useQuery({
    queryKey: ['categories-list'],
    queryFn: async () => { const { data } = await api.get('/admin/categories'); return data?.data ?? data ?? [] },
  })

  const { data: searchResults } = useQuery({
    queryKey: ['supplier-product-search', searchQuery, locale],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return []
      const { data } = await api.get('/admin/suppliers/search-products', { params: { q: searchQuery, lang: locale } })
      return data ?? []
    },
    enabled: searchQuery.length >= 2,
  })

  // Submit delivery
  const submitMut = useMutation({
    mutationFn: async () => {
      const body: any = { supplierId, warehouseId: warehouseId || undefined, notes: notes || undefined }

      if (existingItems.length > 0) {
        body.existingItems = existingItems.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          purchasePrice: i.purchasePrice,
        }))
      }

      if (newProducts.length > 0) {
        body.newProducts = newProducts.map((np) => ({
          productName: np.productName,
          productNameDe: np.productNameDe || undefined,
          categoryId: np.categoryId || undefined,
          colors: np.colors,
          sizes: np.sizes,
          purchasePrice: np.purchasePrice,
          salePrice: np.salePrice,
          quantities: np.quantities,
        }))
      }

      const { data } = await api.post('/admin/suppliers/deliveries', body)
      return data
    },
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
    },
  })

  // Add existing item from search — if already in list, increment quantity
  const addExistingItem = useCallback((item: any) => {
    setExistingItems((prev) => {
      const existing = prev.find((e) => e.variantId === item.variantId)
      if (existing) {
        return prev.map((e) => e.variantId === item.variantId ? { ...e, quantity: e.quantity + 1 } : e)
      }
      return [...prev, {
        variantId: item.variantId,
        sku: item.sku,
        productName: item.productName,
        color: item.color,
        size: item.size,
        quantity: 1,
        purchasePrice: item.purchasePrice ?? 0,
        salePrice: item.salePrice,
      }]
    })
    setSearchQuery('')
    searchRef.current?.focus()
  }, [])

  // Scan barcode — search API and auto-add
  const handleBarcodeScan = useCallback(async (barcode: string) => {
    try {
      const { data } = await api.get('/admin/suppliers/search-products', { params: { q: barcode.trim(), lang: locale } })
      if (data?.length === 1) {
        addExistingItem(data[0])
      } else if (data?.length > 1) {
        setSearchQuery(barcode.trim())
        setMode('existing')
      }
    } catch {}
  }, [addExistingItem, locale])

  // USB/Bluetooth scanner keystroke detection
  useEffect(() => {
    if (mode !== 'existing' || !supplierId) return
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return
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
  }, [mode, supplierId, handleBarcodeScan])

  // Add new product to list
  const addNewProduct = () => {
    if (!npForm.productName || !npForm.purchasePrice || !npForm.salePrice) return
    const colors = selectedColors.length > 0 ? selectedColors : ['']
    const sizes = selectedSizes.length > 0 ? selectedSizes : ['']

    const quantities: Record<string, number> = {}
    for (const c of colors) {
      for (const s of sizes) {
        quantities[`${c}/${s}`] = 1
      }
    }

    setNewProducts([...newProducts, {
      productName: npForm.productName,
      productNameDe: npForm.productNameDe || undefined,
      categoryId: npForm.categoryId,
      colors: colors.filter((c) => c !== ''),
      sizes: sizes.filter((s) => s !== ''),
      purchasePrice: parseFloat(npForm.purchasePrice),
      salePrice: parseFloat(npForm.salePrice),
      quantities,
    }])
    setNpForm({ productName: '', productNameDe: '', categoryId: npForm.categoryId, purchasePrice: '', salePrice: '' })
    setSelectedColors([])
    setSelectedSizes([])
  }

  const getColorName = (c: typeof COLORS_LIST[0]) => c.name[locale as 'de' | 'en' | 'ar'] ?? c.name.de
  const getColorDeName = (c: typeof COLORS_LIST[0]) => c.name.de // Always use German name for backend (variant name)
  const toggleColor = (deName: string) => setSelectedColors((prev) => prev.includes(deName) ? prev.filter((c) => c !== deName) : [...prev, deName])
  const SIZE_ORDER = ['XS','S','M','L','XL','XXL','3XL','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','50','56','62','68','74','80','86','92','98','104','110','116','122','128','134','140','146','152','158','164','1J','2J','3J','4J','5J','6J','7J','8J','9J','10J','11J','12J','13J','14J','15J','16J','Einheitsgröße']
  const toggleSize = (size: string) => setSelectedSizes((prev) => {
    const next = prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    return next.sort((a, b) => {
      const ia = SIZE_ORDER.indexOf(a)
      const ib = SIZE_ORDER.indexOf(b)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
  })

  const updateExistingQty = (idx: number, qty: number) => {
    const items = [...existingItems]
    items[idx].quantity = Math.max(1, qty)
    setExistingItems(items)
  }

  const updateExistingPrice = (idx: number, price: number) => {
    const items = [...existingItems]
    items[idx].purchasePrice = price
    setExistingItems(items)
  }

  const removeExistingItem = (idx: number) => {
    setExistingItems(existingItems.filter((_, i) => i !== idx))
  }

  const updateNewProductQty = (npIdx: number, key: string, qty: number) => {
    const prods = [...newProducts]
    prods[npIdx].quantities[key] = Math.max(0, qty)
    setNewProducts(prods)
  }

  const totalItems = existingItems.reduce((s, i) => s + i.quantity, 0) + newProducts.reduce((s, np) => s + Object.values(np.quantities).reduce((a, b) => a + b, 0), 0)
  const totalCost = existingItems.reduce((s, i) => s + i.purchasePrice * i.quantity, 0) + newProducts.reduce((s, np) => s + np.purchasePrice * Object.values(np.quantities).reduce((a, b) => a + b, 0), 0)

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR' })

  // ── Result screen ──────────────────────────────────────────
  // Build label data from delivery items
  // For labels: use German product name (from createdProducts or delivery summary)
  const deNameMap = new Map<string, string>()
  for (const np of (result?.createdProducts ?? [])) {
    // Find matching newProduct to get productNameDe
    const orig = newProducts.find((p) => p.productName === np.name) ?? newProducts.find((p) => p.productNameDe === np.name)
    if (orig?.productNameDe) deNameMap.set(np.name, orig.productNameDe)
  }

  const labelItems = (result?.delivery?.items ?? []).map((item: any) => ({
    sku: item.sku ?? 'N/A',
    barcode: item.sku,
    productName: deNameMap.get(item.productName) || item.productName || '',
    color: item.color ?? '',
    size: item.size ?? '',
    price: Number(item.totalCost) / (item.quantity || 1),
    stock: item.quantity,
  }))

  if (result) {
    return (
      <div>
        <AdminBreadcrumb items={[
          { label: t3(locale, 'Lieferanten', 'Suppliers', 'الموردون'), href: `/${locale}/admin/suppliers` },
          { label: t3(locale, 'Wareneingang', 'Receiving', 'استلام بضاعة') },
        ]} />
        <div className="max-w-2xl mx-auto text-center space-y-6 py-12">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <Check className="h-8 w-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold">{t3(locale, 'Wareneingang abgeschlossen!', 'Delivery Complete!', 'تم استلام البضاعة!')}</h1>
          <div className="bg-background border rounded-xl p-6 text-start space-y-3">
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Lieferschein-Nr.', 'Delivery No.', 'رقم التوريد')}</span><span className="font-mono font-bold">{result.summary?.deliveryNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Gesamtwert', 'Total', 'الإجمالي')}</span><span className="font-bold tabular-nums">{fmt(result.summary?.totalAmount ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Artikel', 'Items', 'القطع')}</span><span className="font-bold">{result.summary?.totalItemCount}</span></div>
            {result.summary?.newProductsCreated > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">{t3(locale, 'Neue Produkte (inaktiv)', 'New Products (inactive)', 'منتجات جديدة (غير مفعلة)')}</span><span className="font-bold text-amber-400">{result.summary?.newProductsCreated}</span></div>
            )}
          </div>

          {/* Items list */}
          {labelItems.length > 0 && (
            <div className="bg-background border rounded-xl overflow-hidden text-start">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/30 border-b">
                  <th className="text-start px-4 py-2 text-sm font-medium">SKU</th>
                  <th className="text-start px-4 py-2 text-sm font-medium">{t3(locale, 'Produkt', 'Product', 'المنتج')}</th>
                  <th className="text-center px-4 py-2 text-sm font-medium">{t3(locale, 'Farbe/Größe', 'Color/Size', 'اللون/المقاس')}</th>
                  <th className="text-end px-4 py-2 text-sm font-medium">{t3(locale, 'Menge', 'Qty', 'الكمية')}</th>
                </tr></thead>
                <tbody>
                  {labelItems.map((item: any, idx: number) => (
                    <tr key={idx} className="border-t border-border/20">
                      <td className="text-start px-4 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="text-start px-4 py-2 text-xs">{item.productName}</td>
                      <td className="px-4 py-2 text-center text-xs text-muted-foreground">{[item.color, item.size].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-4 py-2 text-end tabular-nums font-semibold">{item.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => { setResult(null); setExistingItems([]); setNewProducts([]); setNotes(''); setShowLabels(false) }}>
              {t3(locale, 'Neuer Wareneingang', 'New Delivery', 'توريد جديد')}
            </Button>
            {labelItems.length > 0 && (
              <Button className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-1" onClick={() => setShowLabels(true)}>
                <Printer className="h-4 w-4" />
                {t3(locale, 'Barcode-Labels drucken', 'Print Barcode Labels', 'طباعة ملصقات الباركود')}
              </Button>
            )}
          </div>
        </div>

        {/* Label Printer Modal */}
        {showLabels && labelItems.length > 0 && (
          <LabelPrinter items={labelItems} onClose={() => setShowLabels(false)} />
        )}
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────
  return (
    <div>
      <AdminBreadcrumb items={[
        { label: t3(locale, 'Lieferanten', 'Suppliers', 'الموردون'), href: `/${locale}/admin/suppliers` },
        { label: t3(locale, 'Wareneingang', 'Receiving', 'استلام بضاعة') },
      ]} />

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
        <PackageOpen className="h-6 w-6 text-[#d4a853]" />
        {t3(locale, 'Wareneingang', 'Goods Receiving', 'استلام بضاعة')}
      </h1>

      {/* Step 1: Supplier + Warehouse */}
      <div className="bg-background border rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t3(locale, 'Lieferant auswählen *', 'Select Supplier *', 'اختر المورد *')}</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1"
          >
            <option value="">{t3(locale, '— Lieferant wählen —', '— Select —', '— اختر —')}</option>
            {(suppliers ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}{s.country ? ` (${s.country})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t3(locale, 'Ziellager *', 'Target Warehouse *', 'المستودع المستهدف *')}</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1"
          >
            <option value="">{t3(locale, '— Standard-Lager —', '— Default Warehouse —', '— المستودع الافتراضي —')}</option>
            {(warehouses ?? []).map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ` (${t3(locale, 'Standard', 'Default', 'افتراضي')})` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {supplierId && (
        <>
          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('existing')}
              className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${mode === 'existing' ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853]' : 'text-muted-foreground'}`}
            >
              {t3(locale, 'Bestehende Produkte', 'Existing Products', 'منتجات موجودة')}
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${mode === 'new' ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853]' : 'text-muted-foreground'}`}
            >
              {t3(locale, 'Neue Produkte', 'New Products', 'منتجات جديدة')}
            </button>
          </div>

          {/* Existing products mode */}
          {mode === 'existing' && (
            <div className="space-y-3">
              {/* Search + Camera */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t3(locale, 'Name, SKU oder Barcode scannen...', 'Name, SKU or scan barcode...', 'اسم، SKU أو مسح الباركود...')}
                    className="w-full h-10 ltr:pl-10 rtl:pr-10 px-4 rounded-lg border bg-background text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchResults?.length === 1) {
                        addExistingItem(searchResults[0])
                      } else if (e.key === 'Enter' && searchQuery.length > 3) {
                        handleBarcodeScan(searchQuery)
                      }
                    }}
                  />
                {/* Search results dropdown */}
                {searchQuery.length >= 2 && (searchResults ?? []).length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-background border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                    {(searchResults ?? []).map((r: any) => (
                      <button
                        key={r.variantId}
                        onClick={() => addExistingItem(r)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-start hover:bg-muted/50 transition-colors border-b border-border/20 last:border-0"
                      >
                        <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{r.productName}</div>
                          <div className="text-xs text-muted-foreground">{r.sku} {r.color && `· ${r.color}`} {r.size && `· ${r.size}`} · {t3(locale, 'Bestand', 'Stock', 'المخزون')}: {r.stock}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                </div>
                {/* Camera scanner button */}
                <button
                  onClick={() => setShowCamera(true)}
                  className="h-10 w-10 flex-shrink-0 rounded-lg border bg-background flex items-center justify-center hover:bg-muted transition-colors"
                  title={t3(locale, 'Kamera-Scanner', 'Camera Scanner', 'ماسح الكاميرا')}
                >
                  <Camera className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {/* Scan hints */}
              {existingItems.length === 0 && (
                <div className="flex flex-wrap gap-4 mb-3 text-xs text-muted-foreground">
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

              {/* Camera Scanner Overlay */}
              {showCamera && (
                <Suspense fallback={null}>
                  <CameraBarcodeScannerOverlay
                    mode="single"
                    locale={locale}
                    onSingleResult={(product) => {
                      const name = Array.isArray(product.productName) ? (product.productName.find((t: any) => t.language === locale)?.name ?? product.productName[0]?.name ?? product.sku) : product.sku
                      addExistingItem({
                        variantId: product.variantId,
                        sku: product.sku,
                        productName: name,
                        color: product.color,
                        size: product.size,
                        purchasePrice: null,
                        salePrice: 0,
                      })
                      setShowCamera(false)
                    }}
                    onClose={() => setShowCamera(false)}
                  />
                </Suspense>
              )}

              {/* Items table */}
              {existingItems.length > 0 && (
                <div className="bg-background border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-start px-4 py-2 text-sm font-medium">{t3(locale, 'Produkt', 'Product', 'المنتج')}</th>
                        <th className="text-start px-4 py-2 text-sm font-medium">SKU</th>
                        <th className="text-center px-4 py-2 text-sm font-medium">{t3(locale, 'Menge', 'Qty', 'الكمية')}</th>
                        <th className="text-center px-4 py-2 text-sm font-medium">{t3(locale, 'EK-Preis', 'Cost', 'سعر الشراء')}</th>
                        <th className="text-end px-4 py-2 text-sm font-medium">{t3(locale, 'Summe', 'Total', 'المجموع')}</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {existingItems.map((item, idx) => (
                        <tr key={item.variantId} className="border-b border-border/20">
                          <td className="text-start px-4 py-2">
                            <div className="font-medium text-sm">{item.productName}</div>
                            <div className="text-xs text-muted-foreground">{item.color} {item.size}</div>
                          </td>
                          <td className="text-start px-4 py-2 text-xs font-mono text-muted-foreground">{item.sku}</td>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="number" min="1"
                              value={item.quantity}
                              onChange={(e) => updateExistingQty(idx, parseInt(e.target.value) || 1)}
                              className="w-16 h-8 text-center rounded border bg-background text-sm tabular-nums"
                              onKeyDown={(e) => { if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus() } }}
                            />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="number" step="0.01" min="0"
                              value={item.purchasePrice}
                              onChange={(e) => updateExistingPrice(idx, parseFloat(e.target.value) || 0)}
                              className="w-20 h-8 text-center rounded border bg-background text-sm tabular-nums"
                            />
                          </td>
                          <td className="px-4 py-2 text-end tabular-nums font-medium">{fmt(item.purchasePrice * item.quantity)}</td>
                          <td className="px-2 py-2">
                            <button onClick={() => removeExistingItem(idx)} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* New products mode */}
          {mode === 'new' && (
            <div className="space-y-3">
              {/* New Product Form — Premium Design */}
              <div className="bg-background border rounded-2xl overflow-hidden">
                {/* Section 1: Product Info */}
                <div className="p-5 border-b">
                  <h3 className="text-sm font-semibold mb-3">{t3(locale, 'Produktinfo', 'Product Info', 'معلومات المنتج')}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="col-span-2 md:col-span-1">
                      <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'Produktname *', 'Product Name *', 'اسم المنتج *')}</label>
                      <input value={npForm.productName} onChange={(e) => setNpForm({ ...npForm, productName: e.target.value })} className="w-full h-10 px-3 rounded-xl border bg-background text-sm mt-1 focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853] transition-all" />
                      {npForm.productName.trim() && (
                        <div className="mt-1">
                          {npForm.productNameDe ? (
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>DE: <span className="font-medium text-foreground">{npForm.productNameDe}</span></span>
                              <button onClick={() => setNpForm({ ...npForm, productNameDe: '' })} className="text-muted-foreground hover:text-red-400">×</button>
                            </div>
                          ) : (
                            <TranslateButton text={npForm.productName} sourceLang="ar" targetLang="de" locale={locale} onAccept={(de) => setNpForm({ ...npForm, productNameDe: de })} />
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'Kategorie', 'Category', 'الفئة')}</label>
                      <select value={npForm.categoryId} onChange={(e) => setNpForm({ ...npForm, categoryId: e.target.value })} className="w-full h-10 px-3 rounded-xl border bg-background text-base mt-1">
                        <option value="">—</option>
                        {(categories ?? []).map((c: any) => (
                          <option key={c.id} value={c.id}>{c.translations?.find((t: any) => t.language === locale)?.name ?? c.translations?.[0]?.name ?? c.name ?? c.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'EK-Preis (€) *', 'Cost (€) *', 'سعر الشراء *')}</label>
                      <input type="number" step="0.01" value={npForm.purchasePrice} onChange={(e) => setNpForm({ ...npForm, purchasePrice: e.target.value })} className="w-full h-10 px-3 rounded-xl border bg-background text-sm mt-1 tabular-nums" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground">{t3(locale, 'VK-Preis (€) *', 'Price (€) *', 'سعر البيع *')}</label>
                      <input type="number" step="0.01" value={npForm.salePrice} onChange={(e) => setNpForm({ ...npForm, salePrice: e.target.value })} className="w-full h-10 px-3 rounded-xl border bg-background text-sm mt-1 tabular-nums" />
                    </div>
                  </div>
                </div>

                {/* Section 2: Colors */}
                <div className="p-5 border-b">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    {t3(locale, 'Farben', 'Colors', 'الألوان')}
                    {selectedColors.length > 0 && <span className="text-xs font-normal bg-[#d4a853]/15 text-[#d4a853] px-2 py-0.5 rounded-full">{selectedColors.length}</span>}
                  </h3>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {COLORS_LIST.map((c) => {
                      const deName = getColorDeName(c)
                      const active = selectedColors.includes(deName)
                      return (
                        <button
                          key={deName}
                          type="button"
                          onClick={() => toggleColor(deName)}
                          className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border transition-all ${
                            active ? 'border-[#d4a853] bg-[#d4a853]/10 shadow-sm' : 'border-transparent hover:bg-muted/50'
                          }`}
                        >
                          {c.hex === 'multi' ? (
                            <span className="w-7 h-7 rounded-full shadow-sm" style={{ background: 'conic-gradient(red,yellow,green,cyan,blue,magenta,red)' }} />
                          ) : (
                            <span className={`w-7 h-7 rounded-full shadow-sm ${c.hex === '#FFFFFF' ? 'border border-gray-200' : ''}`} style={{ backgroundColor: c.hex }} />
                          )}
                          <span className="text-[10px] text-muted-foreground leading-tight text-center">{getColorName(c)}</span>
                        </button>
                      )
                    })}
                  </div>
                  {/* Custom color — color picker + name + auto-translate */}
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="color"
                      id="custom-color-picker"
                      defaultValue="#666666"
                      className="w-9 h-9 rounded-full border-2 border-dashed border-[#d4a853]/40 cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0.5"
                    />
                    <input
                      type="text"
                      id="custom-color-name"
                      placeholder={t3(locale, 'Farbname...', 'Color name...', 'اسم اللون...')}
                      className="h-9 px-3 rounded-xl border bg-background text-sm w-36"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const nameEl = document.getElementById('custom-color-name') as HTMLInputElement
                        const arName = nameEl?.value.trim()
                        if (!arName) return

                        // Translate AR → DE for SKU/barcode
                        let deName = arName
                        try {
                          const { data } = await api.post('/admin/translate', { text: arName, sourceLang: 'ar', targetLang: 'de' })
                          if (data.text) deName = data.text
                        } catch {}

                        // Add DE name to selectedColors (used for SKU) + store AR mapping
                        if (!selectedColors.includes(deName)) {
                          // Add to COLORS_LIST dynamically for display
                          const hex = (document.getElementById('custom-color-picker') as HTMLInputElement)?.value || '#666666'
                          COLORS_LIST.push({ name: { de: deName, en: deName, ar: arName }, hex })
                          setSelectedColors([...selectedColors, deName])
                          nameEl.value = ''
                        }
                      }}
                      className="h-9 px-3 rounded-xl bg-[#d4a853] text-black text-xs font-semibold hover:bg-[#c49b4a] transition-colors"
                    >
                      {t3(locale, 'Hinzufügen', 'Add', 'إضافة')}
                    </button>
                  </div>
                </div>

                {/* Section 3: Sizes */}
                <div className="p-5 border-b">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      {t3(locale, 'Größen', 'Sizes', 'المقاسات')}
                      {selectedSizes.length > 0 && <span className="text-xs font-normal bg-[#d4a853]/15 text-[#d4a853] px-2 py-0.5 rounded-full">{selectedSizes.length}</span>}
                    </h3>
                    <select
                      value={sizePreset}
                      onChange={(e) => {
                        setSizePreset(e.target.value)
                        if (e.target.value && SIZE_PRESETS[e.target.value]) setSelectedSizes(SIZE_PRESETS[e.target.value])
                      }}
                      className="h-10 px-3 rounded-xl border bg-background text-sm"
                    >
                      <option value="">{t3(locale, '— Vorlage wählen —', '— Select Preset —', '— اختر قالب —')}</option>
                      {Object.entries(SIZE_PRESET_LABELS).map(([key, labels]) => (
                        <option key={key} value={key}>{labels[locale as 'de' | 'en' | 'ar'] ?? labels.de}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(sizePreset && SIZE_PRESETS[sizePreset] ? SIZE_PRESETS[sizePreset] : [...new Set([...selectedSizes, ...(SIZE_PRESETS['herren-ober'] ?? [])])]).map((s) => {
                      const active = selectedSizes.includes(s)
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSize(s)}
                          className={`min-w-[40px] h-9 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${
                            active ? 'border-[#d4a853] bg-[#d4a853]/10 text-foreground' : 'border-border text-muted-foreground hover:border-foreground/20'
                          }`}
                        >
                          {s}
                        </button>
                      )
                    })}
                  </div>
                  {selectedSizes.length > 0 && (
                    <button onClick={() => setSelectedSizes([])} className="text-[10px] text-muted-foreground mt-2 hover:text-foreground">
                      {t3(locale, 'Alle abwählen', 'Deselect all', 'إلغاء تحديد الكل')}
                    </button>
                  )}
                </div>

                {/* Section 4: Summary + Add */}
                <div className="p-5 bg-muted/20 flex items-center justify-between">
                  <div className="text-sm">
                    {selectedColors.length > 0 && selectedSizes.length > 0 ? (
                      <span className="text-muted-foreground">{t3(locale, 'Varianten', 'Variants', 'المتغيرات')}: <span className="font-bold text-foreground">{selectedColors.length} × {selectedSizes.length} = {selectedColors.length * selectedSizes.length}</span></span>
                    ) : (
                      <span className="text-red-400 text-xs">
                        {selectedColors.length === 0 && selectedSizes.length === 0
                          ? t3(locale, '⚠ Bitte Farben und Größen wählen', '⚠ Please select colors and sizes', '⚠ يرجى اختيار الألوان والمقاسات')
                          : selectedColors.length === 0
                          ? t3(locale, '⚠ Bitte mindestens eine Farbe wählen', '⚠ Please select at least one color', '⚠ يرجى اختيار لون واحد على الأقل')
                          : t3(locale, '⚠ Bitte mindestens eine Größe wählen', '⚠ Please select at least one size', '⚠ يرجى اختيار مقاس واحد على الأقل')
                        }
                      </span>
                    )}
                  </div>
                  <Button onClick={addNewProduct} disabled={!npForm.productName || !npForm.purchasePrice || !npForm.salePrice || selectedColors.length === 0 || selectedSizes.length === 0} className="gap-1.5 bg-[#d4a853] hover:bg-[#c49b4a] text-black rounded-xl h-10 px-5">
                    <Plus className="h-4 w-4" />
                    {t3(locale, 'Produkt hinzufügen', 'Add Product', 'إضافة منتج')}
                  </Button>
                </div>
              </div>

              {/* New products list with variant quantities */}
              {newProducts.map((np, npIdx) => (
                <div key={npIdx} className="bg-background border rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#d4a853]/10 flex items-center justify-center">
                        <Package className="h-4.5 w-4.5 text-[#d4a853]" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{np.productName}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{t3(locale, 'EK', 'Cost', 'شراء')}: <span className="font-medium text-foreground">{fmt(np.purchasePrice)}</span></span>
                          <span>{t3(locale, 'VK', 'Price', 'بيع')}: <span className="font-medium text-foreground">{fmt(np.salePrice)}</span></span>
                          {np.colors.length > 0 && <span>{np.colors.length} {t3(locale, 'Farben', 'colors', 'ألوان')}</span>}
                          {np.sizes.length > 0 && <span>{np.sizes.length} {t3(locale, 'Größen', 'sizes', 'مقاسات')}</span>}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setNewProducts(newProducts.filter((_, i) => i !== npIdx))} className="p-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-4">
                  {(() => {
                    const colors = np.colors.length > 0 ? np.colors : ['']
                    const sizes = np.sizes.length > 0 ? np.sizes : ['']
                    return (
                      <div className="border rounded-xl overflow-hidden">
                        {/* Table header — sizes + add button */}
                        <div className="flex bg-muted/30 items-center">
                          <div className="w-24 flex-shrink-0 px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {colors[0] !== '' ? (t3(locale, 'Farbe', 'Color', 'اللون')) : ''}
                          </div>
                          {sizes.map((s) => (
                            <div key={s} className="flex-1 min-w-[56px] px-1 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                              {s || '—'}
                            </div>
                          ))}
                        </div>
                        {/* Rows — one per color */}
                        {colors.map((colorName, ci) => {
                          const colorDef = COLORS_LIST.find((c) => c.name.de === colorName)
                          return (
                            <div key={colorName} className={`flex items-center ${ci > 0 ? 'border-t' : ''}`}>
                              <div className="w-24 flex-shrink-0 px-3 py-2.5 flex items-center gap-2">
                                {colorDef ? (
                                  <>
                                    {colorDef.hex === 'multi'
                                      ? <span className="w-5 h-5 rounded-full flex-shrink-0 shadow-sm" style={{ background: 'conic-gradient(red,yellow,green,cyan,blue,magenta,red)' }} />
                                      : <span className={`w-5 h-5 rounded-full flex-shrink-0 shadow-sm ${colorDef.hex === '#FFFFFF' ? 'border border-gray-200' : ''}`} style={{ backgroundColor: colorDef.hex }} />
                                    }
                                    <span className="text-[11px] font-medium truncate">{colorDef.name[locale as 'de'|'en'|'ar'] ?? colorName}</span>
                                  </>
                                ) : colorName ? (
                                  <span className="text-[11px] font-medium">{colorName}</span>
                                ) : null}
                              </div>
                              {sizes.map((size) => {
                                const key = `${colorName}/${size}`
                                return (
                                  <div key={key} className="flex-1 min-w-[56px] px-1 py-2 flex justify-center">
                                    <input
                                      type="number" min="0"
                                      value={np.quantities[key] ?? 0}
                                      onChange={(e) => updateNewProductQty(npIdx, key, parseInt(e.target.value) || 0)}
                                      className="w-12 h-8 text-center rounded-lg border bg-background text-sm tabular-nums focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853] transition-all"
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Add size — below matrix */}
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="h-7 px-2 rounded-lg border border-dashed border-[#d4a853]/40 bg-[#d4a853]/5 text-[#d4a853] text-[10px] font-semibold cursor-pointer"
                      value={sizePreset}
                      onChange={(e) => setSizePreset(e.target.value)}
                    >
                      <option value="">{t3(locale, '+ Größe hinzufügen', '+ Add size', '+ إضافة مقاس')}</option>
                      {Object.entries(SIZE_PRESET_LABELS).map(([key, labels]) => (
                        <option key={key} value={key}>{labels[locale as 'de'|'en'|'ar'] ?? labels.de}</option>
                      ))}
                    </select>
                    {sizePreset && (
                      <select
                        className="h-7 px-2 rounded-lg border border-[#d4a853] bg-[#d4a853]/5 text-[#d4a853] text-[10px] font-semibold cursor-pointer"
                        value=""
                        onChange={(e) => {
                          const s2 = e.target.value
                          if (!s2 || np.sizes.includes(s2)) return
                          const updated = [...newProducts]
                          const newQ = { ...np.quantities }
                          if (np.colors.length > 0) { for (const c2 of np.colors) newQ[`${c2}/${s2}`] = 1 }
                          else newQ[`/${s2}`] = 1
                          updated[npIdx] = { ...np, sizes: [...np.sizes, s2], quantities: newQ }
                          setNewProducts(updated)
                        }}
                      >
                        <option value="">{t3(locale, 'Größe wählen', 'Select size', 'اختر مقاس')}</option>
                        {(SIZE_PRESETS[sizePreset] ?? []).filter((s2) => !np.sizes.includes(s2)).map((s2) => (
                          <option key={s2} value={s2}>{s2}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="mt-4">
            <label className="text-xs text-muted-foreground">{t3(locale, 'Notizen', 'Notes', 'ملاحظات')}</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" placeholder={t3(locale, 'z.B. Lieferung März 2026', 'e.g. March 2026 delivery', 'مثال: توريد مارس 2026')} />
          </div>

          {/* Footer / Submit */}
          {(existingItems.length > 0 || newProducts.length > 0) && (
            <div className="sticky bottom-0 mt-6 bg-background/95 backdrop-blur border-t -mx-4 px-4 py-4 md:-mx-6 md:px-6 flex items-center justify-between">
              <div>
                <span className="text-sm text-muted-foreground">{totalItems} {t3(locale, 'Artikel', 'items', 'قطعة')}</span>
                <span className="text-lg font-bold ltr:ml-4 rtl:mr-4 tabular-nums">{fmt(totalCost)}</span>
              </div>
              <Button
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending || (existingItems.length === 0 && newProducts.length === 0)}
                className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-2 h-11 px-6"
              >
                <Check className="h-4 w-4" />
                {submitMut.isPending ? '...' : t3(locale, 'Wareneingang abschließen', 'Complete Receiving', 'إتمام الاستلام')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
