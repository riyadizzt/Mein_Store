'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Printer, Download, X, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

type LabelFormat = 'small' | 'medium' | 'large'

interface LabelData {
  sku: string
  barcode?: string | null
  productName: string
  color: string
  size: string
  price: number
  location?: string | null
  stock?: number
}

interface LabelPrinterProps {
  items: LabelData[]
  onClose: () => void
}

// Dimensions in CSS px (at 96dpi: 1mm ≈ 3.78px)
const FORMATS: Record<LabelFormat, { wMm: number; hMm: number; wPx: number; hPx: number; label: string }> = {
  small:  { wMm: 50, hMm: 25, wPx: 189, hPx: 95, label: '50×25mm' },
  medium: { wMm: 70, hMm: 40, wPx: 265, hPx: 151, label: '70×40mm' },
  large:  { wMm: 100, hMm: 60, wPx: 378, hPx: 227, label: '100×60mm' },
}

export function LabelPrinter({ items, onClose }: LabelPrinterProps) {
  const locale = useLocale()
  const [format, setFormat] = useState<LabelFormat>('small')
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {}
    for (const item of items) q[item.sku] = item.stock ?? 1
    return q
  })

  const setQty = (sku: string, qty: number) => setQuantities({ ...quantities, [sku]: Math.max(1, qty) })
  const totalLabels = Object.values(quantities).reduce((s, q) => s + q, 0)
  const fmtPrice = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`
  const hasZeroPrice = items.some((item) => !item.price || item.price <= 0)

  // ── PRINT ──
  const handlePrint = useCallback(() => {
    const win = window.open('', '_blank')
    if (!win) return
    const fmt = FORMATS[format]
    const labels: string[] = []

    for (const item of items) {
      const qty = quantities[item.sku] ?? 1
      for (let i = 0; i < qty; i++) {
        labels.push(buildLabelHtml(item, format, fmtPrice))
      }
    }

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: ${fmt.wMm}mm ${fmt.hMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label { width: ${fmt.wMm}mm; height: ${fmt.hMm}mm; padding: 2mm 3mm; page-break-after: always; overflow: hidden; display: flex; flex-direction: column; }
  .label:last-child { page-break-after: auto; }
  .brand { font-size: 6pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #333; }
  .barcode-wrap { text-align: center; margin: 1mm 0; }
  .barcode-wrap svg, .barcode-wrap canvas { max-width: 100%; height: auto; }
  .sku { font-size: 7pt; font-family: 'Courier New', monospace; color: #444; }
  .name { font-weight: 700; color: #000; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .name-sm { font-size: 8pt; }
  .name-md { font-size: 9pt; }
  .name-lg { font-size: 13pt; }
  .detail { font-size: 7pt; color: #444; }
  .price { font-weight: 700; color: #000; }
  .price-sm { font-size: 8pt; }
  .price-md { font-size: 11pt; }
  .price-lg { font-size: 13pt; }
  .row { display: flex; justify-content: space-between; align-items: baseline; }
  .spacer { flex: 1; }
  .stock { font-size: 7pt; color: #555; }
  .location { font-size: 6pt; color: #777; }
</style>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
</head><body>
${labels.join('')}
<script>
  document.querySelectorAll('.barcode-svg').forEach(el => {
    try { JsBarcode(el, el.dataset.value, { format: 'CODE128', width: Number(el.dataset.bw) || 1.5, height: Number(el.dataset.bh) || 25, displayValue: false, margin: 0, flat: true }); } catch(e) {}
  });
  setTimeout(() => window.print(), 400);
<\/script>
</body></html>`)
    win.document.close()
  }, [items, quantities, format, fmtPrice])

  // ── PDF ──
  const handlePdf = useCallback(async () => {
    const { jsPDF } = await import('jspdf')
    const JsBarcode = (await import('jsbarcode')).default
    const fmt = FORMATS[format]

    const doc = new jsPDF({ orientation: fmt.wMm > fmt.hMm ? 'landscape' : 'portrait', unit: 'mm', format: [fmt.wMm, fmt.hMm] })
    let first = true

    for (const item of items) {
      const qty = quantities[item.sku] ?? 1

      // Generate barcode to canvas
      const canvas = document.createElement('canvas')
      try { JsBarcode(canvas, item.barcode || item.sku, { format: 'CODE128', width: 2, height: format === 'large' ? 50 : format === 'medium' ? 35 : 25, displayValue: false, margin: 0 }) } catch { /* skip */ }
      const barcodeImg = canvas.toDataURL('image/png')

      for (let i = 0; i < qty; i++) {
        if (!first) doc.addPage([fmt.wMm, fmt.hMm])
        first = false
        renderPdfLabel(doc, item, format, fmt, barcodeImg, fmtPrice)
      }
    }

    doc.save('labels.pdf')
  }, [items, quantities, format, fmtPrice])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'fadeIn 200ms ease-out' }} />
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2"><Printer className="h-5 w-5 text-[#d4a853]" />{locale === 'ar' ? 'طباعة الملصقات' : locale === 'en' ? 'Print Labels' : 'Labels drucken'}</h3>
            <p className="text-xs text-muted-foreground">{items.length} {locale === 'ar' ? 'متغير(ات)' : locale === 'en' ? 'variant(s)' : 'Variante(n)'} / {totalLabels} Labels</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Format Toggle */}
        <div className="flex items-center gap-2 px-6 py-3 border-b bg-muted/20">
          {(['small', 'medium', 'large'] as LabelFormat[]).map((f) => (
            <button key={f} onClick={() => setFormat(f)}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${format === f ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
              {FORMATS[f].label}
            </button>
          ))}
        </div>

        {/* Items with live preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {items.map((item) => {
            const itemHasNoPrice = !item.price || item.price <= 0
            return (
              <div key={item.sku} className={`flex items-start gap-4 p-3 rounded-xl border transition-colors ${itemHasNoPrice ? 'border-red-500 bg-red-50/50' : 'hover:border-primary/20'}`}>
                {itemHasNoPrice ? (
                  /* Zero-price warning instead of preview */
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{item.productName}</div>
                    <div className="text-xs text-muted-foreground">{item.sku} &middot; {item.color} / {item.size}</div>
                    <div className="mt-2 text-sm font-medium text-red-600">
                      {locale === 'ar' ? 'السعر مفقود — لا يمكن طباعة الملصق' : locale === 'en' ? 'Price missing — label cannot be printed' : 'Preis fehlt — Label kann nicht gedruckt werden'}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Live preview — exact proportions */}
                    <LabelPreview item={item} format={format} fmtPrice={fmtPrice} locale={locale} />

                    {/* Info + Qty */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                      <div className="text-xs text-muted-foreground">{item.color} / {item.size} &middot; {fmtPrice(item.price)}</div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button onClick={() => setQty(item.sku, (quantities[item.sku] ?? 1) - 1)} className="h-7 w-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center"><Minus className="h-3 w-3" /></button>
                        <span className="w-8 text-center text-sm font-bold">{quantities[item.sku] ?? 1}</span>
                        <button onClick={() => setQty(item.sku, (quantities[item.sku] ?? 1) + 1)} className="h-7 w-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center"><Plus className="h-3 w-3" /></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-6 py-4 border-t">
          <Button variant="outline" className="flex-1 rounded-xl gap-2" onClick={handlePdf} disabled={hasZeroPrice}><Download className="h-4 w-4" />PDF</Button>
          <Button className="flex-1 rounded-xl gap-2" onClick={handlePrint} disabled={hasZeroPrice}><Printer className="h-4 w-4" />{locale === 'ar' ? `طباعة (${totalLabels})` : locale === 'en' ? `Print (${totalLabels})` : `Drucken (${totalLabels})`}</Button>
        </div>
      </div>
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}

// ── LIVE PREVIEW COMPONENT ───────────────────────────────

function LabelPreview({ item, format, fmtPrice, locale }: { item: LabelData; format: LabelFormat; fmtPrice: (n: number) => string; locale: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fmt = FORMATS[format]
  const scale = 0.75

  useEffect(() => {
    if (!canvasRef.current) return
    import('jsbarcode').then((JsBarcode) => {
      try {
        JsBarcode.default(canvasRef.current!, item.barcode || item.sku, {
          format: 'CODE128',
          width: format === 'large' ? 1.8 : format === 'medium' ? 1.5 : 1.2,
          height: format === 'large' ? 35 : format === 'medium' ? 28 : 20,
          displayValue: false,
          margin: 0,
        })
      } catch { /* invalid barcode */ }
    })
  }, [item.sku, item.barcode, format])

  return (
    <div className="flex-shrink-0 bg-white border rounded-lg shadow-sm overflow-hidden"
      style={{ width: fmt.wPx * scale, height: fmt.hPx * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: fmt.wPx, height: fmt.hPx, padding: '6px 10px', display: 'flex', flexDirection: 'column' }}>

        {format === 'large' ? (
          /* ── LARGE: Name first, then barcode ── */
          <>
            <div style={{ fontSize: 6, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as const, color: '#333' }}>MALAK BEKLEIDUNG</div>
            <div style={{ height: 4 }} />
            <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.productName}</div>
            <div style={{ height: 6 }} />
            <div style={{ textAlign: 'center' }}><canvas ref={canvasRef} style={{ maxWidth: '92%' }} /></div>
            <div style={{ fontSize: 8, fontFamily: 'Courier New, monospace', color: '#444', textAlign: 'center', marginTop: 2 }}>{item.sku}</div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{fmtPrice(item.price)}</span>
              <span style={{ fontSize: 8, color: '#444' }}>{item.color} / {item.size}</span>
            </div>
            {item.stock != null && <div style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{locale === 'ar' ? 'المخزون' : locale === 'en' ? 'Stock' : 'Bestand'}: {item.stock} {locale === 'ar' ? 'قطعة' : locale === 'en' ? 'pcs' : 'Stück'}</div>}
          </>
        ) : format === 'medium' ? (
          /* ── MEDIUM: Brand, barcode, SKU, name, variant, price, location ── */
          <>
            <div style={{ fontSize: 6, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as const, color: '#333' }}>MALAK BEKLEIDUNG</div>
            <div style={{ height: 3 }} />
            <div style={{ textAlign: 'center' }}><canvas ref={canvasRef} style={{ maxWidth: '90%' }} /></div>
            <div style={{ fontSize: 7, fontFamily: 'Courier New, monospace', color: '#444', textAlign: 'center', marginTop: 1 }}>{item.sku}</div>
            <div style={{ height: 3 }} />
            <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.productName}</div>
            <div style={{ fontSize: 7, color: '#444', marginTop: 1 }}>{item.color} / {item.size}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{fmtPrice(item.price)}</div>
            {item.location && <div style={{ fontSize: 6, color: '#777', marginTop: 1 }}>{item.location}</div>}
          </>
        ) : (
          /* ── SMALL: Brand, barcode, SKU, name, variant+price ── */
          <>
            <div style={{ fontSize: 5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' as const, color: '#333' }}>MALAK BEKLEIDUNG</div>
            <div style={{ height: 2 }} />
            <div style={{ textAlign: 'center' }}><canvas ref={canvasRef} style={{ maxWidth: '88%' }} /></div>
            <div style={{ fontSize: 6, fontFamily: 'Courier New, monospace', color: '#444', textAlign: 'center', marginTop: 1 }}>{item.sku}</div>
            <div style={{ height: 2 }} />
            <div style={{ fontSize: 7, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.productName}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 1 }}>
              <span style={{ fontSize: 6, color: '#444' }}>{item.color} / {item.size}</span>
              <span style={{ fontSize: 7, fontWeight: 700 }}>{fmtPrice(item.price)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── HTML LABEL FOR PRINT ─────────────────────────────────

function buildLabelHtml(item: LabelData, format: LabelFormat, fmtPrice: (n: number) => string): string {
  const bw = format === 'large' ? 2 : format === 'medium' ? 1.8 : 1.5
  const bh = format === 'large' ? 40 : format === 'medium' ? 30 : 22
  const barcodeValue = item.barcode || item.sku

  if (format === 'large') {
    return `<div class="label">
      <div class="brand">MALAK BEKLEIDUNG</div>
      <div style="height:2mm"></div>
      <div class="name name-lg">${item.productName}</div>
      <div style="height:2mm"></div>
      <div class="barcode-wrap"><svg class="barcode-svg" data-value="${barcodeValue}" data-bw="${bw}" data-bh="${bh}"></svg></div>
      <div class="sku" style="text-align:center">${item.sku}</div>
      <div class="spacer"></div>
      <div class="row"><span class="price price-lg">${fmtPrice(item.price)}</span><span class="detail">${item.color} / ${item.size}</span></div>
      ${item.stock != null ? `<div class="stock">Bestand: ${item.stock} Stück</div>` : ''}
    </div>`
  }

  if (format === 'medium') {
    return `<div class="label">
      <div class="brand">MALAK BEKLEIDUNG</div>
      <div style="height:1mm"></div>
      <div class="barcode-wrap"><svg class="barcode-svg" data-value="${barcodeValue}" data-bw="${bw}" data-bh="${bh}"></svg></div>
      <div class="sku" style="text-align:center">${item.sku}</div>
      <div style="height:1mm"></div>
      <div class="name name-md">${item.productName}</div>
      <div class="detail">${item.color} / ${item.size}</div>
      <div class="spacer"></div>
      <div class="price price-md">${fmtPrice(item.price)}</div>
      ${item.location ? `<div class="location">${item.location}</div>` : ''}
    </div>`
  }

  // Small
  return `<div class="label">
    <div class="brand">MALAK BEKLEIDUNG</div>
    <div style="height:0.5mm"></div>
    <div class="barcode-wrap"><svg class="barcode-svg" data-value="${barcodeValue}" data-bw="${bw}" data-bh="${bh}"></svg></div>
    <div class="sku" style="text-align:center">${item.sku}</div>
    <div style="height:0.5mm"></div>
    <div class="name name-sm">${item.productName}</div>
    <div class="row"><span class="detail">${item.color} / ${item.size}</span><span class="price price-sm">${fmtPrice(item.price)}</span></div>
  </div>`
}

// ── PDF LABEL RENDER ─────────────────────────────────────

function renderPdfLabel(doc: any, item: LabelData, format: LabelFormat, fmt: { wMm: number; hMm: number }, barcodeImg: string, fmtPrice: (n: number) => string) {
  const m = 3 // margin mm
  const bw = fmt.wMm - m * 2 // barcode width
  let y = m

  // Brand
  doc.setFontSize(5).setFont('helvetica', 'bold').setTextColor(51)
  doc.text('MALAK BEKLEIDUNG', m, y + 1.5)
  y += 3

  if (format === 'large') {
    // Name first
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(item.productName.slice(0, 30), m, y + 4)
    y += 7

    // Barcode
    if (barcodeImg) doc.addImage(barcodeImg, 'PNG', m, y, bw, 12)
    y += 13

    // SKU
    doc.setFontSize(6).setFont('courier', 'normal').setTextColor(68)
    doc.text(item.sku, fmt.wMm / 2, y + 1.5, { align: 'center' })
    y += 4

    // Price + variant
    const priceY = fmt.hMm - m - 6
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(fmtPrice(item.price), m, priceY)
    doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(68)
    doc.text(`${item.color} / ${item.size}`, fmt.wMm - m, priceY, { align: 'right' })

    if (item.stock != null) {
      doc.setFontSize(6).setTextColor(85)
      doc.text(`Bestand: ${item.stock} Stück`, m, priceY + 4)
    }
  } else if (format === 'medium') {
    // Barcode
    if (barcodeImg) doc.addImage(barcodeImg, 'PNG', m, y, bw, 9)
    y += 10

    // SKU
    doc.setFontSize(6).setFont('courier', 'normal').setTextColor(68)
    doc.text(item.sku, fmt.wMm / 2, y + 1.5, { align: 'center' })
    y += 3.5

    // Name
    doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(item.productName.slice(0, 35), m, y + 2.5)
    y += 4

    // Variant
    doc.setFontSize(6).setFont('helvetica', 'normal').setTextColor(68)
    doc.text(`${item.color} / ${item.size}`, m, y + 1.5)
    y += 3

    // Price
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(fmtPrice(item.price), m, fmt.hMm - m - (item.location ? 3 : 0))

    if (item.location) {
      doc.setFontSize(5).setFont('helvetica', 'normal').setTextColor(119)
      doc.text(item.location, m, fmt.hMm - m)
    }
  } else {
    // Small: barcode
    if (barcodeImg) doc.addImage(barcodeImg, 'PNG', m, y, bw, 6)
    y += 7

    // SKU
    doc.setFontSize(5).setFont('courier', 'normal').setTextColor(68)
    doc.text(item.sku, fmt.wMm / 2, y + 1, { align: 'center' })
    y += 2.5

    // Name
    doc.setFontSize(6.5).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(item.productName.slice(0, 25), m, y + 2)
    y += 3

    // Variant + Price
    doc.setFontSize(5.5).setFont('helvetica', 'normal').setTextColor(68)
    doc.text(`${item.color} / ${item.size}`, m, y + 1.5)
    doc.setFontSize(6).setFont('helvetica', 'bold').setTextColor(0)
    doc.text(fmtPrice(item.price), fmt.wMm - m, y + 1.5, { align: 'right' })
  }
}

// ── QUICK PRINT BUTTON ───────────────────────────────────

interface PrintLabelButtonProps {
  variant: { sku: string; barcode?: string | null; color?: string; size?: string; stock?: number; price?: number; location?: string | null }
  productName: string
  className?: string
}

export function PrintLabelButton({ variant, productName, className }: PrintLabelButtonProps) {
  const [show, setShow] = useState(false)
  const data: LabelData = {
    sku: variant.sku, barcode: variant.barcode, productName,
    color: variant.color ?? '', size: variant.size ?? '',
    price: variant.price ?? 0, location: variant.location, stock: variant.stock,
  }
  return (
    <>
      <button onClick={() => setShow(true)} className={className ?? 'p-1.5 rounded-lg hover:bg-muted transition-colors'} title="Print Label">
        <Printer className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {show && <LabelPrinter items={[data]} onClose={() => setShow(false)} />}
    </>
  )
}
