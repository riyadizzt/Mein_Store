'use client'

import { useState, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, X, Palette } from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PRESET_COLORS = [
  { name: 'Schwarz', hex: '#000000' }, { name: 'Weiß', hex: '#ffffff' },
  { name: 'Blau', hex: '#2563eb' }, { name: 'Rot', hex: '#dc2626' },
  { name: 'Grün', hex: '#16a34a' }, { name: 'Grau', hex: '#6b7280' },
  { name: 'Beige', hex: '#d2b48c' }, { name: 'Navy', hex: '#1e3a5f' },
  { name: 'Braun', hex: '#8b4513' }, { name: 'Rosa', hex: '#ec4899' },
  { name: 'Gelb', hex: '#eab308' }, { name: 'Orange', hex: '#f97316' },
  { name: 'Lila', hex: '#9333ea' }, { name: 'Türkis', hex: '#06b6d4' },
]

const SIZE_SYSTEMS: Record<string, string[]> = {
  clothing: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  kids: ['50', '56', '62', '68', '74', '80', '86', '92', '98', '104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164'],
}

function detectSizeSystem(existingSizes: string[]): string {
  if (!existingSizes.length) return 'clothing'
  const first = existingSizes[0]
  if (/^\d{2,3}$/.test(first)) {
    const num = parseInt(first)
    if (num >= 36 && num <= 46) return 'shoes'
    if (num >= 50 && num <= 164) return 'kids'
  }
  return 'clothing'
}

// ── ADD COLOR MODAL ──────────────────────────────────────

interface AddColorModalProps {
  productId: string
  onClose: () => void
  onSuccess?: () => void
}

