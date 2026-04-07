'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { SlidersHorizontal, X, ChevronDown } from 'lucide-react'
import { useCategories } from '@/hooks/use-categories'
import { Button } from '@/components/ui/button'

function FilterGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/50 pb-4 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-1 text-sm font-semibold hover:text-foreground transition-colors"
      >
        {title}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

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
    <div className="space-y-4">
      {/* Sort */}
      <FilterGroup title={t('sort.title')} defaultOpen={true}>
        <select
          value={activeSort}
          onChange={(e) => updateParams('sort', e.target.value || null)}
          className="w-full h-9 px-3 rounded-xl border bg-background text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </FilterGroup>

      {/* Category */}
      {activeDepartment && subcategories.length > 0 ? (
        <FilterGroup title={t('filter.category')} defaultOpen={true}>
          <div className="space-y-2">
            {subcategories.map((cat: any) => {
              const name = cat.name
                ?? cat.translations?.find((tr: any) => tr.language === locale)?.name
                ?? cat.translations?.[0]?.name ?? cat.slug
              return (
                <label key={cat.id} className="flex items-center gap-2.5 text-sm cursor-pointer hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={activeCategory === cat.slug}
                    onChange={() => updateParams('category', activeCategory === cat.slug ? null : cat.slug)}
                    className="rounded border-border accent-accent"
                  />
                  {name}
                </label>
              )
            })}
          </div>
        </FilterGroup>
      ) : categories && categories.length > 0 ? (
        <FilterGroup title={t('filter.category')} defaultOpen={true}>
          <div className="space-y-2">
            {categories.map((cat: any) => {
              const name = cat.name
                ?? cat.translations?.find((tr: any) => tr.language === locale)?.name
                ?? cat.translations?.[0]?.name ?? cat.slug
              return (
                <label key={cat.id} className="flex items-center gap-2.5 text-sm cursor-pointer hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={activeCategory === cat.slug}
                    onChange={() => updateParams('category', activeCategory === cat.slug ? null : cat.slug)}
                    className="rounded border-border accent-accent"
                  />
                  {name}
                </label>
              )
            })}
          </div>
        </FilterGroup>
      ) : null}

      {/* Price Range */}
      <FilterGroup title={t('filter.price')} defaultOpen={!!activeMinPrice || !!activeMaxPrice}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder={t('filter.priceMin')}
            value={activeMinPrice}
            onChange={(e) => updateParams('minPrice', e.target.value || null)}
            className="w-full h-9 px-3 rounded-xl border bg-background text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            min={0}
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="number"
            placeholder={t('filter.priceMax')}
            value={activeMaxPrice}
            onChange={(e) => updateParams('maxPrice', e.target.value || null)}
            className="w-full h-9 px-3 rounded-xl border bg-background text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            min={0}
          />
        </div>
      </FilterGroup>

      {/* In Stock */}
      <FilterGroup title={t('filter.availability') ?? (locale === 'ar' ? 'التوفر' : locale === 'en' ? 'Availability' : 'Verfügbarkeit')} defaultOpen={activeInStock}>
        <label className="flex items-center gap-2.5 text-sm cursor-pointer hover:text-foreground transition-colors">
          <input
            type="checkbox"
            checked={activeInStock}
            onChange={() => updateParams('inStock', activeInStock ? null : 'true')}
            className="rounded border-border accent-accent"
          />
          {t('inStock')}
        </label>
      </FilterGroup>

      {/* Clear */}
      {hasActiveFilters && (
        <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={clearAll}>
          {t('filter.reset')}
        </Button>
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
          <span className="h-5 w-5 rounded-full bg-accent text-accent-foreground text-xs flex items-center justify-center font-bold">!</span>
        )}
      </button>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[80vh] overflow-y-auto lg:hidden"
            style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Filter</h2>
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">{filterContent}</div>
            <div className="px-6 py-4 border-t">
              <Button className="w-full rounded-xl" onClick={() => setMobileOpen(false)}>
                {t('filter.showResults')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-60 flex-shrink-0 sticky top-20 self-start">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          {locale === 'ar' ? 'تصفية' : locale === 'en' ? 'Filters' : 'Filter'}
        </h2>
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
      {category && (
        <Chip label={`${t('filter.category')}: ${category}`} onRemove={() => onRemove('category', null)} />
      )}
      {minPrice && (
        <Chip label={`Ab €${minPrice}`} onRemove={() => onRemove('minPrice', null)} />
      )}
      {maxPrice && (
        <Chip label={`Bis €${maxPrice}`} onRemove={() => onRemove('maxPrice', null)} />
      )}
      {inStock && (
        <Chip label={t('inStock')} onRemove={() => onRemove('inStock', null)} />
      )}
      {sort && (
        <Chip label={sortLabelMap[sort] ?? sort} onRemove={() => onRemove('sort', null)} />
      )}
      <button onClick={onClearAll} className="text-xs text-destructive hover:underline">
        {t('filter.removeAll')}
      </button>
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-xs font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-destructive min-h-[44px] min-w-[22px] flex items-center" aria-label="Remove">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
