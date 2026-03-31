'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const BarcodeDetector: any

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Flashlight, FlashlightOff, Camera, Minus, Plus, Trash2, PackagePlus, ClipboardList, RotateCcw, Package, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, getProductName } from '@/lib/locale-utils'
import { useScannerFeedback } from '@/hooks/use-scanner-feedback'

// ─── Types ───
interface ScannedProduct {
  variantId: string
  sku: string
  barcode: string | null
  productName: any[]
  image: string | null
  color: string | null
  size: string | null
  inventoryId: string
  warehouseId: string
  currentStock: number
}

interface BatchItem {
  variantId: string
  sku: string
  barcode: string | null
  productName: any[]
  image: string | null
  color: string | null
  size: string | null
  inventoryId: string
  warehouseId: string
  currentStock: number
  count: number
}

interface CameraBarcodeScannerProps {
  mode: 'single' | 'batch'
  locale: string
  warehouseId?: string
  onSingleResult?: (product: ScannedProduct) => void
  onBatchConfirm?: (items: BatchItem[], action: 'intake' | 'stocktake' | 'correction') => void
  onClose: () => void
}

// ─── Translations ───
const T: Record<string, Record<string, string>> = {
  title: { de: 'Kamera-Scanner', ar: 'ماسح الكاميرا', en: 'Camera Scanner' },
  batchTitle: { de: 'Sammel-Scan', ar: 'مسح دفعات', en: 'Batch Scan' },
  scanning: { de: 'Scanne...', ar: 'جاري المسح...', en: 'Scanning...' },
  pointCamera: { de: 'Kamera auf Barcode richten', ar: 'وجّه الكاميرا نحو الباركود', en: 'Point camera at barcode' },
  newItem: { de: 'Neuer Artikel', ar: 'منتج جديد', en: 'New item' },
  qtyUpdated: { de: 'Menge aktualisiert', ar: 'تم تحديث الكمية', en: 'Quantity updated' },
  notFound: { de: 'Barcode nicht gefunden', ar: 'لم يتم العثور على الباركود', en: 'Barcode not found' },
  stock: { de: 'Bestand', ar: 'المخزون', en: 'Stock' },
  scanAgain: { de: 'Erneut scannen', ar: 'مسح مرة أخرى', en: 'Scan again' },
  goToProduct: { de: 'Zum Produkt', ar: 'إلى المنتج', en: 'Go to product' },
  flashOn: { de: 'Licht an', ar: 'تشغيل الضوء', en: 'Light on' },
  flashOff: { de: 'Licht aus', ar: 'إيقاف الضوء', en: 'Light off' },
  scannedItems: { de: 'Gescannte Artikel', ar: 'المنتجات الممسوحة', en: 'Scanned items' },
  total: { de: 'Gesamt', ar: 'المجموع', en: 'Total' },
  items: { de: 'Artikel', ar: 'منتج', en: 'items' },
  units: { de: 'Stück', ar: 'قطعة', en: 'units' },
  bookIntake: { de: 'Als Wareneingang buchen', ar: 'حجز كإيصال بضاعة', en: 'Book as goods receipt' },
  saveStocktake: { de: 'Als Inventur speichern', ar: 'حفظ كجرد', en: 'Save as inventory count' },
  correction: { de: 'Bestandskorrektur', ar: 'تصحيح المخزون', en: 'Stock correction' },
  close: { de: 'Schließen', ar: 'إغلاق', en: 'Close' },
  done: { de: 'Fertig', ar: 'تم', en: 'Done' },
  cameraPermission: { de: 'Kamerazugriff erforderlich', ar: 'يتطلب الوصول للكاميرا', en: 'Camera access required' },
  cameraPermissionDesc: { de: 'Erlaube den Kamerazugriff um Barcodes zu scannen', ar: 'السماح بالوصول إلى الكاميرا لمسح الباركود', en: 'Allow camera access to scan barcodes' },
  qty: { de: 'Menge', ar: 'الكمية', en: 'Qty' },
  enterQty: { de: 'Menge eingeben', ar: 'أدخل الكمية', en: 'Enter quantity' },
  continueScan: { de: 'Weiter scannen', ar: 'متابعة المسح', en: 'Continue scanning' },
  endSession: { de: 'Sitzung beenden', ar: 'إنهاء الجلسة', en: 'End session' },
  emptyBatch: { de: 'Noch keine Artikel gescannt', ar: 'لم يتم مسح أي منتج بعد', en: 'No items scanned yet' },
  processing: { de: 'Wird verarbeitet...', ar: 'جاري المعالجة...', en: 'Processing...' },
  success: { de: 'Erfolgreich gebucht!', ar: 'تم الحجز بنجاح!', en: 'Successfully booked!' },
}

