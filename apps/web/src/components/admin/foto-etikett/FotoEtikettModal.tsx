'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { X, Printer, Minus, Plus, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openFotoEtikettPrintWindow, SIZE_CONFIG } from './FotoEtikettDruck'
import type { FotoEtikettData } from './FotoEtikettDruck'

interface FotoEtikettVariant {
  sku: string
  color: string
  colorHex: string
  size: string
  price: number
  imageUrl: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  variant: FotoEtikettVariant
  productName: string
  categoryStripe: 'herren' | 'damen' | 'kinder' | 'unisex'
}

const STRIPE_COLORS: Record<string, { color: string; label: string; labelAr: string }> = {
  herren: { color: '#DC2626', label: 'Herren', labelAr: 'رجالي' },
  damen:  { color: '#2563EB', label: 'Damen', labelAr: 'نسائي' },
  kinder: { color: '#16A34A', label: 'Kinder', labelAr: 'أطفال' },
  unisex: { color: '#6B7280', label: 'Unisex', labelAr: 'للجنسين' },
}

const SIZES = [
  { key: 'klein' as const,  label: 'Klein',  labelAr: 'صغير',  desc: '30\u00d730mm',  perPage: 54, use: { de: 'Schuhe', ar: 'أحذية' } },
  { key: 'mittel' as const, label: 'Mittel', labelAr: 'متوسط', desc: '50\u00d735mm',  perPage: 32, use: { de: 'Kleidung', ar: 'ملابس' } },
  { key: 'gross' as const,  label: 'Gro\u00df',  labelAr: 'كبير',  desc: '50\u00d750mm',  perPage: 20, use: { de: 'Kartons', ar: 'صناديق' } },
]

export function FotoEtikettButton({ variant, productName, categoryStripe, className }: {
  variant: FotoEtikettVariant; productName: string; categoryStripe: 'herren' | 'damen' | 'kinder' | 'unisex'; className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className={className} title="Foto-Etikett">
        <ImageIcon className="h-3.5 w-3.5" />
      </button>
      {open && <FotoEtikettModal open={open} onClose={() => setOpen(false)} variant={variant} productName={productName} categoryStripe={categoryStripe} />}
    </>
  )
}

export function FotoEtikettModal({ open, onClose, variant, productName, categoryStripe }: Props) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [selectedSize, setSelectedSize] = useState<'klein' | 'mittel' | 'gross'>('mittel')
  const [copies, setCopies] = useState(1)

  if (!open) return null

  const stripe = STRIPE_COLORS[categoryStripe] || STRIPE_COLORS.unisex
  const cfg = SIZE_CONFIG[selectedSize]
  const totalPages = Math.ceil(copies / cfg.perPage)

  const handlePrint = () => {
    const data: FotoEtikettData = {
      productName, color: variant.color, colorHex: variant.colorHex,
      size: variant.size, sku: variant.sku, price: variant.price,
      imageUrl: variant.imageUrl, categoryStripe,
    }
    openFotoEtikettPrintWindow(data, { size: selectedSize, copies })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-[#d4a853]" />
            <h3 className="text-lg font-bold">{t3('Foto-Etikett drucken', 'Print Photo Label', 'طباعة ملصق صورة')}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        {/* Product Info + Preview */}
        <div className="px-6 py-3 bg-muted/30 flex items-center gap-4">
          {variant.imageUrl ? (
            <img src={variant.imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover border" />
          ) : (
            <div className="h-14 w-14 rounded-lg flex items-center justify-center" style={{ backgroundColor: variant.colorHex || '#ccc' }}>
              <span className="text-white font-bold text-lg">{productName.charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{productName}</p>
            <p className="text-sm text-muted-foreground">{variant.color} / {variant.size}</p>
            <p className="text-xs text-muted-foreground font-mono">{variant.sku}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-3 h-6 rounded-sm" style={{ backgroundColor: stripe.color }} />
            <span className="text-xs text-muted-foreground">{locale === 'ar' ? stripe.labelAr : stripe.label}</span>
          </div>
        </div>

        {/* Size Selection */}
        <div className="px-6 py-4 space-y-3">
          <label className="text-sm font-semibold text-muted-foreground">{t3('Etikettgr\u00f6\u00dfe', 'Label Size', 'حجم الملصق')}</label>
          <div className="space-y-2">
            {SIZES.map((s) => (
              <label
                key={s.key}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                  selectedSize === s.key ? 'border-[#d4a853] bg-[#d4a853]/5 ring-1 ring-[#d4a853]' : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <input type="radio" name="etikettSize" checked={selectedSize === s.key} onChange={() => setSelectedSize(s.key)} className="sr-only" />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  selectedSize === s.key ? 'border-[#d4a853]' : 'border-muted-foreground/40'
                }`}>
                  {selectedSize === s.key && <div className="w-2 h-2 rounded-full bg-[#d4a853]" />}
                </div>
                <div className="flex-1">
                  <span className="text-sm font-semibold">{locale === 'ar' ? s.labelAr : s.label}</span>
                  <span className="text-xs text-muted-foreground ltr:ml-2 rtl:mr-2">{s.desc}</span>
                </div>
                <div className="text-end">
                  <span className="text-xs text-muted-foreground">{s.perPage} / A4</span>
                  <span className="text-xs text-muted-foreground block">{locale === 'ar' ? s.use.ar : s.use.de}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Copies */}
        <div className="px-6 py-3">
          <label className="text-sm font-semibold text-muted-foreground mb-2 block">{t3('Kopien', 'Copies', 'نسخ')}</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setCopies((c) => Math.max(1, c - 1))} className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-muted"><Minus className="h-4 w-4" /></button>
            <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              className="h-10 w-20 rounded-xl border text-center text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#d4a853] bg-background" dir="ltr" />
            <button onClick={() => setCopies((c) => Math.min(100, c + 1))} className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-muted"><Plus className="h-4 w-4" /></button>
            <span className="text-xs text-muted-foreground">(max. 100)</span>
          </div>
          {/* Page count hint */}
          <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl bg-[#d4a853]/10 border border-[#d4a853]/20">
            <Printer className="h-3.5 w-3.5 text-[#d4a853] flex-shrink-0" />
            <p className="text-xs text-[#d4a853] font-medium">
              {t3(
                `${copies} Etiketten werden auf ${totalPages} A4-Seite(n) gedruckt`,
                `${copies} labels will be printed on ${totalPages} A4 page(s)`,
                `سيتم طباعة ${copies} ملصق على ${totalPages} صفحة A4`
              )}
            </p>
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
