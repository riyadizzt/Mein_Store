'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { X, Printer, Minus, Plus, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openHangTagPrintWindow } from './HaengetikettenDruck'

interface HangTagVariant {
  sku: string
  color: string
  size: string
  price: number
}

interface Props {
  open: boolean
  onClose: () => void
  variant: HangTagVariant
  productName: string
}

const SIZES = [
  { key: 'klein' as const,  w: 40,  h: 70,  label: 'Klein',  labelAr: 'صغير',  desc: '40×70mm',  use: { de: 'Schuhe', en: 'Shoes', ar: 'أحذية' } },
  { key: 'mittel' as const, w: 55,  h: 90,  label: 'Mittel', labelAr: 'متوسط', desc: '55×90mm',  use: { de: 'Kleidung', en: 'Clothing', ar: 'ملابس' } },
  { key: 'gross' as const,  w: 60,  h: 100, label: 'Gro\u00df',  labelAr: 'كبير',  desc: '60×100mm', use: { de: 'M\u00e4ntel', en: 'Coats', ar: 'معاطف' } },
]

export function HaengetikettenButton({ variant, productName, className }: { variant: HangTagVariant; productName: string; className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} className={className} title="Hängetikett">
        <Tag className="h-3.5 w-3.5" />
      </button>
      {open && <HaengetikettenModal open={open} onClose={() => setOpen(false)} variant={variant} productName={productName} />}
    </>
  )
}

export function HaengetikettenModal({ open, onClose, variant, productName }: Props) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [selectedSize, setSelectedSize] = useState<'klein' | 'mittel' | 'gross'>('mittel')
  const [copies, setCopies] = useState(1)

  if (!open) return null

  const handlePrint = () => {
    openHangTagPrintWindow(
      { productName, color: variant.color, size: variant.size, sku: variant.sku, price: variant.price },
      { size: selectedSize, copies },
    )
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#d4a853]" />
            <h3 className="text-lg font-bold">{t3('Hängetikett drucken', 'Print Hang Tag', 'طباعة بطاقة التعليق')}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* Product Info */}
        <div className="px-6 py-3 bg-muted/30 text-sm">
          <p className="font-semibold">{productName}</p>
          <p className="text-muted-foreground">{variant.color} / {variant.size} &middot; <span className="font-mono">{variant.sku}</span></p>
        </div>

        {/* Size Selection */}
        <div className="px-6 py-4 space-y-3">
          <label className="text-sm font-semibold text-muted-foreground">{t3('Größe wählen', 'Select Size', 'اختر الحجم')}</label>
          <div className="space-y-2">
            {SIZES.map((s) => (
              <label
                key={s.key}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                  selectedSize === s.key ? 'border-[#d4a853] bg-[#d4a853]/5 ring-1 ring-[#d4a853]' : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <input
                  type="radio"
                  name="tagSize"
                  checked={selectedSize === s.key}
                  onChange={() => setSelectedSize(s.key)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  selectedSize === s.key ? 'border-[#d4a853]' : 'border-muted-foreground/40'
                }`}>
                  {selectedSize === s.key && <div className="w-2 h-2 rounded-full bg-[#d4a853]" />}
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold">{locale === 'ar' ? s.labelAr : s.label}</span>
                  <span className="text-xs text-muted-foreground ltr:ml-2 rtl:mr-2">{s.desc}</span>
                </div>
                <span className="text-xs text-muted-foreground">{s.use[locale as 'de' | 'en' | 'ar'] ?? s.use.de}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Copies */}
        <div className="px-6 py-3">
          <label className="text-sm font-semibold text-muted-foreground mb-2 block">{t3('Kopien', 'Copies', 'نسخ')}</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCopies((c) => Math.max(1, c - 1))}
              className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
              className="h-10 w-20 rounded-xl border text-center text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#d4a853] bg-background"
              dir="ltr"
            />
            <button
              onClick={() => setCopies((c) => Math.min(50, c + 1))}
              className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">(max. 50)</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {t3('Abbrechen', 'Cancel', 'إلغاء')}
          </Button>
          <Button className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            {t3('Drucken', 'Print', 'طباعة')}
          </Button>
        </div>
      </div>
    </div>
  )
}