function t(key: string, locale: string) {
  return T[key]?.[locale] ?? T[key]?.['en'] ?? key
}

// ─── Main Component ───
export function CameraBarcodeScannerOverlay({ mode, locale, warehouseId, onSingleResult, onBatchConfirm, onClose }: CameraBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<any>(null)
  const lastScannedRef = useRef<string>('')
  const lastScanTimeRef = useRef<number>(0)
  const { feedback } = useScannerFeedback()

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [hasFlash, setHasFlash] = useState(false)
  const [scanning, setScanning] = useState(true)

  // Single mode state
  const [singleResult, setSingleResult] = useState<ScannedProduct | null>(null)
  const [scanNotFound, setScanNotFound] = useState(false)

  // Batch mode state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [showEndActions, setShowEndActions] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [successMsg, setSuccessMsg] = useState(false)
  const [flashMessage, setFlashMessage] = useState<{ text: string; type: 'new' | 'duplicate' | 'error' } | null>(null)

  const getName = useCallback((translations: any[]) => getProductName(translations, locale), [locale])

  // ── Start Camera ──
  useEffect(() => {
    let mounted = true

    async function startCamera() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })

        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream

        // Check flash capability
        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() as any
        if (caps?.torch) setHasFlash(true)

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
        }

        // Start barcode detection loop
        const detector = (typeof BarcodeDetector !== 'undefined')
          ? new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] })
          : null

        if (detector && videoRef.current) {
          // Use native BarcodeDetector (fast)
          const loop = async () => {
            if (!mounted || !videoRef.current) return
            try {
              const barcodes = await detector.detect(videoRef.current)
              if (barcodes.length > 0) {
                const code = barcodes[0].rawValue
                if (code) handleDetection(code)
              }
            } catch { /* frame error, ignore */ }
            if (mounted) requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
        } else {
          // Fallback: html5-qrcode scanner
          const containerId = 'html5-qr-scanner-' + Date.now()
          const div = document.createElement('div')
          div.id = containerId
          div.style.display = 'none'
          document.body.appendChild(div)

          const scanner = new Html5Qrcode(containerId)
          scannerRef.current = scanner

          await scanner.start(
            { facingMode: 'environment' },
            { fps: 5, qrbox: { width: 250, height: 150 } },
            (text: string) => { handleDetection(text) },
            () => {},
          )

          // Also feed our video element
          if (videoRef.current && stream) {
            videoRef.current.srcObject = stream
            videoRef.current.play()
          }
        }
      } catch (err) {
        if (mounted) setCameraError(true)
      }
    }

    startCamera()

    return () => {
      mounted = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      scannerRef.current?.stop?.().catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle barcode detection ──
  const handleDetection = useCallback(async (code: string) => {
    const now = Date.now()
    // Debounce: ignore same code within 1.5s
    if (code === lastScannedRef.current && now - lastScanTimeRef.current < 1500) return
    lastScannedRef.current = code
    lastScanTimeRef.current = now

    try {
      const { data } = await api.get(`/admin/inventory/barcode/${encodeURIComponent(code.trim())}`)
      const product: ScannedProduct = {
        variantId: data.variantId ?? data.id,
        sku: data.sku,
        barcode: data.barcode,
        productName: data.productName ?? [],
        image: data.image,
        color: data.color,
        size: data.size,
        inventoryId: data.inventory?.[0]?.id ?? '',
        warehouseId: data.inventory?.[0]?.warehouseId ?? warehouseId ?? '',
        currentStock: data.inventory?.[0]?.available ?? 0,
      }

      if (mode === 'single') {
        feedback('new')
        setSingleResult(product)
        setScanNotFound(false)
        setScanning(false)
        onSingleResult?.(product)
      } else {
        // Batch mode
        setBatchItems((prev) => {
          const existing = prev.find((item) => item.variantId === product.variantId)
          if (existing) {
            feedback('duplicate')
            setFlashMessage({ text: t('qtyUpdated', locale) + ` (×${existing.count + 1})`, type: 'duplicate' })
            return prev.map((item) =>
              item.variantId === product.variantId ? { ...item, count: item.count + 1 } : item,
            )
          } else {
            feedback('new')
            setFlashMessage({ text: t('newItem', locale), type: 'new' })
            return [...prev, { ...product, count: 1 }]
          }
        })
      }
    } catch {
      feedback('error')
      if (mode === 'single') {
        setScanNotFound(true)
        setSingleResult(null)
      } else {
        setFlashMessage({ text: t('notFound', locale), type: 'error' })
      }
    }
  }, [mode, locale, warehouseId, feedback, onSingleResult])

  // Clear flash message after 1.5s
  useEffect(() => {
    if (!flashMessage) return
    const timer = setTimeout(() => setFlashMessage(null), 1500)
    return () => clearTimeout(timer)
  }, [flashMessage])

  // ── Toggle flashlight ──
  const toggleFlash = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !flashOn } as any] })
      setFlashOn(!flashOn)
    } catch { /* not supported */ }
  }, [flashOn])

  // ── Batch actions ──
  const totalUnits = batchItems.reduce((sum, item) => sum + item.count, 0)

  const handleBatchAction = useCallback(async (action: 'intake' | 'stocktake' | 'correction') => {
    setProcessing(true)
    try {
      if (action === 'intake') {
        const intakeItems = batchItems
          .filter((item) => item.inventoryId)
          .map((item) => ({ inventoryId: item.inventoryId, quantity: item.count }))
        if (intakeItems.length > 0) {
          await api.post('/admin/inventory/intake', { items: intakeItems, reason: 'Camera batch scan' })
        }
      }
      // For stocktake and correction, delegate to parent
      onBatchConfirm?.(batchItems, action)
      setSuccessMsg(true)
      feedback('new')
      setTimeout(() => { onClose() }, 1500)
    } catch {
      feedback('error')
    }
    setProcessing(false)
  }, [batchItems, feedback, onBatchConfirm, onClose])

  const removeBatchItem = useCallback((variantId: string) => {
    setBatchItems((prev) => prev.filter((item) => item.variantId !== variantId))
  }, [])

  const updateBatchCount = useCallback((variantId: string, count: number) => {
    if (count <= 0) return removeBatchItem(variantId)
    setBatchItems((prev) => prev.map((item) => item.variantId === variantId ? { ...item, count } : item))
  }, [removeBatchItem])

  // ── Success overlay ──
  if (successMsg) {
    return (
      <div className="fixed inset-0 z-[60] bg-green-600 flex items-center justify-center" style={{ animation: 'fadeIn 200ms ease-out' }}>
        <div className="text-center text-white">
          <Check className="h-16 w-16 mx-auto mb-4" />
          <p className="text-xl font-bold">{t('success', locale)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#0a0a1a] flex flex-col" style={{ animation: 'fadeIn 200ms ease-out' }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 backdrop-blur-sm border-b border-white/10 safe-area-top">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-[#d4a853]" />
          <span className="text-white font-bold text-sm">
            {mode === 'batch' ? t('batchTitle', locale) : t('title', locale)}
          </span>
          {mode === 'batch' && batchItems.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[#d4a853] text-black text-xs font-bold">
              {batchItems.length} {t('items', locale)} / {totalUnits} {t('units', locale)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFlash && (
            <button onClick={toggleFlash} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
              {flashOn
                ? <FlashlightOff className="h-4 w-4 text-yellow-400" />
                : <Flashlight className="h-4 w-4 text-white/60" />}
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>

      {/* ── Camera View ── */}
      <div className="relative flex-1 min-h-0">
        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <Camera className="h-16 w-16 mx-auto mb-4 text-white/20" />
              <p className="text-white font-bold mb-2">{t('cameraPermission', locale)}</p>
              <p className="text-white/50 text-sm">{t('cameraPermissionDesc', locale)}</p>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Scanning overlay with target rectangle */}
            {scanning && cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Dark overlay with transparent center */}
                <div className="absolute inset-0 bg-black/40" />
                <div className="relative z-10 w-72 h-40">
                  {/* Scan frame */}
                  <div className="absolute inset-0 border-2 border-white/50 rounded-xl" />
                  {/* Animated scan line */}
                  <div className="absolute left-2 right-2 h-0.5 bg-[#d4a853] rounded-full animate-scan-line" />
                  {/* Corner accents */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-[#d4a853] rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-[#d4a853] rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-[#d4a853] rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-[#d4a853] rounded-br-xl" />
                </div>
                <p className="absolute bottom-8 left-0 right-0 text-center text-white/70 text-sm">
                  {t('pointCamera', locale)}
                </p>
              </div>
            )}

            {/* Flash message overlay */}
            {flashMessage && (
              <div className={`absolute top-16 left-4 right-4 z-20 px-4 py-3 rounded-xl text-center font-bold text-sm backdrop-blur-md transition-all ${
                flashMessage.type === 'new' ? 'bg-green-500/80 text-white' :
                flashMessage.type === 'duplicate' ? 'bg-yellow-500/80 text-black' :
                'bg-red-500/80 text-white'
              }`} style={{ animation: 'fadeSlideDown 300ms ease-out' }}>
                {flashMessage.text}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom Panel ── */}
      <div className="bg-[#111125] border-t border-white/10 max-h-[45vh] flex flex-col safe-area-bottom">
        {mode === 'single' ? (
          /* ─── Single Mode Result ─── */
          <div className="p-4">
            {scanNotFound && (
              <div className="text-center py-4">
                <p className="text-red-400 font-bold">{t('notFound', locale)}</p>
                <button onClick={() => { setScanNotFound(false); setScanning(true); lastScannedRef.current = '' }}
                  className="mt-3 px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-medium">
                  {t('scanAgain', locale)}
                </button>
              </div>
            )}
            {singleResult && (
              <div style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
                <div className="flex items-center gap-3 mb-3">
                  {singleResult.image
                    ? <img src={singleResult.image} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    : <div className="h-14 w-14 rounded-xl bg-white/10 flex items-center justify-center"><Package className="h-6 w-6 text-white/20" /></div>}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{getName(singleResult.productName)}</p>
                    <p className="text-white/40 text-xs font-mono">{singleResult.sku}</p>
                    <p className="text-white/30 text-xs">{translateColor(singleResult.color ?? '', locale)} / {singleResult.size}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-white/50 text-xs">{t('stock', locale)}</p>
                    <p className={`text-xl font-bold ${singleResult.currentStock <= 0 ? 'text-red-400' : 'text-white'}`}>
                      {singleResult.currentStock}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setSingleResult(null); setScanNotFound(false); setScanning(true); lastScannedRef.current = '' }}
                    className="flex-1 h-10 rounded-xl bg-white/10 text-white text-sm font-medium flex items-center justify-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" />{t('scanAgain', locale)}
                  </button>
                </div>
              </div>
            )}
            {!singleResult && !scanNotFound && (
              <div className="text-center py-6">
                <p className="text-white/40 text-sm">{t('pointCamera', locale)}</p>
              </div>
            )}
          </div>
        ) : (
          /* ─── Batch Mode List ─── */
          <>
            {showEndActions ? (
              /* End Action Sheet */
              <div className="p-4" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
                <h3 className="text-white font-bold mb-3">{t('endSession', locale)} — {batchItems.length} {t('items', locale)}, {totalUnits} {t('units', locale)}</h3>
                {processing ? (
                  <div className="text-center py-6">
                    <div className="h-8 w-8 border-2 border-[#d4a853] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-white/50 text-sm">{t('processing', locale)}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button onClick={() => handleBatchAction('intake')}
                      className="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold flex items-center justify-center gap-2 transition-colors">
                      <PackagePlus className="h-4 w-4" />{t('bookIntake', locale)}
                    </button>
                    <button onClick={() => handleBatchAction('stocktake')}
                      className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center justify-center gap-2 transition-colors">
                      <ClipboardList className="h-4 w-4" />{t('saveStocktake', locale)}
                    </button>
                    <button onClick={() => handleBatchAction('correction')}
                      className="w-full h-12 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold flex items-center justify-center gap-2 transition-colors">
                      <RotateCcw className="h-4 w-4" />{t('correction', locale)}
                    </button>
                    <button onClick={() => setShowEndActions(false)}
                      className="w-full h-10 rounded-xl bg-white/10 text-white/70 text-sm font-medium transition-colors">
                      {t('continueScan', locale)}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Batch list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {batchItems.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-white/30 text-sm">{t('emptyBatch', locale)}</p>
                    </div>
                  ) : (
                    batchItems.map((item) => (
                      <div key={item.variantId} className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                        {item.image
                          ? <img src={item.image} alt="" className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
                          : <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0"><Package className="h-4 w-4 text-white/20" /></div>}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">{getName(item.productName)}</p>
                          <p className="text-white/30 text-[10px]">{translateColor(item.color ?? '', locale)} / {item.size}</p>
                        </div>
                        {/* Quantity controls */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => updateBatchCount(item.variantId, item.count - 1)}
                            className="h-7 w-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            value={item.count}
                            onChange={(e) => updateBatchCount(item.variantId, Math.max(1, parseInt(e.target.value) || 1))}
                            className="h-7 w-10 rounded-lg bg-white/10 border border-white/20 text-white text-center text-xs font-bold focus:outline-none focus:border-[#d4a853]"
                          />
                          <button onClick={() => updateBatchCount(item.variantId, item.count + 1)}
                            className="h-7 w-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button onClick={() => removeBatchItem(item.variantId)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Bottom action bar */}
                <div className="p-3 border-t border-white/10 flex gap-2">
                  {batchItems.length > 0 && (
                    <button onClick={() => setShowEndActions(true)}
                      className="flex-1 h-11 rounded-xl bg-[#d4a853] hover:bg-[#c49a48] text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                      <Check className="h-4 w-4" />
                      {t('done', locale)} ({totalUnits} {t('units', locale)})
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Scan-line animation */}
      <style jsx global>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-scan-line {
          animation: scanLineMove 2s ease-in-out infinite;
        }
        @keyframes scanLineMove {
          0%, 100% { top: 10%; }
          50% { top: 85%; }
        }
        .safe-area-top { padding-top: env(safe-area-inset-top, 0); }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
        .border-t-3 { border-top-width: 3px; }
        .border-b-3 { border-bottom-width: 3px; }
        .border-l-3 { border-left-width: 3px; }
        .border-r-3 { border-right-width: 3px; }
      `}</style>
    </div>
  )
}
