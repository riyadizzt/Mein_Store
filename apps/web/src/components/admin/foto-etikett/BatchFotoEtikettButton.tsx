'use client'

/**
 * Batch Foto-Etikett Button — prints photo labels for multiple variants on minimal A4 pages.
 * Used on: Product page (all variants) + Inventory scanner (all scanned items)
 */

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { X, Printer, Minus, Plus, ImageIcon, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openBatchFotoEtikettPrintWindow, SIZE_CONFIG } from './FotoEtikettDruck'
import type { FotoEtikettData } from './FotoEtikettDruck'

interface BatchItem {
  productName: string
  color: string
  colorHex: string
  size: string
  sku: string
  price: number
  imageUrl: string | null
  categoryStripe: 'herren' | 'damen' | 'kinder' | 'unisex'
  qty: number
}

interface Props {
  items: BatchItem[]
  buttonLabel?: string
  buttonClassName?: string
  variant?: 'default' | 'scanner'
}

export function BatchFotoEtikettButton({ items, buttonLabel, buttonClassName, variant = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  if (items.length === 0) return null

  const label = buttonLabel ?? t3('Alle Foto-Etiketten', 'All Photo Labels', 'جميع ملصقات الصور')

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClassName ?? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors'}>
        <ImageIcon className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && <BatchFotoEtikettModal items={items} onClose={() => setOpen(false)} variant={variant} />}
    </>
  )
}

function BatchFotoEtikettModal({ items, onClose }: { items: BatchItem[]; onClose: () => void; variant: 'default' | 'scanner' }) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [selectedSize, setSelectedSize] = useState<'klein' | 'mittel' | 'gross'>('gross')
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {}
    items.forEach((item) => { q[item.sku] = item.qty || 1 })
    return q
  })

  const cfg = SIZE_CONFIG[selectedSize]
  const totalLabels = Object.values(quantities).reduce((s, q) => s + q, 0)
  const totalPages = Math.ceil(totalLabels / cfg.perPage)

  const SIZES = [
    { key: 'klein' as const,  label: 'Klein',  labelAr: 'صغير',  desc: '30\u00d730mm',  perPage: 54 },
    { key: 'mittel' as const, label: 'Mittel', labelAr: 'متوسط', desc: '50\u00d735mm',  perPage: 32 },
    { key: 'gross' as const,  label: 'Gro\u00df',  labelAr: 'كبير',  desc: '50\u00d750mm',  perPage: 20 },
  ]

  const handlePrint = () => {
    const allLabels: FotoEtikettData[] = []
    items.forEach((item) => {
      const qty = quantities[item.sku] ?? 1
      for (let i = 0; i < qty; i++) {
        allLabels.push({
          productName: item.productName,
          color: item.color,
          colorHex: item.colorHex,
          size: item.size,
          sku: item.sku,
          price: item.price,
          imageUrl: item.imageUrl,
          categoryStripe: item.categoryStripe,
        })
      }
    })
    openBatchFotoEtikettPrintWindow(allLabels, { size: selectedSize })
    onClose()
  }

  const updateQty = (sku: string, delta: number) => {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(0, Math.min(100, (prev[sku] ?? 1) + delta)) }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col bg-[#1a1a2e] text-white" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#d4a853]" />
            <h3 className="text-lg font-bold">{t3('Foto-Etiketten Batch-Druck', 'Photo Labels Batch Print', 'طباعة دفعة ملصقات الصور')}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* Size Selection */}
        <div className="px-6 py-3 flex gap-2">
          {SIZES.map((s) => (
            <button key={s.key} onClick={() => setSelectedSize(s.key)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                selectedSize === s.key
                  ? 'bg-[#d4a853] text-white shadow-sm'
                  : 'bg-white/10 hover:bg-white/15 text-white/70'
              }`}>
              {locale === 'ar' ? s.labelAr : s.label}<br />
              <span className="font-normal opacity-70">{s.desc}</span>
            </button>
          ))}
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-1">
          {items.map((item) => {
            const qty = quantities[item.sku] ?? 1
            return (
              <div key={item.sku} className={`flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 ${qty === 0 ? 'opacity-40' : ''}`}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0 overflow-hidden px-0.5" style={{ backgroundColor: item.colorHex || '#6B7280' }}>
                    <span className="text-white font-bold text-[7px] leading-tight text-center truncate w-full">{item.color || item.productName.charAt(0)}</span>
                    <span className="text-white font-black text-xs leading-none">{item.size}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{item.productName}</p>
                  <p className="text-[10px] text-white/50">{item.color} / {item.size} &middot; <span className="font-mono">{item.sku}</span></p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => updateQty(item.sku, -1)} className="h-6 w-6 rounded-lg flex items-center justify-center text-xs bg-white/10 hover:bg-white/20 text-white"><Minus className="h-3 w-3" /></button>
                  <span className="w-6 text-center text-xs font-bold">{qty}</span>
                  <button onClick={() => updateQty(item.sku, 1)} className="h-6 w-6 rounded-lg flex items-center justify-center text-xs bg-white/10 hover:bg-white/20 text-white"><Plus className="h-3 w-3" /></button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10">
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-[#d4a853]/15 border border-[#d4a853]/20">
            <Printer className="h-3.5 w-3.5 text-[#d4a853] flex-shrink-0" />
            <p className="text-xs text-[#d4a853] font-medium">
              {t3(
                `${totalLabels} Etiketten werden auf ${totalPages} A4-Seite(n) gedruckt`,
                `${totalLabels} labels will be printed on ${totalPages} A4 page(s)`,
                `سيتم طباعة ${totalLabels} ملصق على ${totalPages} صفحة A4`
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>{t3('Abbrechen', 'Cancel', 'إلغاء')}</Button>
            <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4" />{t3('Drucken', 'Print', 'طباعة')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
