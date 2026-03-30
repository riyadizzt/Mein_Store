'use client'

import { useState, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRightLeft, PackagePlus, RotateCcw,
  ShoppingBag, ChevronLeft, ChevronRight, Search, Calendar,
  Package, AlertTriangle, Filter, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, translateMovement, getProductName } from '@/lib/locale-utils'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { Input } from '@/components/ui/input'

// ── Type config ─────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { icon: any; bg: string; text: string; ring: string }> = {
  purchase_received:    { icon: PackagePlus,    bg: 'bg-emerald-50',  text: 'text-emerald-600', ring: 'ring-emerald-200' },
  sale_online:          { icon: ShoppingBag,    bg: 'bg-blue-50',     text: 'text-blue-600',    ring: 'ring-blue-200' },
  sale_pos:             { icon: ShoppingBag,    bg: 'bg-violet-50',   text: 'text-violet-600',  ring: 'ring-violet-200' },
  return_received:      { icon: RotateCcw,      bg: 'bg-amber-50',    text: 'text-amber-600',   ring: 'ring-amber-200' },
  stocktake_adjustment: { icon: RotateCcw,      bg: 'bg-slate-100',   text: 'text-slate-600',   ring: 'ring-slate-200' },
  transfer:             { icon: ArrowRightLeft,  bg: 'bg-sky-50',      text: 'text-sky-600',     ring: 'ring-sky-200' },
  damaged:              { icon: AlertTriangle,   bg: 'bg-red-50',      text: 'text-red-500',     ring: 'ring-red-200' },
  reserved:             { icon: Package,         bg: 'bg-orange-50',   text: 'text-orange-600',  ring: 'ring-orange-200' },
  released:             { icon: RotateCcw,       bg: 'bg-teal-50',     text: 'text-teal-600',    ring: 'ring-teal-200' },
}

const MOVEMENT_TYPES = [
  'purchase_received', 'sale_online', 'sale_pos', 'transfer',
  'return_received', 'stocktake_adjustment', 'damaged', 'reserved', 'released',
] as const

// ── Date grouping helpers ───────────────────────────────────
function getDateKey(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10)
}

function getDateLabel(dateKey: string, locale: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  if (dateKey === today) return locale === 'ar' ? 'اليوم' : locale === 'en' ? 'Today' : 'Heute'
  if (dateKey === yesterday) return locale === 'ar' ? 'أمس' : locale === 'en' ? 'Yesterday' : 'Gestern'

  const fmt = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(fmt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateKey + 'T12:00:00'))
}

function getTimeOnly(dateStr: string, locale: string): string {
  const fmt = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(fmt, { hour: '2-digit', minute: '2-digit' }).format(new Date(dateStr))
}

