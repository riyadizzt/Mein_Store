'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Plus, Search, Printer, ArrowRightLeft, Trash2, X, ScanBarcode, Check, Camera, Minus, Lock, Unlock, Warehouse } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useConfirm } from '@/components/ui/confirm-modal'
import { openBoxPrintWindow } from './box-print'
import { BoxCameraScanner } from './box-camera-scanner'

interface BoxManifest {
  id: string
  boxNumber: string
  name: string
  season: string
  year: number
  locationId: string
  warehouseId: string
  status: string
  notes: string | null
  warehouseName?: string
  itemCount?: number
  totalQuantity?: number
  createdAt: string
}

interface BoxItem {
  boxItemId: string
  variantId: string
  sku: string
  barcode: string | null
  name: string
  color: string
  size: string
  quantity: number
  price: number
  imageUrl: string | null
}

export default function MasterBoxesPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all')
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [transferModalOpen, setTransferModalOpen] = useState(false)

  // Load boxes
  const { data: boxes = [] } = useQuery<BoxManifest[]>({
    queryKey: ['master-boxes'],
    queryFn: async () => { const { data } = await api.get('/admin/master-boxes'); return data },
  })

  // Load warehouses
  const { data: warehouses = [] } = useQuery<any[]>({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
  })

  // Load selected box detail
  const { data: detail } = useQuery<BoxManifest & { items: BoxItem[]; totalItems: number; totalQuantity: number; warehouse: { name: string } }>({
    queryKey: ['master-box', selectedBoxId],
    queryFn: async () => { const { data } = await api.get(`/admin/master-boxes/${selectedBoxId}`); return data },
    enabled: !!selectedBoxId,
  })

  // Filtered boxes (warehouse + search)
  const filteredBoxes = boxes.filter((b) => {
    if (warehouseFilter !== 'all' && b.warehouseId !== warehouseFilter) return false
    if (search && !(
      b.boxNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.name.toLowerCase().includes(search.toLowerCase())
    )) return false
    return true
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/master-boxes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master-boxes'] })
      setSelectedBoxId(null)
    },
  })

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: t3('Karton löschen', 'Delete Box', 'حذف الكرتونة'),
      description: t3(
        `Karton "${name}" löschen? Alle Artikel verlieren ihre Karton-Zuordnung (der Bestand bleibt erhalten).`,
        `Delete box "${name}"? All items will lose their box assignment (stock remains).`,
        `حذف الكرتونة "${name}"؟ ستفقد جميع المنتجات تخصيصها للكرتونة (المخزون يبقى).`,
      ),
      variant: 'danger',
      confirmLabel: t3('Löschen', 'Delete', 'حذف'),
      cancelLabel: t3('Abbrechen', 'Cancel', 'إلغاء'),
    })
    if (ok) deleteMut.mutate(id)
  }

  const handlePrint = () => {
    if (!detail) return
    openBoxPrintWindow(detail)
  }

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'packing' | 'sealed' | 'opened' }) =>
      api.patch(`/admin/master-boxes/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master-boxes'] })
      qc.invalidateQueries({ queryKey: ['master-box', selectedBoxId] })
    },
  })

  return (
    <div className="space-y-6">
      <AdminBreadcrumb items={[{ label: t3('Master-Kartons', 'Master Boxes', 'الكراتين الرئيسية') }]} />

      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center">
          <Package className="h-5 w-5 text-[#d4a853]" />
        </div>
        <h1 className="text-2xl font-bold">{t3('Master-Kartons', 'Master Boxes', 'الكراتين الرئيسية')}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT: List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t3('Karton suchen...', 'Search box...', 'ابحث عن كرتونة...')} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
            </div>
            <Button onClick={() => setCreateModalOpen(true)} className="gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white">
              <Plus className="h-4 w-4" />
              {t3('Neu', 'New', 'جديد')}
            </Button>
          </div>

          {/* Warehouse filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setWarehouseFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                warehouseFilter === 'all'
                  ? 'bg-[#d4a853] text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Warehouse className="h-3 w-3" />
              {t3('Alle Lager', 'All warehouses', 'كل المستودعات')}
              <span className="opacity-70">({boxes.length})</span>
            </button>
            {warehouses.map((w) => {
              const count = boxes.filter((b) => b.warehouseId === w.id).length
              if (count === 0) return null
              return (
                <button
                  key={w.id}
                  onClick={() => setWarehouseFilter(w.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    warehouseFilter === w.id
                      ? 'bg-[#d4a853] text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {w.name} <span className="opacity-70">({count})</span>
                </button>
              )
            })}
          </div>

          <div className="bg-background border rounded-2xl divide-y max-h-[600px] overflow-y-auto">
            {filteredBoxes.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {t3('Keine Kartons vorhanden', 'No boxes yet', 'لا توجد كراتين')}
              </div>
            ) : (
              filteredBoxes.map((box) => (
                <button
                  key={box.id}
                  onClick={() => setSelectedBoxId(box.id)}
                  className={`w-full text-start p-4 hover:bg-muted/30 transition-colors ${selectedBoxId === box.id ? 'bg-[#d4a853]/5 border-s-2 border-[#d4a853]' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold font-mono text-[#d4a853]">{box.boxNumber}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          box.status === 'packing' ? 'bg-yellow-100 text-yellow-700' :
                          box.status === 'sealed' ? 'bg-green-100 text-green-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {box.status === 'packing' ? t3('Wird gepackt', 'Packing', 'جاري التعبئة')
                            : box.status === 'sealed' ? t3('Versiegelt', 'Sealed', 'مختومة')
                            : t3('Geöffnet', 'Opened', 'مفتوحة')}
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate">{box.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {box.warehouseName} · {box.itemCount ?? 0} {t3('Varianten', 'variants', 'متغيرات')} · {box.totalQuantity ?? 0} {t3('Stk.', 'pcs', 'قطعة')}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: Detail */}
        <div className="lg:col-span-3">
          {!detail ? (
            <div className="bg-background border rounded-2xl p-12 text-center">
              <Package className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {t3('Wählen Sie einen Karton aus der Liste', 'Select a box from the list', 'اختر كرتونة من القائمة')}
              </p>
            </div>
          ) : (
            <div className="bg-background border rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="px-6 py-5 border-b bg-gradient-to-br from-[#1a1a2e] to-[#1a1a2e]/90 text-white">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-[#d4a853] uppercase tracking-wider">{detail.boxNumber}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        detail.status === 'packing' ? 'bg-yellow-400/20 text-yellow-300' :
                        detail.status === 'sealed' ? 'bg-green-400/20 text-green-300' :
                        'bg-blue-400/20 text-blue-300'
                      }`}>
                        {detail.status === 'packing' ? t3('Wird gepackt', 'Packing', 'جاري التعبئة')
                          : detail.status === 'sealed' ? t3('Versiegelt', 'Sealed', 'مختومة')
                          : t3('Geöffnet', 'Opened', 'مفتوحة')}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold">{detail.name}</h2>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 border border-[#d4a853]/30">
                        <Warehouse className="h-3.5 w-3.5 text-[#d4a853]" />
                        <span className="text-sm font-bold text-white">{detail.warehouse?.name ?? '—'}</span>
                      </div>
                      <span className="text-xs text-white/60">
                        {detail.totalItems} {t3('Varianten', 'variants', 'متغيرات')} · {detail.totalQuantity} {t3('Stück', 'pieces', 'قطعة')}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedBoxId(null)} className="p-1 rounded-lg hover:bg-white/10">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Scanner */}
              <BoxScanner boxId={detail.id} onScanned={() => {
                qc.invalidateQueries({ queryKey: ['master-box', detail.id] })
                qc.invalidateQueries({ queryKey: ['master-boxes'] })
              }} />

              {/* Items */}
              <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto border-t">
                {detail.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{t3('Noch keine Artikel im Karton', 'No items in box yet', 'لا توجد منتجات في الكرتونة بعد')}</p>
                ) : (
                  detail.items.map((item) => (
                    <BoxItemRow
                      key={item.boxItemId}
                      item={item}
                      boxId={detail.id}
                      onChanged={() => qc.invalidateQueries({ queryKey: ['master-box', detail.id] })}
                    />
                  ))
                )}
              </div>

              {/* Actions */}
              <div className="p-4 border-t space-y-3">
                {/* Status row */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider self-center">
                    {t3('Status', 'Status', 'الحالة')}:
                  </span>
                  {detail.status !== 'packing' && (
                    <Button
                      onClick={() => statusMut.mutate({ id: detail.id, status: 'packing' })}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8"
                      disabled={statusMut.isPending}
                    >
                      <Package className="h-3.5 w-3.5" />
                      {t3('Zurück zum Packen', 'Back to packing', 'إعادة إلى التعبئة')}
                    </Button>
                  )}
                  {detail.status !== 'sealed' && (
                    <Button
                      onClick={() => statusMut.mutate({ id: detail.id, status: 'sealed' })}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-green-700 border-green-200 hover:bg-green-50"
                      disabled={statusMut.isPending || detail.items.length === 0}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {t3('Versiegeln', 'Seal', 'ختم')}
                    </Button>
                  )}
                  {detail.status !== 'opened' && (
                    <Button
                      onClick={() => statusMut.mutate({ id: detail.id, status: 'opened' })}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-blue-700 border-blue-200 hover:bg-blue-50"
                      disabled={statusMut.isPending}
                    >
                      <Unlock className="h-3.5 w-3.5" />
                      {t3('Öffnen', 'Open', 'فتح')}
                    </Button>
                  )}
                </div>

                {/* Main actions */}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handlePrint} disabled={detail.items.length === 0} className="gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white">
                    <Printer className="h-4 w-4" />
                    {t3('A4 drucken', 'Print A4', 'طباعة A4')}
                  </Button>
                  <Button onClick={() => setTransferModalOpen(true)} disabled={detail.items.length === 0} variant="outline" className="gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    {t3('Karton transferieren', 'Transfer Box', 'نقل الكرتونة')}
                  </Button>
                  <Button onClick={() => handleDelete(detail.id, detail.name)} variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50 ltr:ml-auto rtl:mr-auto">
                    <Trash2 className="h-4 w-4" />
                    {t3('Löschen', 'Delete', 'حذف')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {createModalOpen && (
        <CreateBoxModal
          warehouses={warehouses}
          onClose={() => setCreateModalOpen(false)}
          onCreated={(id) => { setCreateModalOpen(false); setSelectedBoxId(id); qc.invalidateQueries({ queryKey: ['master-boxes'] }) }}
        />
      )}

      {/* Transfer Modal */}
      {transferModalOpen && detail && (
        <TransferBoxModal
          box={detail}
          warehouses={warehouses}
          onClose={() => setTransferModalOpen(false)}
          onDone={() => { setTransferModalOpen(false); qc.invalidateQueries({ queryKey: ['master-boxes'] }); qc.invalidateQueries({ queryKey: ['master-box', detail.id] }) }}
        />
      )}
    </div>
  )
}

// ─── Box Item Row (editable quantity) ───
function BoxItemRow({ item, boxId, onChanged }: { item: BoxItem; boxId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [tempQty, setTempQty] = useState(String(item.quantity))
  const [busy, setBusy] = useState(false)

  const updateQty = async (newQty: number) => {
    if (newQty < 0 || busy) return
    setBusy(true)
    try {
      if (newQty === 0) {
        await api.delete(`/admin/master-boxes/${boxId}/items/${item.boxItemId}`)
      } else {
        await api.patch(`/admin/master-boxes/${boxId}/items/${item.boxItemId}`, { quantity: newQty })
      }
      onChanged()
      setEditing(false)
    } catch {
      /* ignore */
    }
    setBusy(false)
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.delete(`/admin/master-boxes/${boxId}/items/${item.boxItemId}`)
      onChanged()
    } catch {
      /* ignore */
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
      {item.imageUrl ? (
        <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
      ) : (
        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground" /></div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground">{item.color} / {item.size} · <span className="font-mono">{item.sku}</span></p>
      </div>
      <div className="flex items-center gap-1" dir="ltr">
        <button
          type="button"
          onClick={() => updateQty(item.quantity - 1)}
          disabled={busy}
          className="h-7 w-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        {editing ? (
          <input
            type="number"
            min={0}
            value={tempQty}
            onChange={(e) => setTempQty(e.target.value)}
            onBlur={() => updateQty(parseInt(tempQty) || 0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateQty(parseInt(tempQty) || 0)
              if (e.key === 'Escape') { setTempQty(String(item.quantity)); setEditing(false) }
            }}
            autoFocus
            className="h-7 w-14 text-center text-sm font-bold border border-[#d4a853] rounded-lg bg-background focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => { setTempQty(String(item.quantity)); setEditing(true) }}
            className="h-7 w-14 text-center text-sm font-bold text-[#d4a853] hover:bg-muted rounded-lg"
          >
            ×{item.quantity}
          </button>
        )}
        <button
          type="button"
          onClick={() => updateQty(item.quantity + 1)}
          disabled={busy}
          className="h-7 w-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Box Scanner (Copy of scanner logic — NOT shared with existing scanner) ───
function BoxScanner({ boxId, onScanned }: { boxId: string; onScanned: () => void }) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const [input, setInput] = useState('')
  const [flash, setFlash] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  const scanSku = async (code: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const { data } = await api.post(`/admin/master-boxes/${boxId}/scan`, { sku: code.trim() })
      onScanned()
      return { ok: true, message: `${data.name} (${data.color}/${data.size})` }
    } catch (e: any) {
      const msg = e?.response?.data?.message
      const text = typeof msg === 'object' ? (msg.de ?? msg.en ?? 'Fehler') : (msg ?? t3('Fehler beim Scannen', 'Scan error', 'خطأ في المسح'))
      return { ok: false, message: text }
    }
  }

  const handleScan = async (code: string) => {
    if (!code.trim()) return
    setInput('')
    const res = await scanSku(code)
    setFlash({ text: res.ok ? `✓ ${res.message}` : res.message, type: res.ok ? 'ok' : 'error' })
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div className="p-4 border-b bg-muted/20">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute start-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#d4a853]" />
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(input) } }}
            placeholder={t3('Barcode scannen oder SKU eingeben...', 'Scan barcode or enter SKU...', 'امسح الباركود أو أدخل SKU...')}
            className="h-12 ps-12 text-base font-mono border-[#d4a853]/30 focus:border-[#d4a853]"
            autoFocus
          />
        </div>
        <Button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="h-12 px-4 gap-2 bg-[#1a1a2e] hover:bg-[#2a2a3e] text-white"
          title={t3('Handykamera', 'Phone camera', 'كاميرا الهاتف')}
        >
          <Camera className="h-5 w-5" />
          <span className="hidden sm:inline">{t3('Kamera', 'Camera', 'الكاميرا')}</span>
        </Button>
      </div>
      {flash && (
        <div className={`mt-2 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${
          flash.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {flash.type === 'ok' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {flash.text}
        </div>
      )}
      {cameraOpen && (
        <BoxCameraScanner
          onDetect={scanSku}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Create Box Modal ───
function CreateBoxModal({ warehouses, onClose, onCreated }: { warehouses: any[]; onClose: () => void; onCreated: (id: string) => void }) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const [name, setName] = useState('')
  const [season, setSeason] = useState('winter')
  const [year, setYear] = useState(new Date().getFullYear())
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name || !warehouseId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/admin/master-boxes', { name, season, year, warehouseId, notes: notes || undefined })
      onCreated(data.id)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Error')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2"><Package className="h-5 w-5 text-[#d4a853]" />{t3('Neuer Karton', 'New Box', 'كرتونة جديدة')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Name', 'Name', 'الاسم')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t3('z.B. Winterkollektion 2026 — Karton 1', 'e.g. Winter 2026 — Box 1', 'مثال: كرتونة الشتاء ٢٠٢٦ — ١')} className="h-11 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Saison', 'Season', 'الموسم')}</label>
              <select value={season} onChange={(e) => setSeason(e.target.value)} className="w-full h-11 px-4 rounded-xl border bg-background text-sm">
                <option value="winter">{t3('Winter', 'Winter', 'شتاء')}</option>
                <option value="spring">{t3('Frühjahr', 'Spring', 'ربيع')}</option>
                <option value="summer">{t3('Sommer', 'Summer', 'صيف')}</option>
                <option value="autumn">{t3('Herbst', 'Autumn', 'خريف')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Jahr', 'Year', 'السنة')}</label>
              <Input type="number" value={year} onChange={(e) => setYear(+e.target.value)} className="h-11 rounded-xl" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Lager', 'Warehouse', 'المستودع')}</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full h-11 px-4 rounded-xl border bg-background text-sm">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Notizen', 'Notes', 'ملاحظات')}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-20 px-4 py-3 rounded-xl border bg-background text-sm resize-none" />
          </div>
          {error && <p className="text-xs text-red-600">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
        </div>
        <div className="p-6 border-t flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>{t3('Abbrechen', 'Cancel', 'إلغاء')}</Button>
          <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handleCreate} disabled={!name || !warehouseId || loading}>
            <Plus className="h-4 w-4" />{loading ? t3('Erstellen...', 'Creating...', 'جاري الإنشاء...') : t3('Erstellen', 'Create', 'إنشاء')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Transfer Box Modal ───
interface Mismatch { sku: string; name: string; wanted: number; available: number }

function TransferBoxModal({ box, warehouses, onClose, onDone }: { box: any; warehouses: any[]; onClose: () => void; onDone: () => void }) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d
  const [targetId, setTargetId] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<{ count: number; totalQty: number } | null>(null)
  const [mismatches, setMismatches] = useState<Mismatch[] | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const otherWarehouses = warehouses.filter((w) => w.id !== box.warehouseId)

  const extractMsg = (msg: any): string => {
    if (!msg) return t3('Unbekannter Fehler', 'Unknown error', 'خطأ غير معروف')
    if (typeof msg === 'string') return msg
    return msg[locale] ?? msg.de ?? msg.en ?? JSON.stringify(msg)
  }

  const handleTransfer = async () => {
    if (!targetId) return
    setLoading(true)
    setMismatches(null)
    setErrorMsg(null)
    setSuccess(null)
    try {
      const { data } = await api.post(`/admin/master-boxes/${box.id}/transfer`, { targetWarehouseId: targetId })
      setSuccess({ count: data.successCount, totalQty: data.totalTransferred })
      setTimeout(() => { onDone() }, 1800)
    } catch (e: any) {
      const data = e?.response?.data
      if (data?.error === 'StockMismatch' && Array.isArray(data.mismatches)) {
        setMismatches(data.mismatches)
        setErrorMsg(extractMsg(data.message))
      } else {
        setErrorMsg(extractMsg(data?.message) || t3('Transfer fehlgeschlagen', 'Transfer failed', 'فشل النقل'))
      }
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-[#d4a853]" />{t3('Karton transferieren', 'Transfer Box', 'نقل الكرتونة')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-muted/30 rounded-xl p-4 text-sm">
            <p><strong>{box.boxNumber}</strong> — {box.name}</p>
            <p className="text-muted-foreground mt-1">{t3('Von', 'From', 'من')}: <strong>{box.warehouse?.name}</strong></p>
            <p className="text-muted-foreground">{t3('Artikel', 'Items', 'المنتجات')}: <strong>{box.totalItems}</strong> ({box.totalQuantity} {t3('Stück', 'pieces', 'قطعة')})</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">{t3('Ziel-Lager', 'Target Warehouse', 'المستودع الهدف')}</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full h-11 px-4 rounded-xl border bg-background text-sm">
              <option value="">{t3('-- Wählen --', '-- Select --', '-- اختر --')}</option>
              {otherWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {/* Success */}
          {success && (
            <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-green-800">
              <div className="flex items-center gap-2 font-bold">
                <Check className="h-5 w-5" />
                {t3('Transfer erfolgreich', 'Transfer successful', 'تم النقل بنجاح')}
              </div>
              <p className="text-sm mt-1">
                {success.count} {t3('Varianten', 'variants', 'متغيرات')} · {success.totalQty} {t3('Stück transferiert', 'pieces transferred', 'قطعة تم نقلها')}
              </p>
            </div>
          )}

          {/* StockMismatch (Strict-Modus Warnung) */}
          {mismatches && (
            <div className="p-4 rounded-xl bg-red-50 border-2 border-red-200">
              <div className="flex items-center gap-2 text-red-800 font-bold mb-2">
                <X className="h-5 w-5" />
                {t3('Transfer blockiert — Bestand nicht ausreichend', 'Transfer blocked — insufficient stock', 'تم حظر النقل — المخزون غير كافٍ')}
              </div>
              <p className="text-xs text-red-700 mb-3">{errorMsg}</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {mismatches.map((m) => (
                  <div key={m.sku} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-red-200 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate text-red-900">{m.name}</p>
                      <p className="text-xs text-red-600 font-mono">{m.sku}</p>
                    </div>
                    <div className="text-end" dir="ltr">
                      <p className="text-xs text-red-700">
                        <span className="font-bold">{m.wanted}</span> {t3('gewollt', 'wanted', 'مطلوب')}
                      </p>
                      <p className="text-xs text-red-900 font-bold">
                        {t3('nur', 'only', 'فقط')} {m.available} {t3('verfügbar', 'available', 'متاح')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-red-700 mt-3 leading-relaxed">
                {t3(
                  'Kein Artikel wurde transferiert. Korrigiere die Box-Menge oder fülle den Bestand auf, bevor du erneut transferierst.',
                  'No items were transferred. Adjust the box quantity or replenish stock before transferring again.',
                  'لم يتم نقل أي منتج. قم بتصحيح كمية الكرتونة أو تجديد المخزون قبل المحاولة مرة أخرى.',
                )}
              </p>
            </div>
          )}

          {/* Generic error */}
          {errorMsg && !mismatches && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {errorMsg}
            </div>
          )}
        </div>
        <div className="p-6 border-t flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {success ? t3('Schließen', 'Close', 'إغلاق') : t3('Abbrechen', 'Cancel', 'إلغاء')}
          </Button>
          {!success && (
            <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handleTransfer} disabled={!targetId || loading}>
              <ArrowRightLeft className="h-4 w-4" />{loading ? t3('Transferiere...', 'Transferring...', 'جاري النقل...') : t3('Transferieren', 'Transfer', 'نقل')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
