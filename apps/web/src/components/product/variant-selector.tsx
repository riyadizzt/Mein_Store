'use client'

import { useTranslations } from 'next-intl'

interface Variant {
  id: string
  sku: string
  color?: string
  colorHex?: string
  size?: string
  isActive: boolean
  priceModifier: number
  _stock?: { available: number }
}

interface VariantSelectorProps {
  variants: Variant[]
  selectedVariantId: string | null
  onSelect: (variantId: string) => void
}

export function VariantSelector({ variants, selectedVariantId, onSelect }: VariantSelectorProps) {
  const t = useTranslations('product')

  // Extract unique colors and sizes
  const colors = [...new Map(
    variants
      .filter((v) => v.color)
      .map((v) => [v.color, { color: v.color!, hex: v.colorHex }]),
  ).values()]

  const sizes = [...new Set(variants.filter((v) => v.size).map((v) => v.size!))]

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

  const isAvailable = (color?: string, size?: string) => {
    const v = findVariant(color, size)
    return v && v.isActive && (v._stock?.available ?? 1) > 0
  }

  return (
    <div className="space-y-5">
      {/* Color Selection */}
      {colors.length > 0 && (
        <div>
          <label className="text-sm font-medium mb-2 block">
            {t('color')}: <span className="text-muted-foreground font-normal">{selectedColor}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {colors.map(({ color, hex }) => {
              const available = isAvailable(color, selectedSize)
              const isSelected = selectedColor === color

              return (
                <button
                  key={color}
                  onClick={() => {
                    const v = findVariant(color, selectedSize) ?? findVariant(color)
                    if (v) onSelect(v.id)
                  }}
                  disabled={!available}
                  title={color}
                  className={`relative h-9 w-9 rounded-full border-2 transition-all ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-foreground/50'
                  } ${!available ? 'opacity-40 cursor-not-allowed' : ''}`}
                  aria-label={color}
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
              const available = isAvailable(selectedColor, size)
              const isSelected = selectedSize === size

              return (
                <button
                  key={size}
                  onClick={() => {
                    const v = findVariant(selectedColor, size) ?? findVariant(undefined, size)
                    if (v) onSelect(v.id)
                  }}
                  disabled={!available}
                  className={`h-10 min-w-[2.5rem] px-3 rounded-lg border text-sm font-medium transition-all ${
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