// ── Page ────────────────────────────────────────────────────
export default function MovementsPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()

  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 40

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
  })

  const { data: result, isLoading } = useQuery({
    queryKey: ['inventory-movements', warehouseFilter, typeFilter, search, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/inventory/movements', {
        params: {
          warehouseId: warehouseFilter || undefined,
          type: typeFilter || undefined,
          search: search || undefined,
          limit: pageSize,
          offset: page * pageSize,
        },
      })
      return data
    },
  })

  const movements = result?.data ?? []
  const total = result?.meta?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)
  const hasFilters = warehouseFilter || typeFilter || search

  // Group movements by date
  const grouped = useMemo(() => {
    const groups: { dateKey: string; label: string; items: any[] }[] = []
    const map = new Map<string, any[]>()

    for (const m of movements) {
      const key = getDateKey(m.createdAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }

    for (const [dateKey, items] of map) {
      groups.push({ dateKey, label: getDateLabel(dateKey, locale), items })
    }
    return groups
  }, [movements, locale])

  const clearFilters = () => {
    setWarehouseFilter('')
    setTypeFilter('')
    setSearch('')
    setPage(0)
  }

  return (
    <div>
      <AdminBreadcrumb items={[
        { label: t('inventory.title'), href: `/${locale}/admin/inventory` },
        { label: locale === 'ar' ? 'سجل الحركات' : locale === 'en' ? 'Movement Log' : 'Bewegungslog' },
      ]} />

      {/* Back + Title */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => router.push(`/${locale}/admin/inventory`)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2 group transition-colors"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1" />
            {t('inventory.backToOverview')}
          </button>
          <h1 className="text-2xl font-bold tracking-tight">
            {locale === 'ar' ? 'سجل حركات المخزون' : locale === 'en' ? 'Inventory Movements' : 'Bewegungslog'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {total} {locale === 'ar' ? 'حركة' : locale === 'en' ? 'movements' : 'Bewegungen'}
          </div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="bg-background border rounded-2xl p-3 mb-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={locale === 'ar' ? 'بحث عن SKU أو منتج...' : locale === 'en' ? 'Search SKU or product...' : 'SKU oder Produkt suchen...'}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="pl-10 rtl:pl-3 rtl:pr-10 h-9 rounded-xl text-sm"
            />
          </div>

          {/* Warehouse */}
          <select
            value={warehouseFilter}
            onChange={(e) => { setWarehouseFilter(e.target.value); setPage(0) }}
            className={`h-9 px-3 rounded-xl text-xs font-medium border bg-background cursor-pointer transition-all ${warehouseFilter ? 'border-primary bg-primary/5 text-primary' : 'hover:border-muted-foreground/30'}`}
          >
            <option value="">{t('inventory.allWarehouses')}</option>
            {(warehouses as any[])?.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          {/* Type pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {MOVEMENT_TYPES.map((type) => {
              const active = typeFilter === type
              const cfg = TYPE_CONFIG[type]
              return (
                <button
                  key={type}
                  onClick={() => { setTypeFilter(active ? '' : type); setPage(0) }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                    active
                      ? `${cfg.bg} ${cfg.text} ring-1 ${cfg.ring}`
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {translateMovement(type, locale)}
                </button>
              )
            })}
          </div>

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <X className="h-3 w-3" />
              {locale === 'ar' ? 'مسح' : locale === 'en' ? 'Clear' : 'Zurücksetzen'}
            </button>
          )}
        </div>
      </div>

      {/* ── Movements List ── */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="bg-background border rounded-2xl p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-3">
                <div className="h-10 w-10 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded-lg animate-pulse" style={{ width: `${40 + Math.random() * 30}%` }} />
                  <div className="h-3 bg-muted rounded-lg animate-pulse" style={{ width: `${20 + Math.random() * 20}%` }} />
                </div>
                <div className="h-8 w-16 rounded-lg bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : movements.length === 0 ? (
          <div className="bg-background border rounded-2xl py-20 text-center">
            <ArrowRightLeft className="h-14 w-14 mx-auto mb-4 text-muted-foreground/15" />
            <p className="text-muted-foreground font-medium">
              {locale === 'ar' ? 'لا توجد حركات' : locale === 'en' ? 'No movements found' : 'Keine Bewegungen gefunden'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-2 text-sm text-primary hover:underline">
                {locale === 'ar' ? 'مسح الفلاتر' : locale === 'en' ? 'Clear filters' : 'Filter zurücksetzen'}
              </button>
            )}
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.dateKey}>
              {/* Date header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                </div>
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] text-muted-foreground/60">{group.items.length} {locale === 'ar' ? 'حركة' : locale === 'en' ? 'entries' : 'Einträge'}</span>
              </div>

              {/* Movements */}
              <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
                {group.items.map((m: any, i: number) => {
                  const cfg = TYPE_CONFIG[m.type] ?? { icon: RotateCcw, bg: 'bg-muted', text: 'text-muted-foreground', ring: 'ring-muted' }
                  const Icon = cfg.icon
                  const isPositive = m.quantity > 0
                  const productName = m.productName ? getProductName(m.productName, locale) : ''

                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-4 px-5 py-3.5 transition-all hover:bg-muted/30 cursor-default group ${
                        i < group.items.length - 1 ? 'border-b border-border/50' : ''
                      }`}
                      style={{ animationDelay: `${i * 20}ms`, animation: 'fadeIn 300ms ease-out both' }}
                    >
                      {/* Icon */}
                      <div className={`h-10 w-10 rounded-xl ${cfg.bg} ${cfg.text} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105`}>
                        <Icon className="h-[18px] w-[18px]" />
                      </div>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold">{translateMovement(m.type, locale)}</span>
                          {m.warehouseName && (
                            <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-medium text-muted-foreground">
                              {m.warehouseName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {m.sku && <span className="font-mono bg-muted/50 px-1.5 py-0.5 rounded">{m.sku}</span>}
                          {m.color && (
                            <span>{translateColor(m.color, locale)}{m.size ? ` / ${m.size}` : ''}</span>
                          )}
                          {productName && <span className="truncate max-w-[200px] opacity-70">{productName}</span>}
                        </div>
                        {m.notes && (
                          <div className="text-[10px] text-muted-foreground/50 mt-0.5 truncate max-w-[300px]">{m.notes}</div>
                        )}
                      </div>

                      {/* Quantity badge */}
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <div className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-bold tabular-nums ${
                          isPositive
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60'
                            : 'bg-red-50 text-red-600 ring-1 ring-red-200/60'
                        }`}>
                          {isPositive ? '+' : ''}{m.quantity}
                        </div>
                        {m.quantityBefore != null && m.quantityAfter != null && (
                          <div className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                            {m.quantityBefore} → {m.quantityAfter}
                          </div>
                        )}
                      </div>

                      {/* Time */}
                      <div className="text-[11px] text-muted-foreground/60 flex-shrink-0 w-14 text-end tabular-nums">
                        {getTimeOnly(m.createdAt, locale)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Pagination ── */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-6 px-1">
          <span className="text-xs text-muted-foreground">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} {locale === 'ar' ? 'من' : locale === 'en' ? 'of' : 'von'} {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
              let p: number
              if (totalPages <= 5) p = i
              else if (page < 3) p = i
              else if (page > totalPages - 4) p = totalPages - 5 + i
              else p = page - 2 + i
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-8 w-8 rounded-lg text-xs font-medium transition-all ${
                    p === page ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {p + 1}
                </button>
              )
            })}
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
