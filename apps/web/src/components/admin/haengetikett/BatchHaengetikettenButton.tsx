'use client'

/**
 * Batch Hängetikett Button — prints hang tags for multiple variants on minimal A4 pages.
 * Used on: Product page (all variants) + Inventory scanner (all scanned items) + /admin/etiketten
 * DOES NOT modify existing HaengetikettenModal or HaengetikettenDruck.
 */

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { X, Printer, Minus, Plus, Tag, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openBatchHangTagPrintWindow, HANG_TAG_SIZE_CONFIG } from './BatchHaengetikettenDruck'

export interface BatchHangTagItem {
  productName: string
  color: string
  size: string
  sku: string
  price: number
  qty: number
}

interface Props {
  items: BatchHangTagItem[]
  buttonLabel?: string
  buttonClassName?: string
  variant?: 'default' | 'scanner'
}

export function BatchHaengetikettenButton({ items, buttonLabel, buttonClassName, variant = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  if (items.length === 0) return null

  const label = buttonLabel ?? t3('Alle H\u00e4ngetiketten', 'All Hang Tags', '\u062c\u0645\u064a\u0639 \u0628\u0637\u0627\u0642\u0627\u062a \u0627\u0644\u062a\u0639\u0644\u064a\u0642')

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClassName ?? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors'}>
        <Tag className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && <BatchHangTagModal items={items} onClose={() => setOpen(false)} uiVariant={variant} />}
    </>
  )
}

function BatchHangTagModal({ items, onClose, uiVariant }: { items: BatchHangTagItem[]; onClose: () => void; uiVariant: 'default' | 'scanner' }) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [selectedSize, setSelectedSize] = useState<'klein' | 'mittel' | 'gross'>('mittel')
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {}
    items.forEach((item) => { q[item.sku] = item.qty || 1 })
    return q
  })

  const cfg = HANG_TAG_SIZE_CONFIG[selectedSize]
  const totalLabels = Object.values(quantities).reduce((s, q) => s + q, 0)
  const totalPages = Math.ceil(totalLabels / cfg.perPage)

  const SIZES = [
    { key: 'klein' as const,  label: 'Klein',  labelAr: '\u0635\u063a\u064a\u0631',  desc: '40\u00d770mm',  perPage: 16, use: { de: 'Schuhe', ar: '\u0623\u062d\u0630\u064a\u0629' } },
    { key: 'mittel' as const, label: 'Mittel', labelAr: '\u0645\u062a\u0648\u0633\u0637', desc: '55\u00d790mm',  perPage: 9,  use: { de: 'Kleidung', ar: '\u0645\u0644\u0627\u0628\u0633' } },
    { key: 'gross' as const,  label: 'Gro\u00df',  labelAr: '\u0643\u0628\u064a\u0631',  desc: '60\u00d7100mm', perPage: 6,  use: { de: 'M\u00e4ntel', ar: '\u0645\u0639\u0627\u0637\u0641' } },
  ]

  const handlePrint = () => {
    const allTags: Array<{ productName: string; color: string; size: string; sku: string; price: number }> = []
    items.forEach((item) => {
      const qty = quantities[item.sku] ?? 1
      for (let i = 0; i < qty; i++) {
        allTags.push({ productName: item.productName, color: item.color, size: item.size, sku: item.sku, price: item.price })
      }
    })
    openBatchHangTagPrintWindow(allTags, { size: selectedSize })
    onClose()
  }

  const updateQty = (sku: string, delta: number) => {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(0, Math.min(100, (prev[sku] ?? 1) + delta)) }))
  }

  const isDark = uiVariant === 'scanner'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-background rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col ${isDark ? 'bg-[#1a1a2e] text-white' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/10' : ''}`}>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#d4a853]" />
            <h3 className="text-lg font-bold">{t3('H\u00e4ngetiketten Batch-Druck', 'Hang Tags Batch Print', '\u0637\u0628\u0627\u0639\u0629 \u062f\u0641\u0639\u0629 \u0628\u0637\u0627\u0642\u0627\u062a \u0627\u0644\u062a\u0639\u0644\u064a\u0642')}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* Size Selection */}
        <div className="px-6 py-3 flex gap-2">
          {SIZES.map((s) => (
            <button key={s.key} onClick={() => setSelectedSize(s.key)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-center transition-all ${
                selectedSize === s.key ? 'bg-[#d4a853] text-white shadow-sm' : isDark ? 'bg-white/10 hover:bg-white/15 text-white/70' : 'bg-muted hover:bg-muted/80'
              }`}>
              {locale === 'ar' ? s.labelAr : s.label}<br />
              <span className="font-normal opacity-70">{s.desc} &middot; {s.perPage}/A4</span>
            </button>
          ))}
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-1">
          {items.map((item) => {
            const qty = quantities[item.sku] ?? 1
            return (
              <div key={item.sku} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${isDark ? 'bg-white/5' : 'bg-muted/30'} ${qty === 0 ? 'opacity-40' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{item.productName}</p>
                  <p className={`text-[10px] ${isDark ? 'text-white/40' : 'text-muted-foreground'}`}>{item.color} / {item.size} &middot; <span className="font-mono">{item.sku}</span> &middot; \u20ac{item.price.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => updateQty(item.sku, -1)} className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs ${isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-muted hover:bg-muted/80'}`}><Minus className="h-3 w-3" /></button>
                  <span className="w-6 text-center text-xs font-bold">{qty}</span>
                  <button onClick={() => updateQty(item.sku, 1)} className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs ${isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-muted hover:bg-muted/80'}`}><Plus className="h-3 w-3" /></button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t ${isDark ? 'border-white/10' : ''}`}>
          <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-xl ${isDark ? 'bg-[#d4a853]/15 border border-[#d4a853]/20' : 'bg-[#d4a853]/10 border border-[#d4a853]/20'}`}>
            <Printer className="h-3.5 w-3.5 text-[#d4a853] flex-shrink-0" />
            <p className="text-xs text-[#d4a853] font-medium">
              {t3(
                `${totalLabels} Etiketten werden auf ${totalPages} A4-Seite(n) gedruckt`,
                `${totalLabels} tags will be printed on ${totalPages} A4 page(s)`,
                `سيتم طباعة ${totalLabels} بطاقة على ${totalPages} صفحة A4`
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>{t3('Abbrechen', 'Cancel', '\u0625\u0644\u063a\u0627\u0621')}</Button>
            <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handlePrint} disabled={totalLabels === 0}>
              <Printer className="h-4 w-4" />{t3('Drucken', 'Print', '\u0637\u0628\u0627\u0639\u0629')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
