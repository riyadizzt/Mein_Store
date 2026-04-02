'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Package, AlertTriangle, XCircle, TrendingUp,
  ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Check,
  Download, Upload, ScanBarcode, ClipboardList, PackagePlus, PackageMinus,
  Minus, Plus, RotateCcw, Eye, X, LayoutList, Layers, ArrowRightLeft,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { translateColor, translateMovement, getProductName, formatCurrency, formatShortDate } from '@/lib/locale-utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { AddColorModal, AddSizeModal } from '@/components/admin/add-variant-modals'
import { PrintLabelButton } from '@/components/admin/label-printer'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Camera } from 'lucide-react'
import { CameraBarcodeScannerOverlay } from '@/components/admin/camera-barcode-scanner'

const STATUS_BADGE: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-800',
  low: 'bg-orange-100 text-orange-800',
  out_of_stock: 'bg-red-100 text-red-800',
}

export default function InventoryPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const adminUser = useAuthStore((s) => s.adminUser) as any
  const canSeePrices = adminUser?.role === 'super_admin' || (Array.isArray(adminUser?.permissions) && adminUser.permissions.includes('scanner.view_prices'))

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('')
  const [locationId, setLocationId] = useState('')
  const [sortBy, setSortBy] = useState('stock')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [pageSize, setPageSize] = useState(50)
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped')
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustItem, setAdjustItem] = useState<any>(null)
  const [adjustQty, setAdjustQty] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyItem, setHistoryItem] = useState<any>(null)
  const [showScannerOverlay, setShowScannerOverlay] = useState(false)
  const [scannerMode, setScannerMode] = useState<'intake' | 'output' | 'csv'>('intake')
  const [csvData, setCsvData] = useState<{ sku: string; quantity: number }[]>([])
  const [csvProcessing, setCsvProcessing] = useState(false)
  const [csvResult, setCsvResult] = useState<any>(null)
  const [addColorProduct, setAddColorProduct] = useState<string | null>(null)
  const [addSizeProduct, setAddSizeProduct] = useState<string | null>(null)
  const [showAddWarehouse, setShowAddWarehouse] = useState(false)
  const [newWhName, setNewWhName] = useState('')
  const [newWhType, setNewWhType] = useState<'WAREHOUSE' | 'STORE'>('WAREHOUSE')
  const [transferItem, setTransferItem] = useState<{ inventoryId: string; sku: string; color: string; size: string; stock: number } | null>(null)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferQty, setTransferQty] = useState(1)
  const [scanInput, setScanInput] = useState('')
  const [scannedProduct, setScannedProduct] = useState<any>(null)
  // scanQty removed — batch mode uses per-item qty
  const [scanLog, setScanLog] = useState<any[]>([])
  const scanRef = useRef<HTMLInputElement>(null)
  const [warehouseError, setWarehouseError] = useState<string | null>(null)
  const [cameraBatchOpen, setCameraBatchOpen] = useState(false)
  const [scanFlash, setScanFlash] = useState<{ text: string; type: 'new' | 'duplicate' | 'error' } | null>(null)
  const [batchBooking, setBatchBooking] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const { data: stats } = useQuery({
    queryKey: ['inventory-stats', warehouseId],
    queryFn: async () => { const { data } = await api.get('/admin/inventory/stats', { params: { warehouseId: warehouseId || undefined } }); return data },
  })

  const { data: departments } = useQuery({
    queryKey: ['inventory-departments', warehouseId],
    queryFn: async () => { const { data } = await api.get('/admin/inventory/summary', { params: { warehouseId: warehouseId || undefined } }); return data },
  })

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
  })

  const { data: locations } = useQuery({
    queryKey: ['inventory-locations', warehouseId],
    queryFn: async () => { const { data } = await api.get('/admin/inventory/locations', { params: { warehouseId: warehouseId || undefined } }); return data },
  })

  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-inventory', viewMode, search, warehouseId, categoryId, status, locationId, sortBy, sortDir, pageSize, page],
    queryFn: async () => {
      const endpoint = viewMode === 'grouped' ? '/admin/inventory/grouped' : '/admin/inventory'
      const { data } = await api.get(endpoint, {
        params: {
          search: search || undefined, warehouseId: warehouseId || undefined,
          parentCategoryId: categoryId || undefined, status: status || undefined,
          ...(viewMode === 'flat' ? { locationId: locationId || undefined, sortBy, sortDir } : {}),
          limit: pageSize, offset: page * pageSize,
        },
      })
      return data
    },
  })

  const { data: historyData } = useQuery({
    queryKey: ['inventory-history', historyItem?.variantId, historyItem?.warehouseId],
    queryFn: async () => { const { data } = await api.get(`/admin/inventory/${historyItem.variantId}/${historyItem.warehouseId}/history`); return data },
    enabled: !!historyItem,
  })

  const items = result?.data ?? []
  const totalCount = result?.meta?.total ?? 0
  const totalPages = Math.ceil(totalCount / pageSize)

  const quickAdjustMut = useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: number }) => { await api.patch(`/admin/inventory/${id}/quick`, { delta }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-inventory'] }); qc.invalidateQueries({ queryKey: ['inventory-stats'] }) },
  })

  const adjustMut = useMutation({
    mutationFn: async () => { await api.patch(`/admin/inventory/${adjustItem.id}/adjust`, { quantity: adjustQty, reason: adjustReason }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-inventory'] }); qc.invalidateQueries({ queryKey: ['inventory-stats'] }); setShowAdjustModal(false) },
  })

  // intakeMut/outputMut removed — batch mode handles booking directly

  const transferMut = useMutation({
    mutationFn: async (p: { inventoryId: string; toWarehouseId: string; quantity: number }) => {
      await api.post(`/admin/inventory/${p.inventoryId}/transfer`, { toWarehouseId: p.toWarehouseId, quantity: p.quantity })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory-departments'] })
      setTransferItem(null)
    },
  })

  // USB scanner fast keystroke detection — redirects to batch scan
  const lastKeyTime = useRef(0)
  const keyBuffer = useRef('')

  // ── Batch scan: add to list instead of booking immediately ──
  const handleBatchScan = useCallback(async (code: string) => {
    if (!code.trim()) return
    setScanInput('')

    // Check if it's a return barcode (RET-XXXX-XXXXX)
    if (code.trim().startsWith('RET-')) {
      try {
        const { data } = await api.post(`/admin/inventory/return-scan/${encodeURIComponent(code.trim())}`)
        if (data.alreadyProcessed) {
          setScanFlash({ text: locale === 'ar' ? 'تمت معالجة المرتجع بالفعل' : 'Retoure bereits verarbeitet', type: 'error' })
        } else if (data.success && data.items?.length > 0) {
          // Show all returned items in the scan list
          setScanFlash({ text: locale === 'ar' ? `إرجاع ${data.items.length} عنصر — ${data.orderNumber}` : `Retoure: ${data.items.length} Artikel — ${data.orderNumber}`, type: 'new' })
          setScanLog((prev) => {
            const newItems = [...prev]
            for (const item of data.items) {
              const existing = newItems.findIndex((i) => i.sku === item.sku)
              if (existing >= 0) {
                newItems[existing] = { ...newItems[existing], qty: newItems[existing].qty + item.quantity }
              } else {
                newItems.push({
                  variantId: item.variantId ?? '',
                  sku: item.sku,
                  productName: [{ name: item.name, language: 'de' }],
                  image: null,
                  color: '',
                  size: '',
                  inventoryId: '',
                  price: 0,
                  qty: item.quantity,
                  mode: 'intake',
                })
              }
            }
            return newItems
          })
        } else {
          setScanFlash({ text: locale === 'ar' ? 'لا توجد عناصر في المرتجع' : 'Keine Artikel in Retoure', type: 'error' })
        }
      } catch {
        setScanFlash({ text: locale === 'ar' ? 'رقم المرتجع غير موجود' : 'Retoure nicht gefunden', type: 'error' })
      }
      setTimeout(() => scanRef.current?.focus(), 50)
      return
    }

    try {
      const { data } = await api.get(`/admin/inventory/barcode/${encodeURIComponent(code.trim())}`)
      setScannedProduct(data)
      const variantId = data.variantId ?? data.id
      setScanLog((prev) => {
        const idx = prev.findIndex((item) => item.variantId === variantId)
        if (idx >= 0) {
          setScanFlash({ text: locale === 'ar' ? `تم تحديث الكمية (×${prev[idx].qty + 1})` : `Menge aktualisiert (×${prev[idx].qty + 1})`, type: 'duplicate' })
          return prev.map((item, i) => i === idx ? { ...item, qty: item.qty + 1 } : item)
        } else {
          setScanFlash({ text: locale === 'ar' ? 'منتج جديد' : 'Neuer Artikel', type: 'new' })
          return [...prev, {
            variantId,
            sku: data.sku,
            productName: data.productName ?? [],
            image: data.image,
            color: data.color,
            size: data.size,
            inventoryId: data.inventory?.[0]?.id,
            price: data.price ?? 0,
            qty: 1,
            mode: scannerMode,
          }]
        }
      })
    } catch {
      setScannedProduct(null)
      setScanFlash({ text: locale === 'ar' ? 'لم يتم العثور على الباركود' : 'Barcode nicht gefunden', type: 'error' })
    }
    setTimeout(() => scanRef.current?.focus(), 50)
  }, [locale, scannerMode])

  // USB scanner keystroke → batch scan
  useEffect(() => {
    if (!showScannerOverlay) return
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const now = Date.now()
      if (now - lastKeyTime.current > 200) keyBuffer.current = ''
      lastKeyTime.current = now
      if (e.key === 'Enter' && keyBuffer.current.length > 3) {
        handleBatchScan(keyBuffer.current)
        keyBuffer.current = ''
        e.preventDefault()
      } else if (e.key.length === 1) keyBuffer.current += e.key
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showScannerOverlay, handleBatchScan])

  // Clear flash after 1.5s
  useEffect(() => {
    if (!scanFlash) return
    const timer = setTimeout(() => setScanFlash(null), 1500)
    return () => clearTimeout(timer)
  }, [scanFlash])

  const updateScanLogQty = useCallback((index: number, newQty: number) => {
    if (newQty <= 0) return removeScanLogItem(index)
    setScanLog((prev) => prev.map((item, i) => i === index ? { ...item, qty: newQty } : item))
  }, [])

  const removeScanLogItem = useCallback((index: number) => {
    setScanLog((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleBatchConfirm = useCallback(async () => {
    if (scanLog.length === 0) return
    setBatchBooking(true)
    try {
      if (scannerMode === 'intake') {
        const items = scanLog.filter((item) => item.inventoryId).map((item) => ({ inventoryId: item.inventoryId, quantity: item.qty }))
        if (items.length > 0) await api.post('/admin/inventory/intake', { items, reason: 'Batch scanner intake' })
      } else {
        // Output: process one by one
        for (const item of scanLog) {
          if (item.inventoryId) await api.post(`/admin/inventory/${item.inventoryId}/output`, { quantity: item.qty, reason: 'Batch scanner output' })
        }
      }
      qc.invalidateQueries({ queryKey: ['admin-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      setScanLog([])
      setScannedProduct(null)
      setScanFlash({ text: locale === 'ar' ? 'تم الحجز بنجاح!' : 'Erfolgreich gebucht!', type: 'new' })
    } catch {
      setScanFlash({ text: locale === 'ar' ? 'خطأ في الحجز' : 'Fehler beim Buchen', type: 'error' })
    }
    setBatchBooking(false)
  }, [scanLog, scannerMode, locale, qc])

  const hasFilters = warehouseId || categoryId || status || locationId
  const resetFilters = () => { setWarehouseId(''); setCategoryId(''); setStatus(''); setLocationId(''); setPage(0) }
  const toggleSort = (key: string) => { if (sortBy === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); else { setSortBy(key); setSortDir('asc') } }
  const toggleSelect = (id: string) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n) }
  const toggleSelectAll = () => { if (selectedIds.size === items.length && items.length > 0) setSelectedIds(new Set()); else setSelectedIds(new Set(items.map((i: any) => i.id))) }

  const fmtCur = (n: number) => formatCurrency(n, locale)
  const fmtDate = (d: string | null) => formatShortDate(d, locale)
  const getName = (ts: any[]) => getProductName(ts, locale)

  const handleExport = async () => {
    const params = new URLSearchParams()
    if (warehouseId) params.set('warehouseId', warehouseId)
    if (categoryId) params.set('categoryId', categoryId)
    if (status) params.set('status', status)
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/admin/inventory/export?${params}`, {
      headers: { Authorization: `Bearer ${(await import('@/store/auth-store')).useAuthStore.getState().accessToken}` },
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'bestand.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const statCards = [
    { key: 'total', label: t('inventory.totalStock'), value: `${stats?.totalUnits ?? 0}`, sub: `${stats?.totalItems ?? 0} ${t('inventory.variant')}`, icon: Package, color: 'bg-blue-50 text-blue-600' },
    { key: 'low', label: t('inventory.lowStock'), value: String(stats?.lowStock ?? 0), icon: AlertTriangle, color: 'bg-orange-50 text-orange-600', click: () => { setStatus('low'); setPage(0) }, alert: (stats?.lowStock ?? 0) > 0 },
    { key: 'out', label: t('inventory.outOfStock'), value: String(stats?.outOfStock ?? 0), icon: XCircle, color: 'bg-red-50 text-red-600', click: () => { setStatus('out_of_stock'); setPage(0) }, alert: (stats?.outOfStock ?? 0) > 0 },
    { key: 'value', label: t('inventory.warehouseValue'), value: fmtCur(stats?.warehouseValue ?? 0), icon: TrendingUp, color: 'bg-green-50 text-green-600' },
  ]

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('inventory.title') }]} />
      <h1 className="text-2xl font-bold tracking-tight mb-6">{t('inventory.title')}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((c, i) => (
          <div key={c.key} onClick={c.click} className={`group bg-background border rounded-2xl p-5 hover:shadow-lg transition-all duration-300 ${c.click ? 'cursor-pointer' : ''} ${c.alert ? `border-${c.key === 'low' ? 'orange' : 'red'}-200` : 'hover:border-primary/20'}`}
            style={{ animationDelay: `${i * 60}ms`, animation: 'fadeSlideUp 400ms ease-out both' }}>
            <div className="flex items-center gap-3">
              <div className={`h-11 w-11 rounded-xl ${c.color} flex items-center justify-center transition-transform group-hover:scale-110`}><c.icon className="h-5 w-5" /></div>
              <div><div className="text-xl font-bold">{c.value}</div><div className="text-[11px] text-muted-foreground">{c.label}</div>{c.sub && <div className="text-[10px] text-muted-foreground">{c.sub}</div>}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button size="sm" className="rounded-xl gap-2 bg-green-600 hover:bg-green-700" onClick={() => { setScannerMode('intake'); setShowScannerOverlay(true); setScanLog([]); setScannedProduct(null); setScanInput('') }}>
          <PackagePlus className="h-4 w-4" />{t('inventory.intake')}
        </Button>
        <Button size="sm" variant="outline" className="rounded-xl gap-2 border-red-200 text-red-600 hover:bg-red-50" onClick={() => { setScannerMode('output'); setShowScannerOverlay(true); setScanLog([]); setScannedProduct(null); setScanInput('') }}>
          <PackageMinus className="h-4 w-4" />{t('inventory.output')}
        </Button>
        <Link href={`/${locale}/admin/inventory/stocktake`}><Button size="sm" variant="outline" className="rounded-xl gap-2"><ClipboardList className="h-4 w-4" />{t('inventory.stocktake')}</Button></Link>
        <Link href={`/${locale}/admin/inventory/movements`}><Button size="sm" variant="outline" className="rounded-xl gap-2"><ArrowRightLeft className="h-4 w-4" />{locale === 'ar' ? 'سجل الحركات' : 'Bewegungslog'}</Button></Link>
        <Button size="sm" variant="outline" className="rounded-xl gap-2 hidden lg:inline-flex" onClick={() => { setShowScannerOverlay(true); setScannerMode('intake'); setScanLog([]); setScannedProduct(null); setScanInput('') }}>
          <ScanBarcode className="h-4 w-4" />{t('inventory.scanner')}
        </Button>
        <Button size="sm" variant="outline" className="rounded-xl gap-2 lg:hidden" onClick={() => setCameraBatchOpen(true)}>
          <Camera className="h-4 w-4" />{locale === 'ar' ? 'ماسح الكاميرا' : 'Kamera-Scanner'}
        </Button>
        <Button size="sm" variant="outline" className="rounded-xl gap-2" onClick={handleExport}><Download className="h-4 w-4" />{t('inventory.export')}</Button>
      </div>

      {/* Category Chips */}
      {departments && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => { setCategoryId(''); setPage(0) }} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${!categoryId ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
            {t('inventory.allCategories')}
          </button>
          {(departments as any[]).map((d: any) => {
            const name = getName(d.translations)
            const active = categoryId === d.id
            return (
              <button key={d.id} onClick={() => { setCategoryId(active ? '' : d.id); setPage(0) }}
                className={`px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2 ${active ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
                {name}
                <span className="text-[10px] opacity-60">{d.total}</span>
                {(d.critical > 0 || d.low > 0) && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('inventory.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} className="pl-10 rtl:pl-3 rtl:pr-10 h-10 rounded-xl" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${status ? 'border-primary/50 text-primary bg-primary/5' : ''}`}>
          <option value="">{t('inventory.statusAll')}</option>
          <option value="in_stock">{t('inventory.statusInStock')}</option>
          <option value="low">{t('inventory.statusLow')}</option>
          <option value="out_of_stock">{t('inventory.statusOutOfStock')}</option>
        </select>
        <div className="flex items-center gap-1">
          <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${warehouseId ? 'border-primary/50 text-primary bg-primary/5' : ''}`}>
            <option value="">{t('inventory.allWarehouses')}</option>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.type === 'STORE' ? (locale === 'ar' ? 'متجر' : 'Geschäft') : (locale === 'ar' ? 'مستودع' : 'Lager')})</option>)}
          </select>
          <button onClick={() => setShowAddWarehouse(true)} className="h-9 w-9 rounded-xl border flex items-center justify-center hover:bg-muted transition-colors" title={locale === 'ar' ? 'إضافة موقع جديد' : 'Neuen Standort hinzufügen'}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {(locations as any[])?.length > 0 && (
          <select value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${locationId ? 'border-primary/50 text-primary' : ''}`}>
            <option value="">{t('inventory.allLocations')}</option>
            {(locations as any[]).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {hasFilters && <button onClick={resetFilters} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"><RotateCcw className="h-3 w-3" />{t('inventory.filterReset')}</button>}
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-xl p-0.5 ml-auto">
          <button onClick={() => setViewMode('grouped')} className={`p-2 rounded-lg transition-all ${viewMode === 'grouped' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title={t('products.gridView')}><Layers className="h-4 w-4" /></button>
          <button onClick={() => setViewMode('flat')} className={`p-2 rounded-lg transition-all ${viewMode === 'flat' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} title={t('products.listView')}><LayoutList className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Sort + Bulk */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground"><ArrowUpDown className="h-3.5 w-3.5 inline" /></span>
          {['stock', 'sku'].map((s) => (
            <button key={s} onClick={() => toggleSort(s)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sortBy === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {s === 'stock' ? t('inventory.stock') : 'SKU'}
              {sortBy === s && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === 'desc' ? '' : 'rotate-180'}`} />}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-primary">{selectedIds.size} {t('inventory.selected')}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg gap-1" onClick={handleExport}><Download className="h-3 w-3" />{t('inventory.bulkExport')}</Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {viewMode === 'flat' && <th className="px-3 py-3 w-8"><button onClick={toggleSelectAll} className={`h-4 w-4 rounded border-2 flex items-center justify-center ${selectedIds.size === items.length && items.length > 0 ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>{selectedIds.size === items.length && items.length > 0 && <Check className="h-3 w-3 text-white" />}</button></th>}
                {viewMode === 'grouped' && <th className="px-2 py-3 w-8"></th>}
                <th className="text-start px-3 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('inventory.product')}</th>
                <th className="text-start px-3 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">SKU</th>
                <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('inventory.stock')}</th>
                <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('inventory.minimum')}</th>
                <th className="text-start px-3 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('inventory.warehouse')}</th>
                <th className="px-3 py-3 w-20 text-center">{viewMode === 'grouped' ? '' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b"><td colSpan={11} className="px-3 py-4"><div className="h-4 bg-muted rounded-lg animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} /></td></tr>
              )) : items.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-16 text-center"><Package className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-muted-foreground">{t('inventory.noEntries')}</p></td></tr>
              ) : viewMode === 'grouped' ? (
                /* ── GROUPED VIEW ── */
                items.map((product: any, i: number) => {
                  const isOut = product.status === 'out_of_stock'
                  const isLow = product.status === 'low'
                  const isExpanded = expandedProductId === product.productId
                  // Sort variants by color then size
                  const sortedVariants = [...(product.variants ?? [])].sort((a: any, b: any) => {
                    if (a.color !== b.color) return (a.color ?? '').localeCompare(b.color ?? '')
                    return (a.size ?? '').localeCompare(b.size ?? '', undefined, { numeric: true })
                  })
                  return (<Fragment key={product.productId}>
                    <tr className={`border-b transition-colors group cursor-pointer ${isOut ? 'bg-red-50/50' : isLow ? 'bg-orange-50/30' : 'hover:bg-muted/20'}`}
                      onClick={() => setExpandedProductId(isExpanded ? null : product.productId)}
                      style={{ animationDelay: `${i * 12}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                      <td className="px-3 py-3"><ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          {product.image ? <img src={product.image} alt="" className="h-20 w-20 rounded-xl object-cover flex-shrink-0" /> : <div className="h-20 w-20 rounded-xl bg-muted flex items-center justify-center flex-shrink-0"><Package className="h-6 w-6 text-muted-foreground/30" /></div>}
                          <div>
                            <div className="font-semibold text-[13px] line-clamp-1">{getName(product.translations)}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase ${STATUS_BADGE[product.status]}`}>{t(`inventory.status${product.status === 'in_stock' ? 'InStock' : product.status === 'low' ? 'Low' : 'OutOfStock'}`)}</span>
                              <div className="flex -space-x-0.5">{product.variants.slice(0, 5).map((v: any, j: number) => v.colorHex ? <div key={j} className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: v.colorHex }} /> : null)}</div>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{product.variantsCount} {t('inventory.variant')}</td>
                      <td className="px-3 py-3 text-center"><span className={`font-bold text-sm ${isOut ? 'text-red-600' : isLow ? 'text-orange-600' : ''}`}>{product.totalStock}</span></td>
                      <td className="px-3 py-3 text-center text-xs">
                        {product.lowCount > 0 && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-[10px] font-medium">{product.lowCount} {locale === 'ar' ? 'منخفض' : 'niedrig'}</span>}
                        {product.outCount > 0 && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium ltr:ml-1 rtl:mr-1">{product.outCount} {locale === 'ar' ? 'نفد' : 'leer'}</span>}
                      </td>
                      <td className="px-3 py-3"></td>
                      <td className="px-3 py-3"></td>
                    </tr>
                    {/* Expanded: one row per variant PER warehouse */}
                    {isExpanded && sortedVariants
                      .filter((v: any) => !warehouseId || v.inventory?.length > 0)
                      .flatMap((v: any) => {
                        const invList = v.inventory?.length > 0 ? v.inventory : [null]
                        return invList.map((inv: any, invIdx: number) => {
                          const stock = inv ? inv.quantityOnHand - (inv.quantityReserved ?? 0) : 0
                          return (
                            <tr key={`${v.id}-${inv?.id ?? invIdx}`} className={`border-b border-border/40 hover:bg-muted/30 transition-colors group ${stock <= 0 ? 'bg-red-50/20' : stock <= (inv?.reorderPoint ?? 5) ? 'bg-orange-50/10' : 'bg-muted/5'}`} style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                              <td className="py-2.5 ltr:border-l-2 rtl:border-r-2 border-primary/20"></td>
                              <td className="px-3 py-2.5 ltr:pl-10 rtl:pr-10">
                                <div className="flex items-center gap-2.5">
                                  {v.colorHex && <div className="h-4 w-4 rounded-full border shadow-sm flex-shrink-0" style={{ backgroundColor: v.colorHex }} />}
                                  <span className="text-[13px] font-medium">{translateColor(v.color, locale)} / {v.size}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">{v.sku}</td>
                              <td className="px-3 py-2.5 text-center">
                                <div className="inline-flex items-center gap-1">
                                  {inv && <button onClick={(e) => { e.stopPropagation(); quickAdjustMut.mutate({ id: inv.id, delta: -1 }) }} className="h-6 w-6 rounded bg-muted hover:bg-red-100 flex items-center justify-center transition-colors"><Minus className="h-3 w-3" /></button>}
                                  <span className={`font-bold text-sm min-w-[28px] text-center ${stock <= 0 ? 'text-red-600' : stock <= (inv?.reorderPoint ?? 5) ? 'text-orange-600' : 'text-green-600'}`}>{stock}</span>
                                  {inv && <button onClick={(e) => { e.stopPropagation(); quickAdjustMut.mutate({ id: inv.id, delta: 1 }) }} className="h-6 w-6 rounded bg-muted hover:bg-green-100 flex items-center justify-center transition-colors"><Plus className="h-3 w-3" /></button>}
                                  {!inv && <span className="text-xs text-red-400">0</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{inv?.reorderPoint ?? '—'}</td>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground">{inv?.warehouse?.name ?? '—'}</td>
                              <td className="px-3 py-2.5 text-center">
                                <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {inv && stock > 0 && (
                                    <button onClick={(e) => { e.stopPropagation(); setTransferItem({ inventoryId: inv.id, sku: v.sku, color: v.color, size: v.size, stock }); setTransferQty(1); setTransferTarget('') }}
                                      className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition-colors" title={locale === 'ar' ? 'نقل' : 'Transfer'}>
                                      <ArrowRightLeft className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <PrintLabelButton variant={{ sku: v.sku, barcode: v.barcode, color: v.color, size: v.size, price: v.price ?? 0, stock, location: inv?.location?.name }} productName={getName(product.translations)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" />
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      })}
                    {/* Add color/size buttons */}
                    {isExpanded && (
                      <tr key={`${product.productId}-actions`} className="border-b border-border/40">
                        <td className="ltr:border-l-2 rtl:border-r-2 border-primary/20"></td>
                        <td colSpan={10} className="px-3 py-2.5 ltr:pl-10 rtl:pr-10">
                          <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setAddColorProduct(product.productId) }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-[#d4a853] hover:bg-[#d4a853]/10 transition-colors">
                              <Plus className="h-3 w-3" />{t('inventory.addNewColor')}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setAddSizeProduct(product.productId) }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors">
                              <Plus className="h-3 w-3" />{t('inventory.addNewSize')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>)
                })
              ) : (
                /* ── FLAT VIEW ── */
                items.map((inv: any, i: number) => {
                  const isOut = inv.status === 'out_of_stock'
                  const isLow = inv.status === 'low'
                  return (
                    <tr key={inv.id} className={`border-b transition-colors group ${isOut ? 'bg-red-50/50' : isLow ? 'bg-orange-50/30' : 'hover:bg-muted/20'}`}
                      style={{ animationDelay: `${i * 12}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                      <td className="px-3 py-3"><button onClick={() => toggleSelect(inv.id)} className={`h-4 w-4 rounded border-2 flex items-center justify-center ${selectedIds.has(inv.id) ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>{selectedIds.has(inv.id) && <Check className="h-3 w-3 text-white" />}</button></td>
                      <td className="px-3 py-3">{inv.image ? <img src={inv.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground/30" /></div>}</td>
                      <td className="px-3 py-3"><div className="font-semibold text-[13px] line-clamp-1 max-w-[200px]">{getName(inv.productName)}</div><span className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase ${STATUS_BADGE[inv.status]}`}>{t(`inventory.status${inv.status === 'in_stock' ? 'InStock' : inv.status === 'low' ? 'Low' : 'OutOfStock'}`)}</span></td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{inv.sku}</td>
                      <td className="px-3 py-3"><div className="flex items-center gap-1.5">{inv.colorHex && <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: inv.colorHex }} />}<span className="text-xs text-muted-foreground">{translateColor(inv.color, locale)}/{inv.size}</span></div></td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => quickAdjustMut.mutate({ id: inv.id, delta: -1 })} className="h-6 w-6 rounded-md bg-muted hover:bg-red-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><Minus className="h-3 w-3" /></button>
                          <button onClick={() => { setAdjustItem(inv); setAdjustQty(inv.quantityOnHand); setAdjustReason(''); setShowAdjustModal(true) }}
                            className={`font-bold text-sm min-w-[32px] px-1 py-0.5 rounded-md hover:bg-muted transition-colors ${isOut ? 'text-red-600' : isLow ? 'text-orange-600' : ''}`}>{inv.available}</button>
                          <button onClick={() => quickAdjustMut.mutate({ id: inv.id, delta: 1 })} className="h-6 w-6 rounded-md bg-muted hover:bg-green-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><Plus className="h-3 w-3" /></button>
                        </div>
                        <div className="h-1 w-16 mx-auto mt-1 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${isOut ? 'bg-red-500' : isLow ? 'bg-orange-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(100, (inv.available / (inv.maxStock || 100)) * 100)}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-muted-foreground">{inv.reorderPoint}</td>
                      <td className="px-3 py-3 text-end text-[13px] font-medium">{fmtCur(inv.salePrice)}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{inv.location?.name ?? '—'}</td>
                      <td className="px-3 py-3 text-center text-[11px] text-muted-foreground">{fmtDate(inv.lastMovement)}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => { setHistoryItem(inv); setShowHistoryModal(true) }} className="p-1.5 rounded-lg hover:bg-muted opacity-0 group-hover:opacity-100 transition-all"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {totalCount} {t('inventory.variant')}
              <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0) }} className="ml-2 px-2 py-1 rounded-lg border bg-background text-xs">
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} {t('inventory.perPage')}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
              <span className="text-xs font-medium px-3">{page + 1} / {totalPages || 1}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
            </div>
          </div>
        )}
      </div>

      {/* ── Adjust Modal ── */}
      {showAdjustModal && adjustItem && (
        <Modal onClose={() => setShowAdjustModal(false)}>
          <h3 className="text-lg font-bold mb-1">{t('inventory.adjust')}</h3>
          <p className="text-sm text-muted-foreground mb-4">{getName(adjustItem.productName)} — {adjustItem.sku}</p>
          <div className="space-y-3">
            <div><label className="text-xs font-medium mb-1 block">{t('inventory.current')}: <span className="font-bold">{adjustItem.quantityOnHand}</span></label>
              <Input type="number" value={adjustQty} onChange={(e) => setAdjustQty(+e.target.value)} className="rounded-xl" /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('inventory.reason')}</label>
              <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-background text-sm">
                <option value="">{t('inventory.reason')}...</option>
                <option value="delivery">{t('inventory.reasonDelivery')}</option>
                <option value="return">{t('inventory.reasonReturn')}</option>
                <option value="correction">{t('inventory.reasonCorrection')}</option>
                <option value="damaged">{t('inventory.reasonDamaged')}</option>
                <option value="loss">{t('inventory.reasonLoss')}</option>
              </select></div>
            <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowAdjustModal(false)}>{t('inventory.cancel')}</Button>
              <Button className="flex-1 rounded-xl" disabled={adjustMut.isPending} onClick={() => adjustMut.mutate()}>{t('inventory.save')}</Button></div>
          </div>
        </Modal>
      )}

      {/* ── History Modal ── */}
      {showHistoryModal && historyItem && (
        <Modal onClose={() => { setShowHistoryModal(false); setHistoryItem(null) }} wide>
          <h3 className="text-lg font-bold mb-1">{t('inventory.historyTitle')}</h3>
          <p className="text-sm text-muted-foreground mb-4">{getName(historyItem.productName)} — {historyItem.sku}</p>
          <div className="max-h-[400px] overflow-y-auto">
            {!historyData || historyData.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">{t('inventory.noHistory')}</p> :
              <table className="w-full text-sm"><thead><tr className="border-b bg-muted/30">
                <th className="text-start px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.date')}</th>
                <th className="text-start px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.movementType')}</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.qty')}</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.before')}</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.after')}</th>
                <th className="text-start px-3 py-2 text-xs font-semibold text-muted-foreground">{t('inventory.notes')}</th>
              </tr></thead><tbody>
                {(historyData as any[]).map((m: any) => (
                  <tr key={m.id} className="border-b"><td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(m.createdAt)}</td>
                    <td className="px-3 py-2 text-xs">{translateMovement(m.type, locale)}</td>
                    <td className={`px-3 py-2 text-xs text-center font-bold ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                    <td className="px-3 py-2 text-xs text-center text-muted-foreground">{m.quantityBefore ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-center text-muted-foreground">{m.quantityAfter ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{m.notes ?? '—'}</td>
                  </tr>))}
              </tbody></table>}
          </div>
        </Modal>
      )}

      {/* ── Barcode Scanner Overlay ── */}
      {showScannerOverlay && (
        <div className="fixed inset-0 z-50 bg-[#0a0a1a] flex flex-col" style={{ animation: 'fadeIn 200ms ease-out' }}>
          {/* ── Header ── */}
          <div className="px-5 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <ScanBarcode className="h-5 w-5 text-[#d4a853]" />
              <h2 className="text-white font-bold text-sm">{t('inventory.scannerTitle')}</h2>
            </div>
            <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
              <button onClick={() => setScannerMode('intake')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${scannerMode === 'intake' ? 'bg-green-600 text-white shadow' : 'text-white/50 hover:text-white/80'}`}>{t('inventory.scannerIntake')}</button>
              <button onClick={() => setScannerMode('output')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${scannerMode === 'output' ? 'bg-red-600 text-white shadow' : 'text-white/50 hover:text-white/80'}`}>{t('inventory.scannerOutput')}</button>
              <button onClick={() => { setScannerMode('csv'); setCsvData([]); setCsvResult(null) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${scannerMode === 'csv' ? 'bg-blue-600 text-white shadow' : 'text-white/50 hover:text-white/80'}`}>{t('inventory.intakeCsv')}</button>
            </div>
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl">
              <span className="text-white/40 text-xs">{locale === 'ar' ? 'الموقع:' : 'Standort:'}</span>
              <select value={warehouseId || ''} onChange={(e) => setWarehouseId(e.target.value)}
                className="bg-transparent text-white text-xs font-medium focus:outline-none cursor-pointer">
                {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id} className="text-black">{w.name}</option>)}
              </select>
            </div>
            <div className="ltr:ml-auto rtl:mr-auto">
              <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white border border-white/20 hover:bg-white/10 active:scale-95 transition-all" onClick={async () => {
                if (scanLog.length > 0) {
                  const ok = await confirmDialog({
                    title: locale === 'ar' ? 'إغلاق الماسح' : 'Scanner schließen',
                    description: locale === 'ar' ? `لديك ${scanLog.length} منتج لم يتم حجزه. هل تريد الإغلاق؟` : `${scanLog.length} Artikel noch nicht gebucht. Trotzdem schließen?`,
                    variant: 'danger',
                    confirmLabel: locale === 'ar' ? 'إغلاق' : 'Schließen',
                    cancelLabel: locale === 'ar' ? 'متابعة' : 'Weiter scannen',
                  })
                  if (!ok) return
                }
                setShowScannerOverlay(false)
              }}>
                <X className="h-4 w-4" />{locale === 'ar' ? 'إغلاق' : 'Schließen'}
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 flex min-h-0">
            {scannerMode === 'csv' ? (
              /* ── CSV Import Mode ── */
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h3 className="text-white font-bold mb-4">{t('inventory.intakeCsv')}</h3>
                  <p className="text-white/40 text-sm mb-4">CSV: SKU, {t('inventory.qty')} (1 {t('inventory.perPage')})</p>
                  <label className="block mb-4 cursor-pointer">
                    <div className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center hover:border-[#d4a853]/50 transition-colors">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-white/30" />
                      <p className="text-white/50 text-sm">{t('inventory.import')} CSV</p>
                    </div>
                    <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = (ev) => {
                        const text = ev.target?.result as string
                        const lines = text.trim().split('\n').slice(1)
                        const parsed = lines.map((line) => {
                          const [sku, qty] = line.split(/[;,]/).map((s) => s.trim())
                          return { sku, quantity: parseInt(qty) || 0 }
                        }).filter((r) => r.sku && r.quantity > 0)
                        setCsvData(parsed)
                        setCsvResult(null)
                      }
                      reader.readAsText(file)
                    }} />
                  </label>
                  {csvData.length > 0 && !csvResult && (
                    <div>
                      <div className="max-h-60 overflow-y-auto mb-4 rounded-xl border border-white/10">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-white/10"><th className="text-start px-3 py-2 text-white/50 text-xs">SKU</th><th className="text-center px-3 py-2 text-white/50 text-xs">{t('inventory.qty')}</th></tr></thead>
                          <tbody>{csvData.map((row, i) => (
                            <tr key={i} className="border-b border-white/5"><td className="px-3 py-2 text-white/80 font-mono text-xs">{row.sku}</td><td className="px-3 py-2 text-center text-white font-bold">+{row.quantity}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-white/50 text-sm">{csvData.length} {t('inventory.variant')}</span>
                        <button onClick={async () => {
                          setCsvProcessing(true)
                          try {
                            const { data } = await api.post('/admin/inventory/intake-csv', { items: csvData, reason: 'CSV Import' })
                            setCsvResult(data)
                            qc.invalidateQueries({ queryKey: ['admin-inventory'] })
                            qc.invalidateQueries({ queryKey: ['inventory-stats'] })
                          } catch { setCsvResult({ error: true }) }
                          setCsvProcessing(false)
                        }} disabled={csvProcessing}
                          className="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold transition-colors disabled:opacity-50">
                          {csvProcessing ? t('inventory.scannerScanning') : t('inventory.intakeBook')}
                        </button>
                      </div>
                    </div>
                  )}
                  {csvResult && !csvResult.error && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
                      <div className="text-green-400 font-bold mb-2">{t('inventory.intakeBooked')}</div>
                      <div className="text-white/60 text-sm">{csvResult.processed} {t('inventory.variant')} {t('inventory.intakeBooked')}</div>
                      {csvResult.errors?.length > 0 && (
                        <div className="mt-2 text-red-400 text-xs">{csvResult.errors.length} {t('inventory.scannerNotFound')}: {csvResult.errors.map((e: any) => e.sku).join(', ')}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
            <>
            {/* ── Left Panel: Scan Input ── */}
            <div className="flex-1 flex flex-col p-5 min-w-0">
              {/* Search bar — always at the top */}
              <div className="relative mb-4">
                <ScanBarcode className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#d4a853]" />
                <input ref={scanRef} value={scanInput} onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBatchScan(scanInput) } }}
                  placeholder={t('inventory.scannerReady')} autoFocus
                  className="w-full h-14 ltr:pl-12 rtl:pr-12 ltr:pr-4 rtl:pl-4 rounded-2xl bg-white/10 border border-white/20 text-white text-lg font-mono placeholder:text-white/30 focus:outline-none focus:border-[#d4a853] focus:ring-2 focus:ring-[#d4a853]/20 transition-all" />
              </div>

              {/* Flash feedback */}
              {scanFlash && (
                <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-bold text-center ${
                  scanFlash.type === 'new' ? 'bg-green-500/20 text-green-300 border border-green-500/20' :
                  scanFlash.type === 'duplicate' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/20' :
                  'bg-red-500/20 text-red-300 border border-red-500/20'
                }`} style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                  {scanFlash.text}
                </div>
              )}

              {/* Last scanned product */}
              {scannedProduct && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                  <div className="flex items-center gap-3">
                    {scannedProduct.image ? <img src={scannedProduct.image} alt="" className="h-16 w-16 rounded-xl object-cover" />
                      : <div className="h-16 w-16 rounded-xl bg-white/10 flex items-center justify-center"><Package className="h-6 w-6 text-white/20" /></div>}
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold truncate">{getName(scannedProduct.productName)}</div>
                      <div className="text-white/50 text-xs font-mono mt-0.5">{scannedProduct.sku}</div>
                      <div className="text-white/40 text-xs mt-0.5">{translateColor(scannedProduct.color, locale)} / {scannedProduct.size}</div>
                    </div>
                    <div className="text-end ltr:pl-3 rtl:pr-3 ltr:border-l rtl:border-r border-white/10">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">{t('inventory.current')}</span>
                      <div className={`text-2xl font-bold ${(scannedProduct.inventory?.[0]?.available ?? 0) <= 0 ? 'text-red-400' : (scannedProduct.inventory?.[0]?.available ?? 0) <= 5 ? 'text-orange-400' : 'text-white'}`}>
                        {scannedProduct.inventory?.[0]?.available ?? 0}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!scannedProduct && scanLog.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="relative h-24 w-24 mx-auto mb-5">
                      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-white/10" style={{ animation: 'pulse 3s ease-in-out infinite' }} />
                      <div className="absolute inset-3 rounded-xl bg-white/5 flex items-center justify-center">
                        <ScanBarcode className="h-8 w-8 text-[#d4a853]/40" />
                      </div>
                    </div>
                    <p className="text-white/50 text-sm font-medium">{t('inventory.scannerReady')}</p>
                    <p className="text-white/25 text-xs mt-2 max-w-[280px] mx-auto leading-relaxed">
                      {locale === 'ar' ? 'امسح الباركود أو أدخله يدويًا\nستُجمع المنتجات تلقائيًا في القائمة' : 'Barcode scannen oder manuell eingeben\nArtikel werden automatisch gesammelt'}
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-6">
                      <div className="flex items-center gap-1.5 text-white/15 text-[10px]"><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/30 font-mono">Enter</kbd> {locale === 'ar' ? 'للمسح' : 'Scannen'}</div>
                      <div className="flex items-center gap-1.5 text-white/15 text-[10px]"><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/30 font-mono">Esc</kbd> {locale === 'ar' ? 'للإغلاق' : 'Schließen'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Scan stats when items exist but no current scan */}
              {!scannedProduct && scanLog.length > 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="h-20 w-20 mx-auto mb-4 rounded-2xl bg-[#d4a853]/10 flex items-center justify-center">
                      <ScanBarcode className="h-8 w-8 text-[#d4a853]" />
                    </div>
                    <p className="text-white/50 text-sm">{locale === 'ar' ? 'جاهز للمسح التالي' : 'Bereit für den nächsten Scan'}</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Panel: Grouped batch list ── */}
            <div className="w-[380px] flex-shrink-0 border-s border-white/10 bg-white/[0.02] flex flex-col min-h-0">
                {scanLog.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-6">
                    <div className="text-center">
                      <div className="h-12 w-12 mx-auto mb-3 rounded-xl bg-white/5 flex items-center justify-center">
                        <ClipboardList className="h-5 w-5 text-white/15" />
                      </div>
                      <p className="text-white/25 text-xs">{locale === 'ar' ? 'ستظهر المنتجات الممسوحة هنا' : 'Gescannte Artikel erscheinen hier'}</p>
                    </div>
                  </div>
                ) : (() => {
                  // Group scanLog items by product name
                  const groups: { name: string; image: string | null; items: typeof scanLog }[] = []
                  for (const item of scanLog) {
                    const pName = getName(item.productName)
                    let group = groups.find((g) => g.name === pName)
                    if (!group) {
                      group = { name: pName, image: item.image, items: [] }
                      groups.push(group)
                    }
                    group.items.push(item)
                  }
                  const totalUnits = scanLog.reduce((s, i) => s + i.qty, 0)
                  const totalValue = scanLog.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0)
                  const uniqueProducts = groups.length
                  const allExpanded = groups.every((g) => expandedGroup === g.name)

                  return (
                    <div className="flex-1 flex flex-col min-h-0">
                      {/* Header */}
                      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
                        <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wider">
                          {t('inventory.scannerSummary')}
                        </h3>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setExpandedGroup(allExpanded ? null : '__all__')}
                            className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors" title={locale === 'ar' ? 'طي/توسيع الكل' : 'Alle ein-/ausklappen'}>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          <span className="px-2 py-0.5 rounded-full bg-[#d4a853]/20 text-[#d4a853] text-xs font-bold">
                            {uniqueProducts} {locale === 'ar' ? 'منتج' : 'Prod.'} · {totalUnits} {locale === 'ar' ? 'قطعة' : 'Stk.'}
                          </span>
                        </div>
                      </div>

                      {/* Grouped list */}
                      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                        {groups.map((group) => {
                          const groupTotal = group.items.reduce((s, i) => s + i.qty, 0)
                          const groupValue = group.items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0)
                          const isExpanded = expandedGroup === group.name || expandedGroup === '__all__'
                          const variantCount = group.items.length

                          return (
                            <div key={group.name}>
                              {/* Group header — clickable */}
                              <button
                                onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors text-start"
                              >
                                {group.image
                                  ? <img src={group.image} alt="" className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
                                  : <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0"><Package className="h-4 w-4 text-white/20" /></div>}
                                <div className="flex-1 min-w-0">
                                  <div className="text-white text-xs font-bold truncate">{group.name}</div>
                                  <div className="text-white/30 text-[10px]">
                                    {variantCount} {locale === 'ar' ? 'متغير' : variantCount === 1 ? 'Variante' : 'Varianten'}
                                    {' · '}{group.items.map((i) => translateColor(i.color, locale) + '/' + i.size).join(', ')}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {canSeePrices && <span className="text-[#d4a853] text-[10px] font-mono">€{groupValue.toFixed(2)}</span>}
                                  <span className="px-2 py-0.5 rounded-lg bg-white/10 text-white text-xs font-bold">×{groupTotal}</span>
                                  <ChevronDown className={`h-3.5 w-3.5 text-white/30 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </button>

                              {/* Expanded variants */}
                              {isExpanded && (
                                <div className="bg-white/[0.02] border-t border-white/5">
                                  {group.items.map((item) => {
                                    const idx = scanLog.indexOf(item)
                                    return (
                                      <div key={item.variantId || idx} className="flex items-center gap-2 px-4 ltr:pl-14 rtl:pr-14 py-1.5 hover:bg-white/5 transition-colors">
                                        <div className="flex-1 min-w-0">
                                          <span className="text-white/60 text-[11px]">{translateColor(item.color, locale)} / {item.size}</span>
                                          {canSeePrices && item.price > 0 && <span className="text-white/25 text-[10px] ltr:ml-2 rtl:mr-2">€{(item.price * item.qty).toFixed(2)}</span>}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <button onClick={() => updateScanLogQty(idx, item.qty - 1)}
                                            className="h-5 w-5 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
                                            <Minus className="h-2.5 w-2.5" />
                                          </button>
                                          <input type="number" value={item.qty}
                                            onChange={(e) => updateScanLogQty(idx, Math.max(1, parseInt(e.target.value) || 1))}
                                            className="h-5 w-9 rounded bg-white/10 border border-white/20 text-white text-center text-[10px] font-bold focus:outline-none focus:border-[#d4a853]" />
                                          <button onClick={() => updateScanLogQty(idx, item.qty + 1)}
                                            className="h-5 w-5 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
                                            <Plus className="h-2.5 w-2.5" />
                                          </button>
                                        </div>
                                        <button onClick={() => removeScanLogItem(idx)}
                                          className="p-0.5 rounded hover:bg-red-500/20 text-white/15 hover:text-red-400">
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Footer: total + book button */}
                      <div className="p-3 border-t border-white/10 space-y-2">
                        {/* Total value — only for authorized users */}
                        {canSeePrices && totalValue > 0 && (
                          <div className="flex items-center justify-between px-2">
                            <span className="text-white/40 text-xs">{locale === 'ar' ? 'القيمة الإجمالية' : 'Gesamtwert'}</span>
                            <span className="text-[#d4a853] font-bold text-sm">€{totalValue.toFixed(2)}</span>
                          </div>
                        )}
                        <button onClick={handleBatchConfirm} disabled={batchBooking}
                          className={`w-full h-11 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${
                            scannerMode === 'intake' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                          } disabled:opacity-50`}>
                          {batchBooking
                            ? <><div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{locale === 'ar' ? 'جاري الحجز...' : 'Wird gebucht...'}</>
                            : <><Check className="h-4 w-4" />{scannerMode === 'intake' ? t('inventory.intakeBook') : t('inventory.scannerRemove')} ({totalUnits} {locale === 'ar' ? 'قطعة' : 'Stück'})</>
                          }
                        </button>
                      </div>
                    </div>
                  )
                })()}
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {/* Camera Batch Scanner (mobile) */}
      {cameraBatchOpen && (
        <CameraBarcodeScannerOverlay
          mode="batch"
          locale={locale}
          warehouseId={warehouseId}
          onBatchConfirm={() => {
            qc.invalidateQueries({ queryKey: ['admin-inventory'] })
            qc.invalidateQueries({ queryKey: ['inventory-stats'] })
            setCameraBatchOpen(false)
          }}
          onClose={() => setCameraBatchOpen(false)}
        />
      )}

      {/* Add Color/Size Modals */}
      {addColorProduct && <AddColorModal productId={addColorProduct} onClose={() => setAddColorProduct(null)} />}
      {addSizeProduct && <AddSizeModal productId={addSizeProduct} onClose={() => setAddSizeProduct(null)} />}

      {/* Transfer Modal */}
      {transferItem && (
        <Modal onClose={() => setTransferItem(null)}>
          <div className="text-center mb-5">
            <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3"><ArrowRightLeft className="h-5 w-5 text-blue-600" /></div>
            <h3 className="text-lg font-bold">{locale === 'ar' ? 'نقل بضاعة' : 'Transfer'}</h3>
            <p className="text-xs text-muted-foreground mt-1">{transferItem.sku} — {translateColor(transferItem.color, locale)} / {transferItem.size}</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{locale === 'ar' ? 'إلى الموقع' : 'Ziel-Standort'}</label>
              <select value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border bg-background text-sm">
                <option value="">{locale === 'ar' ? 'اختر الموقع...' : 'Standort wählen...'}</option>
                {(warehouses as any[])?.map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.type === 'STORE' ? (locale === 'ar' ? 'متجر' : 'Geschäft') : (locale === 'ar' ? 'مستودع' : 'Lager')})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{locale === 'ar' ? 'الكمية' : 'Menge'} ({locale === 'ar' ? 'متاح' : 'verfügbar'}: {transferItem.stock})</label>
              <Input type="number" min={1} max={transferItem.stock} value={transferQty} onChange={(e) => setTransferQty(Math.min(+e.target.value, transferItem.stock))} className="rounded-xl" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setTransferItem(null)}>{t('inventory.cancel')}</Button>
              <Button className="flex-1 rounded-xl gap-2" disabled={!transferTarget || transferQty <= 0 || transferMut.isPending}
                onClick={() => transferMut.mutate({ inventoryId: transferItem.inventoryId, toWarehouseId: transferTarget, quantity: transferQty })}>
                <ArrowRightLeft className="h-4 w-4" />{transferMut.isPending ? '...' : (locale === 'ar' ? 'نقل' : 'Transfer')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Warehouse Management Modal */}
      {showAddWarehouse && (
        <Modal onClose={() => setShowAddWarehouse(false)} wide>
          <h3 className="text-lg font-bold mb-4">{locale === 'ar' ? 'إدارة المواقع' : 'Standorte verwalten'}</h3>

          {/* Warehouse error toast */}
          {warehouseError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium flex items-center gap-2">
              <span>✕</span> {warehouseError}
            </div>
          )}

          {/* Existing warehouses */}
          <div className="space-y-2 mb-6">
            {(warehouses as any[])?.map((w: any) => (
              <WarehouseRow key={w.id} warehouse={w} locale={locale} onUpdate={async (data) => {
                await api.patch(`/admin/warehouses/${w.id}`, data)
                qc.invalidateQueries({ queryKey: ['admin-warehouses'] })
              }} onDelete={async () => {
                const res = await api.delete(`/admin/warehouses/${w.id}`)
                if ((res.data as any)?.deleted) {
                  qc.invalidateQueries({ queryKey: ['admin-warehouses'] })
                } else {
                  setWarehouseError((res.data as any)?.message?.[locale] ?? (res.data as any)?.message?.de ?? 'Fehler')
                  setTimeout(() => setWarehouseError(null), 4000)
                }
              }} />
            ))}
          </div>

          {/* Add new */}
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">{locale === 'ar' ? 'إضافة موقع جديد' : 'Neuen Standort hinzufügen'}</p>
            <div className="flex gap-2">
              <Input value={newWhName} onChange={(e) => setNewWhName(e.target.value)} placeholder={locale === 'ar' ? 'اسم الموقع...' : 'Standort-Name...'} className="rounded-xl text-sm flex-1" />
              <select value={newWhType} onChange={(e) => setNewWhType(e.target.value as any)} className="px-3 py-2 rounded-xl border bg-background text-xs">
                <option value="WAREHOUSE">{locale === 'ar' ? 'مستودع' : 'Lager'}</option>
                <option value="STORE">{locale === 'ar' ? 'متجر' : 'Geschäft'}</option>
              </select>
              <Button size="sm" className="rounded-xl" disabled={!newWhName.trim()} onClick={async () => {
                await api.post('/admin/warehouses', { name: newWhName.trim(), type: newWhType })
                qc.invalidateQueries({ queryKey: ['admin-warehouses'] })
                setNewWhName('')
              }}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
        </Modal>
      )}

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>
    </div>
  )
}

function WarehouseRow({ warehouse, locale, onUpdate, onDelete }: {
  warehouse: any; locale: string
  onUpdate: (data: any) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(warehouse.name)
  const [deleting, setDeleting] = useState(false)

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border hover:border-primary/20 transition-all group">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold ${warehouse.type === 'STORE' ? 'bg-blue-50 text-blue-600' : 'bg-muted text-muted-foreground'}`}>
        {warehouse.type === 'STORE' ? (locale === 'ar' ? 'م' : 'G') : (locale === 'ar' ? 'خ' : 'L')}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            className="w-full px-2 py-1 rounded-lg border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            onBlur={async () => { if (name.trim() && name !== warehouse.name) await onUpdate({ name: name.trim() }); setEditing(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(warehouse.name); setEditing(false) } }}
          />
        ) : (
          <div className="text-sm font-semibold cursor-pointer" onClick={() => setEditing(true)}>{warehouse.name}</div>
        )}
        <div className="text-[10px] text-muted-foreground">
          {warehouse.type === 'STORE' ? (locale === 'ar' ? 'متجر' : 'Geschäft') : (locale === 'ar' ? 'مستودع' : 'Lager')}
          {warehouse.isDefault && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#d4a853]/10 text-[#d4a853] font-semibold">{locale === 'ar' ? 'افتراضي' : 'Standard'}</span>}
        </div>
      </div>
      {!editing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button onClick={() => setEditing(true)} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted">{locale === 'ar' ? 'تعديل' : 'Bearbeiten'}</button>
          {!warehouse.isDefault && (
            <button onClick={async () => { setDeleting(true); await onDelete(); setDeleting(false) }} disabled={deleting}
              className="px-2 py-1 rounded-lg text-xs text-red-500 hover:text-red-700 hover:bg-red-50">{locale === 'ar' ? 'حذف' : 'Löschen'}</button>
          )}
        </div>
      )}
    </div>
  )
}

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'fadeIn 200ms ease-out' }} />
    <div className={`relative bg-background rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}`} style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
      <button onClick={onClose} className="absolute top-4 right-4 rtl:right-auto rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      {children}
    </div>
  </div>)
}
