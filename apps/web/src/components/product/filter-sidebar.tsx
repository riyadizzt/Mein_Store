'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState, useRef } from 'react'
import { SlidersHorizontal, X, ChevronDown, Check } from 'lucide-react'
import { useCategories } from '@/hooks/use-categories'
import { Button } from '@/components/ui/button'

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

  const departmentCategory = activeDepartment ? (categories ?? []).find((c: any) => c.slug === activeDepartment) : null
  const subcategories = (departmentCategory as any)?.children ?? []

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

  const clearAll = () => {
    router.push(`/${locale}/products`)
  }

  const hasActiveFilters = activeCategory || activeMinPrice || activeMaxPrice || activeInStock || activeSort || activeDepartment

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
