'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
import { SlidersHorizontal, X, ChevronDown, Check } from 'lucide-react'
import { useCategories } from '@/hooks/use-categories'
import { useProductFilterOptions } from '@/hooks/use-products'
import { Button } from '@/components/ui/button'

/* ── Color Swatch (premium look) ── */
function ColorSwatch({ name, hex, checked, onChange }: { name: string; hex: string | null; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-3 py-1.5 text-sm group transition-colors text-start w-full"
      type="button"
    >
      <span
        className={`relative h-6 w-6 rounded-full border transition-all duration-200 flex items-center justify-center ${
          checked ? 'border-foreground ring-2 ring-foreground/15 ring-offset-1 ring-offset-background' : 'border-border group-hover:border-foreground/40'
        }`}
        style={{ backgroundColor: hex ?? '#e5e7eb' }}
        aria-label={name}
      >
        {checked && (
          <Check
            className="h-3.5 w-3.5"
            strokeWidth={3}
            style={{ color: isLightColor(hex) ? '#000' : '#fff' }}
          />
        )}
      </span>
      <span className={`transition-colors ${checked ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}>
        {name}
      </span>
    </button>
  )
}

/* ── Helper: detect light colors so the checkmark stays visible on white/yellow ── */
function isLightColor(hex: string | null): boolean {
  if (!hex) return true
  const cleaned = hex.replace('#', '')
  if (cleaned.length !== 6) return false
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  // Standard luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6
}

/* ── Size Pill ── */
function SizePill({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      type="button"
      className={`min-w-[44px] h-10 px-3 rounded-lg border text-sm font-medium transition-all ${
        checked
          ? 'bg-foreground text-background border-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

/* ── Show More / Show Less Toggle ──
 * Long lists (e.g. 20+ colors) need a collapse so the sidebar stays usable.
 * Default-collapsed to `defaultVisible`; "Mehr anzeigen (X)" reveals the rest.
 * If any of the hidden items is currently selected, force-expand so the user
 * can see and uncheck their own selection.
 */
function CollapsibleList<T>({
  items,
  defaultVisible = 8,
  isItemActive,
  renderItem,
  moreLabel,
  lessLabel,
}: {
  items: T[]
  defaultVisible?: number
  isItemActive?: (item: T) => boolean
  renderItem: (item: T, index: number) => React.ReactNode
  moreLabel: (hiddenCount: number) => string
  lessLabel: string
}) {
  const [expanded, setExpanded] = useState(false)

  // Auto-expand if any hidden item is selected — otherwise the user can't see/clear it.
  const hasHiddenSelection =
    !!isItemActive && items.slice(defaultVisible).some(isItemActive)
  const isExpanded = expanded || hasHiddenSelection

  const visible = isExpanded ? items : items.slice(0, defaultVisible)
  const hiddenCount = items.length - defaultVisible
  const showToggle = items.length > defaultVisible

  return (
    <>
      {visible.map((item, i) => renderItem(item, i))}
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {isExpanded ? lessLabel : moreLabel(hiddenCount)}
        </button>
      )}
    </>
  )
}

/* ── Animated Accordion FilterGroup ── */
function FilterGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <div className="border-b border-border/40 pb-4 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-2 text-sm font-semibold tracking-wide hover:text-foreground transition-colors"
      >
        <span className="uppercase text-xs">{title}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div ref={contentRef} className="overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Premium Checkbox ── */
function PremiumCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-3 py-1.5 text-sm cursor-pointer group transition-colors">
      <span
        className={`relative h-[18px] w-[18px] rounded-[4px] border-[1.5px] flex items-center justify-center transition-all duration-200 ${
          checked
            ? 'bg-foreground border-foreground'
            : 'border-border group-hover:border-foreground/40'
        }`}
        onClick={(e) => { e.preventDefault(); onChange() }}
      >
        {checked && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
      </span>
      <span className={`transition-colors ${checked ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}>
        {label}
      </span>
    </label>
  )
}

/* ── Price Range Slider ── */
function PriceRangeInputs({
  min, max, onChangeMin, onChangeMax, labelMin, labelMax,
}: {
  min: string; max: string
  onChangeMin: (v: string | null) => void
  onChangeMax: (v: string | null) => void
  labelMin: string; labelMax: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">€</span>
          <input
            type="number"
            placeholder={labelMin}
            value={min}
            onChange={(e) => onChangeMin(e.target.value || null)}
            className="w-full h-10 pl-7 pr-3 rounded-lg border bg-background text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:border-accent/40 transition-all outline-none"
            min={0}
          />
        </div>
        <div className="w-4 h-px bg-border" />
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">€</span>
          <input
            type="number"
            placeholder={labelMax}
            value={max}
            onChange={(e) => onChangeMax(e.target.value || null)}
            className="w-full h-10 pl-7 pr-3 rounded-lg border bg-background text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:border-accent/40 transition-all outline-none"
            min={0}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Main FilterSidebar ── */
export function FilterSidebar() {
  const t = useTranslations('product')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: categories } = useCategories()

  const [mobileOpen, setMobileOpen] = useState(false)

  const activeDepartment = searchParams.get('department') ?? ''
  const activeCategory = searchParams.get('category') ?? ''
  const activeSort = searchParams.get('sort') ?? ''
  const activeMinPrice = searchParams.get('minPrice') ?? ''
  const activeMaxPrice = searchParams.get('maxPrice') ?? ''
  const activeInStock = searchParams.get('inStock') === 'true'

  // Variant filters are stored as comma-separated lists in the URL.
  const activeColorsRaw = searchParams.get('colors') ?? ''
  const activeColors = activeColorsRaw ? activeColorsRaw.split(',').filter(Boolean) : []
  const activeSizesRaw = searchParams.get('sizes') ?? ''
  const activeSizes = activeSizesRaw ? activeSizesRaw.split(',').filter(Boolean) : []

  const departmentCategory = activeDepartment ? (categories ?? []).find((c: any) => c.slug === activeDepartment) : null
  const subcategories = (departmentCategory as any)?.children ?? []

  // Resolve current category to an ID so the filter-options endpoint can narrow
  // the available colors/sizes to what's actually in this department/category.
  let currentCategoryId: string | undefined
  if (activeCategory) {
    if (departmentCategory) {
      const sub = (departmentCategory as any).children?.find((c: any) => c.slug === activeCategory)
      if (sub) currentCategoryId = sub.id
    }
    if (!currentCategoryId) {
      const top = (categories ?? []).find((c: any) => c.slug === activeCategory)
      if (top) currentCategoryId = top.id
    }
  } else if (departmentCategory) {
    currentCategoryId = (departmentCategory as any).id
  }

  const { data: filterOptions } = useProductFilterOptions(currentCategoryId)

  const updateParams = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      params.delete('cursor')
      router.push(`/${locale}/products?${params.toString()}`)
    },
    [searchParams, router, locale],
  )

  const toggleListParam = useCallback(
    (key: string, value: string) => {
      const current = (searchParams.get(key) ?? '').split(',').filter(Boolean)
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      updateParams(key, next.length > 0 ? next.join(',') : null)
    },
    [searchParams, updateParams],
  )

  const clearAll = () => {
    router.push(`/${locale}/products`)
  }

  const hasActiveFilters =
    activeCategory ||
    activeMinPrice ||
    activeMaxPrice ||
    activeInStock ||
    activeSort ||
    activeDepartment ||
    activeColors.length > 0 ||
    activeSizes.length > 0

  const sortOptions = [
    { value: '', label: t('sort.popular') },
    { value: 'price_asc', label: t('sort.priceAsc') },
    { value: 'price_desc', label: t('sort.priceDesc') },
    { value: 'newest', label: t('sort.newest') },
  ]

  const filterContent = (
    <div className="space-y-2">
      {/* Sort */}
      <FilterGroup title={t('sort.title')} defaultOpen={true}>
        <div className="space-y-0.5">
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateParams('sort', opt.value || null)}
              className={`w-full text-start px-3 py-2 rounded-lg text-sm transition-colors ${
                activeSort === opt.value
                  ? 'bg-foreground/5 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FilterGroup>

      {/* Category */}
      {activeDepartment && subcategories.length > 0 ? (
        <FilterGroup title={t('filter.category')} defaultOpen={true}>
          <div className="space-y-0.5">
            {subcategories.map((cat: any) => {
              const name = cat.name
                ?? cat.translations?.find((tr: any) => tr.language === locale)?.name
                ?? cat.translations?.[0]?.name ?? cat.slug
              return (
                <PremiumCheckbox
                  key={cat.id}
                  checked={activeCategory === cat.slug}
                  onChange={() => updateParams('category', activeCategory === cat.slug ? null : cat.slug)}
                  label={name}
                />
              )
            })}
          </div>
        </FilterGroup>
      ) : categories && categories.length > 0 ? (
        <FilterGroup title={t('filter.category')} defaultOpen={true}>
          <div className="space-y-0.5">
            {categories.map((cat: any) => {
              const name = cat.name
                ?? cat.translations?.find((tr: any) => tr.language === locale)?.name
                ?? cat.translations?.[0]?.name ?? cat.slug
              return (
                <PremiumCheckbox
                  key={cat.id}
                  checked={activeCategory === cat.slug}
                  onChange={() => updateParams('category', activeCategory === cat.slug ? null : cat.slug)}
                  label={name}
                />
              )
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Color */}
      {filterOptions?.colors && filterOptions.colors.length > 0 && (
        <FilterGroup
          title={t.has?.('filter.color') ? t('filter.color') : (locale === 'ar' ? 'اللون' : locale === 'en' ? 'Color' : 'Farbe')}
          defaultOpen={activeColors.length > 0}
        >
          <div className="space-y-0.5">
            <CollapsibleList
              items={filterOptions.colors}
              defaultVisible={8}
              isItemActive={(c) => activeColors.includes(c.name)}
              renderItem={(c) => (
                <ColorSwatch
                  key={c.name}
                  name={c.name}
                  hex={c.hex}
                  checked={activeColors.includes(c.name)}
                  onChange={() => toggleListParam('colors', c.name)}
                />
              )}
              moreLabel={(n) =>
                locale === 'ar'
                  ? `+${n} أكثر`
                  : locale === 'en'
                  ? `+${n} more`
                  : `+${n} mehr anzeigen`
              }
              lessLabel={
                locale === 'ar' ? 'عرض أقل' : locale === 'en' ? 'Show less' : 'Weniger anzeigen'
              }
            />
          </div>
        </FilterGroup>
      )}

      {/* Size */}
      {filterOptions?.sizes && filterOptions.sizes.length > 0 && (
        <FilterGroup
          title={t.has?.('filter.size') ? t('filter.size') : (locale === 'ar' ? 'المقاس' : locale === 'en' ? 'Size' : 'Größe')}
          defaultOpen={activeSizes.length > 0}
        >
          <div className="flex flex-wrap gap-2 pt-1">
            <CollapsibleList
              items={filterOptions.sizes}
              defaultVisible={12}
              isItemActive={(s) => activeSizes.includes(s)}
              renderItem={(s) => (
                <SizePill
                  key={s}
                  label={s}
                  checked={activeSizes.includes(s)}
                  onChange={() => toggleListParam('sizes', s)}
                />
              )}
              moreLabel={(n) =>
                locale === 'ar'
                  ? `+${n} أكثر`
                  : locale === 'en'
                  ? `+${n} more`
                  : `+${n} mehr anzeigen`
              }
              lessLabel={
                locale === 'ar' ? 'عرض أقل' : locale === 'en' ? 'Show less' : 'Weniger anzeigen'
              }
            />
          </div>
        </FilterGroup>
      )}

      {/* Price Range */}
      <FilterGroup title={t('filter.price')} defaultOpen={!!activeMinPrice || !!activeMaxPrice}>
        <PriceRangeInputs
          min={activeMinPrice}
          max={activeMaxPrice}
          onChangeMin={(v) => updateParams('minPrice', v)}
          onChangeMax={(v) => updateParams('maxPrice', v)}
          labelMin={t('filter.priceMin')}
          labelMax={t('filter.priceMax')}
        />
      </FilterGroup>

      {/* In Stock */}
      <FilterGroup title={t('filter.availability')} defaultOpen={activeInStock}>
        <PremiumCheckbox
          checked={activeInStock}
          onChange={() => updateParams('inStock', activeInStock ? null : 'true')}
          label={t('filter.inStockOnly')}
        />
      </FilterGroup>

      {/* Clear */}
      {hasActiveFilters && (
        <button
          onClick={clearAll}
          className="w-full text-center py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          {t('filter.reset')}
        </button>
      )}
    </div>
  )

  return (
    <>
      {/* Mobile Filter Button */}
      <button
        className="lg:hidden flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium min-h-[44px] hover:bg-muted transition-colors"
        onClick={() => setMobileOpen(true)}
        aria-label="Filter"
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filter
        {hasActiveFilters && (
          <span className="h-2 w-2 rounded-full bg-accent" />
        )}
      </button>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[80vh] overflow-y-auto lg:hidden animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Filter</h2>
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">{filterContent}</div>
            <div className="px-6 py-4 border-t safe-bottom">
              <Button className="w-full rounded-xl btn-press" onClick={() => setMobileOpen(false)}>
                {t('filter.showResults')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 flex-shrink-0 sticky top-20 self-start">
        {filterContent}
      </aside>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <ActiveFilterChips
          category={activeCategory}
          minPrice={activeMinPrice}
          maxPrice={activeMaxPrice}
          inStock={activeInStock}
          sort={activeSort}
          onRemove={updateParams}
          onClearAll={clearAll}
        />
      )}
    </>
  )
}

function ActiveFilterChips({
  category, minPrice, maxPrice, inStock, sort,
  onRemove, onClearAll,
}: {
  category: string; minPrice: string; maxPrice: string; inStock: boolean; sort: string
  onRemove: (key: string, value: string | null) => void
  onClearAll: () => void
}) {
  const t = useTranslations('product')
  const sortLabelMap: Record<string, string> = {
    price_asc: t('sort.priceAsc'),
    price_desc: t('sort.priceDesc'),
    newest: t('sort.newest'),
  }
  return (
    <div className="flex flex-wrap gap-2 lg:hidden mb-4">
      {category && <Chip label={category} onRemove={() => onRemove('category', null)} />}
      {minPrice && <Chip label={`€${minPrice}+`} onRemove={() => onRemove('minPrice', null)} />}
      {maxPrice && <Chip label={`–€${maxPrice}`} onRemove={() => onRemove('maxPrice', null)} />}
      {inStock && <Chip label={t('inStock')} onRemove={() => onRemove('inStock', null)} />}
      {sort && <Chip label={sortLabelMap[sort] ?? sort} onRemove={() => onRemove('sort', null)} />}
      <button onClick={onClearAll} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
        {t('filter.removeAll')}
      </button>
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-foreground/5 text-xs font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-destructive transition-colors min-h-[44px] min-w-[22px] flex items-center" aria-label="Remove">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