export function AddColorModal({ productId, onClose, onSuccess }: AddColorModalProps) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  const [selectedColor, setSelectedColor] = useState('')
  const [selectedHex, setSelectedHex] = useState('')
  const [customColor, setCustomColor] = useState('')
  const [customHex, setCustomHex] = useState('#000000')
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set())
  const [stock, setStock] = useState<Record<string, number>>({})

  const { data: options } = useQuery({
    queryKey: ['variant-options', productId],
    queryFn: async () => { const { data } = await api.get(`/admin/products/${productId}/variant-options`); return data },
  })

  // Pre-select existing sizes when options load
  useEffect(() => {
    if (options?.sizes?.length && selectedSizes.size === 0) {
      setSelectedSizes(new Set(options.sizes))
    }
  }, [options?.sizes]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeSystem = detectSizeSystem(options?.sizes ?? [])
  const availableSizes = SIZE_SYSTEMS[sizeSystem] ?? SIZE_SYSTEMS.clothing

  const addMut = useMutation({
    mutationFn: async () => {
      const color = customColor.trim() || selectedColor
      const hex = customColor.trim() ? customHex : selectedHex
      if (!color || selectedSizes.size === 0) return
      await api.post(`/admin/products/${productId}/variants/add-color`, {
        color, colorHex: hex, sizes: [...selectedSizes], stock,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['admin-products'] })
      qc.invalidateQueries({ queryKey: ['admin-product'] })
      onSuccess?.(); onClose()
    },
  })

  const toggleSize = (size: string) => { const n = new Set(selectedSizes); n.has(size) ? n.delete(size) : n.add(size); setSelectedSizes(n) }
  const activeColor = customColor.trim() || selectedColor
  const activeHex = customColor.trim() ? customHex : selectedHex
  const canSave = activeColor && selectedSizes.size > 0

  return (
    <Modal onClose={onClose}>
      <div className="text-center mb-5">
        <div className="h-12 w-12 rounded-full bg-[#d4a853]/10 flex items-center justify-center mx-auto mb-3"><Palette className="h-5 w-5 text-[#d4a853]" /></div>
        <h3 className="text-lg font-bold">{t('inventory.addNewColor')}</h3>
      </div>

      {/* Color Selection */}
      <div className="mb-4">
        <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.selectColor')}</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESET_COLORS.filter((c) => !options?.colors?.some((oc: any) => oc.name === c.name)).map((color) => (
            <button key={color.name} onClick={() => { setSelectedColor(color.name); setSelectedHex(color.hex); setCustomColor('') }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${selectedColor === color.name && !customColor ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-muted-foreground/15 hover:border-muted-foreground/30'}`}>
              <div className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: color.hex }} />
              {translateColor(color.name, locale)}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <Input value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder={t('inventory.colorName')} className="rounded-xl text-sm flex-1" />
          <input type="color" value={customHex} onChange={(e) => setCustomHex(e.target.value)} className="h-9 w-9 rounded-lg border cursor-pointer" />
        </div>
      </div>

      {/* Size Selection */}
      <div className="mb-4">
        <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.selectSizes')}</label>
        <div className="flex flex-wrap gap-1.5">
          {availableSizes.map((size) => (
            <button key={size} onClick={() => toggleSize(size)}
              className={`h-9 min-w-[36px] px-2 rounded-lg text-xs font-bold transition-all ${selectedSizes.has(size) ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Stock per Size */}
      {selectedSizes.size > 0 && (
        <div className="mb-4">
          <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.stockPerSize')}</label>
          <div className="grid grid-cols-4 gap-2">
            {[...selectedSizes].sort().map((size) => (
              <div key={size} className="text-center">
                <div className="text-[10px] text-muted-foreground mb-1 font-medium">{size}</div>
                <Input type="number" min={0} value={stock[size] ?? ''} onChange={(e) => setStock({ ...stock, [size]: +e.target.value })}
                  className="rounded-lg text-center h-8 text-sm" placeholder="0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {canSave && (
        <div className="mb-4 p-3 rounded-xl bg-muted/20 border border-muted flex items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-white shadow" style={{ backgroundColor: activeHex }} />
          <div>
            <div className="text-sm font-semibold">{translateColor(activeColor, locale)}</div>
            <div className="text-[11px] text-muted-foreground">{selectedSizes.size} {t('inventory.variant')}: {[...selectedSizes].sort().join(', ')}</div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>{t('inventory.cancel')}</Button>
        <Button className="flex-1 rounded-xl gap-2" disabled={!canSave || addMut.isPending} onClick={() => addMut.mutate()}>
          {addMut.isPending ? '...' : <><Plus className="h-4 w-4" />{t('inventory.save')}</>}
        </Button>
      </div>
    </Modal>
  )
}

// ── ADD SIZE MODAL ───────────────────────────────────────

interface AddSizeModalProps {
  productId: string
  onClose: () => void
  onSuccess?: () => void
}

export function AddSizeModal({ productId, onClose, onSuccess }: AddSizeModalProps) {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  const [selectedSize, setSelectedSize] = useState('')
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set())
  const [stock, setStock] = useState<Record<string, number>>({})

  const { data: options } = useQuery({
    queryKey: ['variant-options', productId],
    queryFn: async () => { const { data } = await api.get(`/admin/products/${productId}/variant-options`); return data },
  })

  // Pre-select all existing colors when options load
  useEffect(() => {
    if (options?.colors?.length && selectedColors.size === 0) {
      setSelectedColors(new Set(options.colors.map((c: any) => c.name)))
    }
  }, [options?.colors]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeSystem = detectSizeSystem(options?.sizes ?? [])
  const allSizes = SIZE_SYSTEMS[sizeSystem] ?? SIZE_SYSTEMS.clothing
  const existingSizes = new Set(options?.sizes ?? [])
  const availableSizes = allSizes.filter((s) => !existingSizes.has(s))

  const addMut = useMutation({
    mutationFn: async () => {
      if (!selectedSize || selectedColors.size === 0) return
      await api.post(`/admin/products/${productId}/variants/add-size`, {
        size: selectedSize, colors: [...selectedColors], stock,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['admin-products'] })
      qc.invalidateQueries({ queryKey: ['admin-product'] })
      onSuccess?.(); onClose()
    },
  })

  const toggleColor = (color: string) => { const n = new Set(selectedColors); n.has(color) ? n.delete(color) : n.add(color); setSelectedColors(n) }
  const canSave = selectedSize && selectedColors.size > 0

  return (
    <Modal onClose={onClose}>
      <div className="text-center mb-5">
        <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3"><Plus className="h-5 w-5 text-blue-600" /></div>
        <h3 className="text-lg font-bold">{t('inventory.addNewSize')}</h3>
      </div>

      {/* Size Selection */}
      <div className="mb-4">
        <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.selectSize')}</label>
        <div className="flex flex-wrap gap-1.5">
          {availableSizes.map((size) => (
            <button key={size} onClick={() => setSelectedSize(size)}
              className={`h-9 min-w-[36px] px-2 rounded-lg text-xs font-bold transition-all ${selectedSize === size ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
              {size}
            </button>
          ))}
          {availableSizes.length === 0 && <p className="text-xs text-muted-foreground py-2">{t('inventory.allOk')}</p>}
        </div>
        {/* Custom size */}
        <div className="flex gap-2 mt-2">
          <Input placeholder={locale === 'ar' ? 'مقاس مخصص...' : 'Custom size...'} className="rounded-lg text-xs max-w-[140px] h-8"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { setSelectedSize(v); (e.target as HTMLInputElement).value = '' } } }} />
        </div>
      </div>

      {/* Color Selection */}
      {selectedSize && (options?.colors?.length ?? 0) > 0 && (
        <div className="mb-4">
          <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.selectColors')}</label>
          <div className="flex flex-wrap gap-1.5">
            {(options?.colors ?? []).map((color: any) => (
              <button key={color.name} onClick={() => toggleColor(color.name)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${selectedColors.has(color.name) ? 'border-primary bg-primary/5' : 'border-muted-foreground/15'}`}>
                <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: color.hex }} />
                {translateColor(color.name, locale)}
                {selectedColors.has(color.name) && <Check className="h-3 w-3 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stock per Color */}
      {selectedSize && selectedColors.size > 0 && (
        <div className="mb-4">
          <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.stockPerColor')}</label>
          <div className="space-y-2">
            {[...selectedColors].map((color) => {
              const hex = (options?.colors ?? []).find((c: any) => c.name === color)?.hex ?? '#999'
              return (
                <div key={color} className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full border" style={{ backgroundColor: hex }} />
                  <span className="text-xs font-medium flex-1">{translateColor(color, locale)}</span>
                  <Input type="number" min={0} value={stock[color] ?? ''} onChange={(e) => setStock({ ...stock, [color]: +e.target.value })}
                    className="w-20 rounded-lg text-center h-8 text-sm" placeholder="0" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>{t('inventory.cancel')}</Button>
        <Button className="flex-1 rounded-xl gap-2" disabled={!canSave || addMut.isPending} onClick={() => addMut.mutate()}>
          {addMut.isPending ? '...' : <><Plus className="h-4 w-4" />{t('inventory.save')}</>}
        </Button>
      </div>
    </Modal>
  )
}

// ── VARIANT MATRIX ───────────────────────────────────────

interface VariantMatrixProps {
  variants: any[]
  locale: string
}

export function VariantMatrix({ variants, locale }: VariantMatrixProps) {
  const qc = useQueryClient()

  // Build matrix: colors × sizes
  const colors = [...new Map(variants.map((v: any) => [v.color, v.colorHex])).entries()]
  const sizes = [...new Set(variants.map((v: any) => v.size))]

  const getVariant = (color: string, size: string) => variants.find((v: any) => v.color === color && v.size === size)

  const quickMut = useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: number }) => { await api.patch(`/admin/inventory/${id}/quick`, { delta }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-inventory'] }) },
  })

  if (colors.length <= 1 || sizes.length <= 1) return null

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30">
            <th className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground"></th>
            {sizes.map((size) => (
              <th key={size} className="px-3 py-2 text-center text-xs font-bold">{size}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map(([color, hex]) => (
            <tr key={color} className="border-t hover:bg-muted/10 transition-colors">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: hex }} />
                  <span className="text-xs font-medium">{translateColor(color, locale)}</span>
                </div>
              </td>
              {sizes.map((size) => {
                const v = getVariant(color, size)
                if (!v) return <td key={size} className="px-3 py-2 text-center text-muted-foreground/30">—</td>
                const stock = v.stock ?? 0
                const inv = v.inventory?.[0]
                return (
                  <td key={size} className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      {inv && <button onClick={() => quickMut.mutate({ id: inv.id, delta: -1 })} className="h-5 w-5 rounded bg-muted hover:bg-red-100 flex items-center justify-center text-[10px] opacity-50 hover:opacity-100">-</button>}
                      <span className={`font-bold text-xs min-w-[20px] ${stock <= 0 ? 'text-red-600' : stock <= 5 ? 'text-orange-600' : 'text-green-600'}`}>{stock}</span>
                      {inv && <button onClick={() => quickMut.mutate({ id: inv.id, delta: 1 })} className="h-5 w-5 rounded bg-muted hover:bg-green-100 flex items-center justify-center text-[10px] opacity-50 hover:opacity-100">+</button>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── SHARED MODAL WRAPPER ─────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'fadeIn 200ms ease-out' }} />
      <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
        <button onClick={onClose} className="absolute top-4 right-4 rtl:right-auto rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
        {children}
      </div>
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}
