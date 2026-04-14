'use client'

import { useTranslations, useLocale } from 'next-intl'
import { translateColor } from '@/lib/locale-utils'
import { compareSizes } from '@/lib/sizes'

interface Variant {
  id: string
  sku: string
  color?: string
  colorHex?: string
  size?: string
  isActive: boolean
  priceModifier: number
  stock?: number
  isInStock?: boolean
  _stock?: { available: number }
}

interface VariantSelectorProps {
  variants: Variant[]
  selectedVariantId: string | null
  onSelect: (variantId: string) => void
}

function getStock(v: Variant): number {
  return (v as any).stock ?? v._stock?.available ?? 0
}

export function VariantSelector({ variants, selectedVariantId, onSelect }: VariantSelectorProps) {
  const t = useTranslations('product')
  const locale = useLocale()

  // Extract unique colors and sizes
  const colors = [...new Map(
    variants
      .filter((v) => v.color)
      .map((v) => [v.color, { color: v.color!, hex: v.colorHex }]),
  ).values()]

  const sizes = [...new Set(variants.filter((v) => v.size).map((v) => v.size!))].sort(compareSizes)

  const selected = variants.find((v) => v.id === selectedVariantId)
  const selectedColor = selected?.color
  const selectedSize = selected?.size

  const findVariant = (color?: string, size?: string) => {
    return variants.find(
      (v) =>
        (color ? v.color === color : true) &&
        (size ? v.size === size : true) &&
        v.isActive,
    )
  }

  // A color/size is "available" if ANY active variant with that color/size has stock,
  // independent of the currently selected counterpart. Click handlers below auto-switch
  // to a matching variant. Otherwise sizes that exist in other colors get falsely greyed.
  const isColorAvailable = (color: string) =>
    variants.some((v) => v.color === color && v.isActive && getStock(v) > 0)
  const isSizeAvailable = (size: string) =>
    variants.some((v) => v.size === size && v.isActive && getStock(v) > 0)

  // Prefer stocked variants in click handlers, otherwise picking a color can land on
  // a 0-stock variant when an in-stock one exists for the same color.
  const findStockedVariant = (color?: string, size?: string) =>
    variants.find(
      (v) =>
        (color ? v.color === color : true) &&
        (size ? v.size === size : true) &&
        v.isActive &&
        getStock(v) > 0,
    )

  return (
    <div className="space-y-5">
      {/* Color Selection */}
      {colors.length > 0 && (
        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('color')}: <span className="text-muted-foreground font-normal">{selectedColor ? translateColor(selectedColor, locale) : ''}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {colors.map(({ color, hex }) => {
              const available = isColorAvailable(color)
              const isSelected = selectedColor === color

              return (
                <button
                  key={color}
                  onClick={() => {
                    const v =
                      findStockedVariant(color, selectedSize) ??
                      findStockedVariant(color) ??
                      findVariant(color, selectedSize) ??
                      findVariant(color)
                    if (v) onSelect(v.id)
                  }}
                  disabled={!available}
                  title={`${translateColor(color, locale)}${!available ? ` (${t('outOfStock')})` : ''}`}
                  className={`relative h-11 w-11 rounded-full border-2 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-foreground/50'
                  } ${!available ? 'opacity-40 cursor-not-allowed' : ''}`}
                  aria-label={translateColor(color, locale)}
                >
                  <span
                    className="absolute inset-1 rounded-full"
                    style={{ backgroundColor: hex ?? color?.toLowerCase() ?? '#ccc' }}
                  />
                  {!available && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-full h-0.5 bg-muted-foreground/60 rotate-45 absolute" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Size Selection */}
      {sizes.length > 0 && (
        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('size')}: <span className="text-muted-foreground font-normal">{selectedSize}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const available = isSizeAvailable(size)
              const isSelected = selectedSize === size

              return (
                <button
                  key={size}
                  onClick={() => {
                    const v =
                      findStockedVariant(selectedColor, size) ??
                      findStockedVariant(undefined, size) ??
                      findVariant(selectedColor, size) ??
                      findVariant(undefined, size)
                    if (v) onSelect(v.id)
                  }}
                  disabled={!available}
                  className={`h-11 min-w-[2.75rem] px-3 rounded-lg border text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-foreground/50'
                  } ${!available ? 'opacity-40 cursor-not-allowed line-through' : ''}`}
                  aria-label={`${t('size')} ${size}`}
                >
                  {size}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
