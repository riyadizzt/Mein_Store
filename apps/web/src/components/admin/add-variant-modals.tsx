'use client'

import { useState, useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Check, X, Palette, Search, Pipette } from 'lucide-react'
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
  { name: 'Bordeaux', hex: '#800020' }, { name: 'Khaki', hex: '#bdb76b' },
  { name: 'Silber', hex: '#c0c0c0' }, { name: 'Gold', hex: '#d4a853' },
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

  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedColor, setSelectedColor] = useState('')
  const [selectedHex, setSelectedHex] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [customColor, setCustomColor] = useState('')
  const [customHex, setCustomHex] = useState('#6b7280')
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set())
  const [stock, setStock] = useState<Record<string, number>>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const colorPickerRef = useRef<HTMLInputElement>(null)

  const { data: options } = useQuery({
    queryKey: ['variant-options', productId],
    queryFn: async () => { const { data } = await api.get(`/admin/products/${productId}/variant-options`); return data },
  })

  useEffect(() => {
    if (options?.sizes?.length && selectedSizes.size === 0) {
      setSelectedSizes(new Set(options.sizes))
    }
  }, [options?.sizes]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeSystem = detectSizeSystem(options?.sizes ?? [])
  const availableSizes = SIZE_SYSTEMS[sizeSystem] ?? SIZE_SYSTEMS.clothing
  const existingColors = new Set((options?.colors ?? []).map((c: any) => c.name))

  // Filter presets: exclude already used + match search
  const filteredColors = PRESET_COLORS.filter((c) => {
    if (existingColors.has(c.name)) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const localName = translateColor(c.name, locale).toLowerCase()
    return c.name.toLowerCase().includes(q) || localName.includes(q)
  })

  const selectPreset = (color: typeof PRESET_COLORS[0]) => {
    setSelectedColor(color.name)
    setSelectedHex(color.hex)
    setCustomColor('')
    setShowCustom(false)
    setShowDropdown(false)
    setSearchQuery('')
  }

  const addMut = useMutation({
    mutationFn: async () => {
      const color = showCustom ? customColor.trim() : selectedColor
      const hex = showCustom ? customHex : selectedHex
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
  const activeColor = showCustom ? customColor.trim() : selectedColor
  const activeHex = showCustom ? customHex : selectedHex
  const canSave = activeColor && selectedSizes.size > 0

  return (
    <Modal onClose={onClose}>
      <div className="text-center mb-5">
        <div className="h-12 w-12 rounded-full bg-[#d4a853]/10 flex items-center justify-center mx-auto mb-3"><Palette className="h-5 w-5 text-[#d4a853]" /></div>
        <h3 className="text-lg font-bold">{t('inventory.addNewColor')}</h3>
      </div>

      {/* ── Color Search + Picker ── */}
      <div className="mb-5">
        <label className="text-xs font-semibold mb-2 block uppercase tracking-wider text-muted-foreground">{t('inventory.selectColor')}</label>

        {/* Selected preview or search */}
        {activeColor && !showDropdown ? (
          <button
            onClick={() => { setShowDropdown(true); setTimeout(() => searchRef.current?.focus(), 50) }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all text-start"
          >
            <div className="h-8 w-8 rounded-full shadow-md border-2 border-white" style={{ backgroundColor: activeHex }} />
            <div className="flex-1">
              <div className="text-sm font-semibold">{translateColor(activeColor, locale)}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{activeHex}</div>
            </div>
            <span className="text-xs text-primary font-medium">{locale === 'ar' ? 'تغيير' : 'Ändern'}</span>
          </button>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true) }}
              onFocus={() => setShowDropdown(true)}
              placeholder={locale === 'ar' ? 'ابحث عن لون...' : 'Farbe suchen...'}
              className="w-full h-11 pl-10 rtl:pl-3 rtl:pr-10 pr-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              autoFocus
            />

            {/* Dropdown */}
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-xl shadow-xl z-10 max-h-[240px] overflow-y-auto" style={{ animation: 'fadeSlideUp 150ms ease-out' }}>
                {filteredColors.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => selectPreset(color)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-start"
                  >
                    <div className="h-6 w-6 rounded-full shadow-sm border" style={{ backgroundColor: color.hex }} />
                    <span className="text-sm font-medium flex-1">{translateColor(color.name, locale)}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{color.hex}</span>
                  </button>
                ))}
                {filteredColors.length === 0 && searchQuery && (
                  <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                    {locale === 'ar' ? 'لم يتم العثور على لون' : 'Keine Farbe gefunden'}
                  </div>
                )}
                {/* Custom color option */}
                <button
                  onClick={() => { setShowCustom(true); setShowDropdown(false); setSearchQuery(''); if (searchQuery) setCustomColor(searchQuery) }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-start border-t"
                >
                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-red-400 via-yellow-400 to-blue-400 flex items-center justify-center shadow-sm">
                    <Pipette className="h-3 w-3 text-white" />
                  </div>
                  <span className="text-sm font-medium text-primary">
                    {locale === 'ar' ? '+ لون مخصص...' : '+ Eigene Farbe...'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Custom color picker */}
        {showCustom && (
          <div className="mt-3 p-3 rounded-xl border bg-muted/10 space-y-3" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => colorPickerRef.current?.click()}
                className="h-10 w-10 rounded-xl border-2 shadow-sm cursor-pointer hover:scale-105 transition-transform flex-shrink-0"
                style={{ backgroundColor: customHex }}
              />
              <input ref={colorPickerRef} type="color" value={customHex} onChange={(e) => setCustomHex(e.target.value)} className="sr-only" />
              <Input
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                placeholder={locale === 'ar' ? 'اسم اللون...' : 'Farbname...'}
                className="rounded-xl text-sm flex-1 h-10"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono">{customHex}</span>
              <button onClick={() => { setShowCustom(false); setSelectedColor(''); setSelectedHex('') }} className="text-xs text-muted-foreground hover:text-foreground ml-auto">
                {locale === 'ar' ? 'إلغاء' : 'Abbrechen'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Size Selection ── */}
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

      {/* ── Stock per Size ── */}
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

      {/* ── Preview ── */}
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
  productId?: string
  variants: any[]
  locale: string
}

export function VariantMatrix({ productId, variants, locale }: VariantMatrixProps) {
  const qc = useQueryClient()

  const colors = [...new Map(variants.map((v: any) => [v.color, v.colorHex])).entries()]
  const sizes = [...new Set(variants.map((v: any) => v.size))]

  const getVariant = (color: string, size: string) => variants.find((v: any) => v.color === color && v.size === size)

  // Adjust existing inventory
  const adjustMut = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => { await api.patch(`/admin/inventory/${id}/adjust`, { quantity: qty, reason: 'Matrix edit' }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-product'] }); qc.invalidateQueries({ queryKey: ['admin-inventory'] }) },
  })

  // Create missing variant + set stock (when typing in a — cell)
  const createMut = useMutation({
    mutationFn: async ({ color, colorHex, size, stock }: { color: string; colorHex: string; size: string; stock: number }) => {
      if (!productId) return
      await api.post(`/admin/products/${productId}/variants/add-color`, {
        color, colorHex, sizes: [size], stock: { [size]: stock },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-product'] }); qc.invalidateQueries({ queryKey: ['admin-inventory'] }) },
  })

  if (colors.length === 0 || sizes.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30">
            <th className="px-3 py-2.5 text-start text-xs font-semibold text-muted-foreground">{locale === 'ar' ? 'اللون / المقاس' : 'Farbe / Größe'}</th>
            {sizes.map((size) => (
              <th key={size} className="px-2 py-2.5 text-center text-xs font-bold min-w-[60px]">{size}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map(([color, hex]) => (
            <tr key={color} className="border-t hover:bg-muted/10 transition-colors">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: hex as string }} />
                  <span className="text-xs font-medium">{translateColor(color as string, locale)}</span>
                </div>
              </td>
              {sizes.map((size) => {
                const v = getVariant(color as string, size)
                const inv = v?.inventory?.[0]
                const stock = v?.stock ?? (inv ? inv.quantityOnHand - (inv.quantityReserved ?? 0) : 0)
                return (
                  <td key={size} className="px-1 py-1.5 text-center">
                    {inv ? (
                      /* Existing variant with inventory — editable */
                      <input
                        type="number" min={0} defaultValue={inv.quantityOnHand}
                        className={`w-14 h-8 text-center text-xs font-bold rounded-lg border bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/30 ${stock <= 0 ? 'text-red-600 border-red-200' : stock <= 5 ? 'text-orange-600 border-orange-200' : 'text-green-600 border-muted'}`}
                        onBlur={(e) => { const val = parseInt(e.target.value); if (!isNaN(val) && val !== inv.quantityOnHand) adjustMut.mutate({ id: inv.id, qty: val }) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    ) : (
                      /* Missing variant — type a number to auto-create */
                      <input
                        type="number" min={0} placeholder="—"
                        className="w-14 h-8 text-center text-xs rounded-lg border border-dashed border-muted-foreground/20 bg-transparent text-muted-foreground/40 placeholder:text-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:text-foreground focus:font-bold"
                        onBlur={(e) => {
                          const val = parseInt(e.target.value)
                          if (!isNaN(val) && val > 0 && productId) {
                            createMut.mutate({ color: color as string, colorHex: hex as string, size, stock: val })
                            e.target.value = ''
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    )}
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
