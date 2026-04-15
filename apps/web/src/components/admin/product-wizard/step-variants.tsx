'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, Plus, X, Palette } from 'lucide-react'
import { useProductWizardStore } from '@/store/product-wizard-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { COLOR_PRESETS, getColorStyle } from '@/lib/color-presets'

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']

// Flattened from the shared preset list — the wizard stores the DE name
// as the canonical identifier on each color entry.
const PRESET_COLORS = COLOR_PRESETS.map((c) => ({
  name: c.name.de,
  hex: c.hex,
  labels: c.name,
}))

export function StepVariants() {
  const t = useTranslations('admin')
  const {
    colors, variants,
    addColor, removeColor, updateColorSizes, generateVariants, updateVariant,
    bulkSetPrice, bulkSetStock, setStep,
  } = useProductWizardStore()

  const [newColorName, setNewColorName] = useState('')
  const [newColorHex, setNewColorHex] = useState('#000000')
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkStockQty, setBulkStockQty] = useState('')

  const handleAddColor = () => {
    if (!newColorName.trim()) return
    addColor({ name: newColorName.trim(), hex: newColorHex, sizes: ['S', 'M', 'L'] })
    setNewColorName('')
    setNewColorHex('#000000')
  }

  const handleToggleSize = (colorId: string, size: string) => {
    const color = colors.find((c) => c.id === colorId)
    if (!color) return
    const newSizes = color.sizes.includes(size)
      ? color.sizes.filter((s) => s !== size)
      : [...color.sizes, size]
    updateColorSizes(colorId, newSizes)
  }

  const handleGenerateAndNext = () => {
    generateVariants()
    // Show variant table after generation
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('wizard.variants')}</h2>
        <p className="text-sm text-muted-foreground">{t('wizard.variantsDesc')}</p>
      </div>

      {/* Color List */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Palette className="h-4 w-4" />{t('wizard.colors')} ({colors.length})</h3>

        {colors.map((color) => (
          <div key={color.id} className="border rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-8 w-8 rounded-full border-2" style={getColorStyle(color.hex)} />
              <span className="font-medium text-sm flex-1">{color.name}</span>
              <button onClick={() => removeColor(color.id)} className="text-destructive hover:bg-destructive/10 p-1 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Size Toggles */}
            <div className="flex flex-wrap gap-2">
              {ALL_SIZES.map((size) => {
                const active = color.sizes.includes(size)
                return (
                  <button
                    key={size}
                    onClick={() => handleToggleSize(color.id, size)}
                    className={`h-9 min-w-[2.5rem] px-3 rounded-lg border text-xs font-medium transition-all ${
                      active ? 'bg-primary text-primary-foreground border-primary' : 'hover:border-foreground/30'
                    }`}
                  >
                    {size}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Add Color */}
        <div className="border-2 border-dashed rounded-lg p-4">
          <p className="text-sm font-medium mb-3">{t('wizard.addColor')}</p>

          {/* Preset Colors */}
          <div className="flex flex-wrap gap-2 mb-4">
            {PRESET_COLORS.filter((pc) => !colors.some((c) => c.name === pc.name)).map((pc) => (
              <button
                key={pc.name}
                onClick={() => { addColor({ name: pc.name, hex: pc.hex, sizes: ['S', 'M', 'L'] }) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs hover:bg-muted transition-colors"
              >
                <div className="h-3.5 w-3.5 rounded-full border" style={getColorStyle(pc.hex)} />
                {pc.name}
              </button>
            ))}
          </div>

          {/* Custom Color */}
          <div className="flex gap-2">
            <Input
              value={newColorName}
              onChange={(e) => setNewColorName(e.target.value)}
              placeholder="Farbname..."
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleAddColor()}
            />
            <input
              type="color"
              value={newColorHex}
              onChange={(e) => setNewColorHex(e.target.value)}
              className="h-10 w-14 rounded-lg border cursor-pointer"
            />
            <Button onClick={handleAddColor} size="sm" variant="outline" className="gap-1">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Generate Variants Button */}
      {colors.length > 0 && colors.some((c) => c.sizes.length > 0) && (
        <Button onClick={handleGenerateAndNext} variant="outline" className="w-full">
          {t('wizard.generateVariants')} ({colors.reduce((s, c) => s + c.sizes.length, 0)} {t('wizard.combinations')})
        </Button>
      )}

      {/* Variant Table */}
      {variants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{variants.length} {t('wizard.variantsCount')}</h3>
            <div className="flex gap-2">
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder={t('wizard.priceForAll')}
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  className="w-32 h-8 text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { if (bulkPrice) bulkSetPrice(Number(bulkPrice)) }}>
                  {t('wizard.set')}
                </Button>
              </div>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder={t('wizard.stockForAll')}
                  value={bulkStockQty}
                  onChange={(e) => setBulkStockQty(e.target.value)}
                  className="w-32 h-8 text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { if (bulkStockQty) bulkSetStock('default', Number(bulkStockQty)) }}>
                  {t('wizard.set')}
                </Button>
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-start px-3 py-2 font-medium">{t('wizard.colors')}</th>
                    <th className="text-start px-3 py-2 font-medium">{t('wizard.variants')}</th>
                    <th className="text-start px-3 py-2 font-medium">SKU</th>
                    <th className="text-end px-3 py-2 font-medium">{t('wizard.basePrice')}</th>
                    <th className="text-end px-3 py-2 font-medium">{t('wizard.weight')}</th>
                    <th className="text-end px-3 py-2 font-medium">{t('wizard.stockCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={`${v.colorId}-${v.size}`} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: v.colorHex }} />
                          <span className="text-xs">{v.colorName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-medium">{v.size}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={v.sku}
                          onChange={(e) => updateVariant(v.colorId, v.size, { sku: e.target.value })}
                          className="h-7 text-xs font-mono w-40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={v.price || ''}
                          onChange={(e) => updateVariant(v.colorId, v.size, { price: Number(e.target.value) })}
                          className="h-7 text-xs w-24 text-end"
                          step={0.01}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={v.weight || ''}
                          onChange={(e) => updateVariant(v.colorId, v.size, { weight: Number(e.target.value) })}
                          className="h-7 text-xs w-20 text-end"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={v.stock.default ?? ''}
                          onChange={(e) => updateVariant(v.colorId, v.size, { stock: { ...v.stock, default: Number(e.target.value) } })}
                          className="h-7 text-xs w-20 text-end"
                          min={0}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep('basics')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t('wizard.back')}
        </Button>
        <Button onClick={() => setStep('images')} disabled={variants.length === 0} size="lg" className="gap-2">
          {t('wizard.nextImages')} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
