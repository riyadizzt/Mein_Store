'use client'

import { useState, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Lock, Search, Filter, X, AlertTriangle, Package,
  Warehouse as WarehouseIcon, Clock, ArrowRight, User as UserIcon,
  ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, getProductName, formatDateTime } from '@/lib/locale-utils'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { Input } from '@/components/ui/input'

type Status = 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'all'

type Reservation = {
  id: string
  quantity: number
  status: Status
  expiresAt: string
  createdAt: string
  variant: {
    id: string
    sku: string
    barcode: string | null
    size: string | null
    color: string | null
    productId: string
    productDeleted: boolean
    productTranslations: { language: string; name: string }[]
    productImage: string | null
  }
  warehouse: { id: string; name: string; type: string }
  order: {
    id: string
    orderNumber: string
    status: string
    customerName: string | null
  } | null
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; ring: string; label: { de: string; en: string; ar: string } }> = {
  RESERVED:  { bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-200',  label: { de: 'Aktiv gesperrt', en: 'Actively locked', ar: 'محجوز نشط' } },
  CONFIRMED: { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200',    label: { de: 'Bestätigt (wartet Versand)', en: 'Confirmed (awaiting ship)', ar: 'مؤكد (بانتظار الشحن)' } },
  EXPIRED:   { bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-200',     label: { de: 'Abgelaufen (Zombie)', en: 'Expired (zombie)', ar: 'منتهي (شبح)' } },
  RELEASED:  { bg: 'bg-slate-100',  text: 'text-slate-600',   ring: 'ring-slate-200',   label: { de: 'Freigegeben', en: 'Released', ar: 'تم الإفراج' } },
}

const ORDER_STATUS_LABELS: Record<string, Record<string, string>> = {
  pending:          { de: 'Ausstehend',           en: 'Pending',            ar: 'قيد الانتظار' },
  pending_payment:  { de: 'Warte auf Zahlung',    en: 'Awaiting payment',   ar: 'بانتظار الدفع' },
  confirmed:        { de: 'Bestätigt',             en: 'Confirmed',          ar: 'مؤكد' },
  processing:       { de: 'In Bearbeitung',        en: 'Processing',         ar: 'قيد المعالجة' },
  shipped:          { de: 'Versendet',             en: 'Shipped',            ar: 'تم الشحن' },
  delivered:        { de: 'Zugestellt',            en: 'Delivered',          ar: 'تم التوصيل' },
  cancelled:        { de: 'Storniert',             en: 'Cancelled',          ar: 'ملغي' },
  returned:         { de: 'Retourniert',           en: 'Returned',           ar: 'مُرتجع' },
  refunded:         { de: 'Erstattet',             en: 'Refunded',           ar: 'مُسترد' },
}

function orderStatusLabel(status: string, locale: string): string {
  return ORDER_STATUS_LABELS[status]?.[locale] ?? ORDER_STATUS_LABELS[status]?.de ?? status
}

export default function ReservationsPage() {
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [status, setStatus] = useState<Status>((searchParams.get('status') as Status) || 'RESERVED')
  const [warehouseFilter, setWarehouseFilter] = useState(searchParams.get('warehouseId') || '')
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [variantId] = useState(searchParams.get('variantId') || '')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const { data: warehouses } = useQuery({
    queryKey: ['admin-warehouses'],
    queryFn: async () => { const { data } = await api.get('/admin/warehouses'); return data },
  })

  const { data: result, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['inventory-reservations', status, warehouseFilter, search, variantId, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/inventory/reservations', {
        params: {
          status,
          warehouseId: warehouseFilter || undefined,
          variantId: variantId || undefined,
          search: search || undefined,
          limit: pageSize,
          offset: page * pageSize,
        },
      })
      return data as { data: Reservation[]; meta: { total: number; limit: number; offset: number } }
    },
  })

  const rows = result?.data ?? []
  const total = result?.meta?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const hasFilter = !!(warehouseFilter || search || variantId)

  // Group reservations by order number for cleaner display (must be
  // at component top-level — React hooks rule).
  const grouped = useMemo(() => {
    const map = new Map<string, Reservation[]>()
    for (const r of rows) {
      const key = r.order?.orderNumber ?? r.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return [...map.entries()]
  }, [rows])

  return (
    <div className="min-h-screen bg-background p-6 max-w-[1440px] mx-auto">
      <AdminBreadcrumb
        items={[
          { label: t3('Lager', 'Inventory', 'المخزون'), href: `/${locale}/admin/inventory` },
          { label: t3('Reservierungen', 'Reservations', 'الحجوزات') },
        ]}
      />

      {/* ── Header ── */}
      <div className="mt-4 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-orange-50 ring-1 ring-orange-200 flex items-center justify-center">
              <Lock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t3('Aktive Reservierungen', 'Active Reservations', 'الحجوزات النشطة')}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t3(
                  'Welche Produkte sind gerade für Bestellungen gesperrt und wo.',
                  'Which products are currently locked for orders and where.',
                  'ما هي المنتجات المحجوزة حالياً وأين.',
                )}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-9 px-3 rounded-lg border bg-background hover:bg-muted flex items-center gap-2 text-xs font-semibold disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {t3('Aktualisieren', 'Refresh', 'تحديث')}
        </button>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['RESERVED', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'all'] as Status[]).map((s) => {
          const isActive = status === s
          const label = s === 'all'
            ? { de: 'Alle', en: 'All', ar: 'الكل' }
            : STATUS_CONFIG[s].label
          return (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(0) }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ring-1 ${
                isActive
                  ? 'bg-[#0f1419] text-white ring-[#0f1419]'
                  : 'bg-background text-muted-foreground ring-border hover:bg-muted'
              }`}
            >
              {label[locale as 'de' | 'en' | 'ar'] ?? label.de}
            </button>
          )
        })}
      </div>

      {/* ── Filters ── */}
      <div className="bg-background border rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder={t3('SKU suchen…', 'Search SKU…', 'ابحث عن SKU…')}
            className="ltr:pl-9 rtl:pr-9"
          />
        </div>
        <select
          value={warehouseFilter}
          onChange={(e) => { setWarehouseFilter(e.target.value); setPage(0) }}
          className="h-10 px-3 rounded-lg border bg-background text-xs font-semibold min-w-[180px]"
        >
          <option value="">{t3('Alle Lager', 'All warehouses', 'كل المستودعات')}</option>
          {warehouses?.map((w: any) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={() => { setWarehouseFilter(''); setSearch(''); setPage(0); router.replace(`/${locale}/admin/inventory/reservations`) }}
            className="h-10 px-3 rounded-lg bg-muted hover:bg-muted/80 flex items-center gap-1.5 text-xs font-semibold"
          >
            <X className="h-3.5 w-3.5" />
            {t3('Filter löschen', 'Clear filters', 'مسح الفلاتر')}
          </button>
        )}
      </div>

      {/* ── Summary bar ── */}
      <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
        <Filter className="h-3.5 w-3.5" />
        <span>
          {total === 0
            ? t3('Keine Einträge gefunden', 'No entries found', 'لا توجد نتائج')
            : t3(`${total} Eintrag${total === 1 ? '' : 'e'}`, `${total} ${total === 1 ? 'entry' : 'entries'}`, `${total} نتيجة`)}
        </span>
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          {t3('Lädt…', 'Loading…', 'جاري التحميل…')}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center border rounded-2xl bg-muted/20">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-semibold text-muted-foreground">
            {status === 'RESERVED'
              ? t3('Keine aktiven Reservierungen', 'No active reservations', 'لا توجد حجوزات نشطة')
              : t3('Keine Einträge', 'No entries', 'لا توجد نتائج')}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {status === 'RESERVED'
              ? t3(
                  'Wenn ein Kunde eine Bestellung startet, wird die Ware hier gesperrt.',
                  'When a customer starts checkout, the stock is locked here.',
                  'عندما يبدأ العميل عملية الشراء، يتم تأمين البضاعة هنا.',
                )
              : null}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([orderKey, groupRows]) => {
            const isGroup = groupRows.length > 1
            const firstOrder = groupRows[0].order
            return (
              <div key={orderKey} className={`${isGroup ? 'border rounded-2xl overflow-hidden' : ''}`}>
                {/* Group header — only for multi-item orders */}
                {isGroup && firstOrder && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => router.push(`/${locale}/admin/orders/${firstOrder.id}`)}
                        className="font-mono text-sm font-bold hover:text-[#d4a853] transition-colors"
                      >
                        {firstOrder.orderNumber}
                      </button>
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold">{orderStatusLabel(firstOrder.status, locale)}</span>
                      {firstOrder.customerName && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <UserIcon className="h-3 w-3" />
                          {firstOrder.customerName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{groupRows.length} {t3('Varianten', 'variants', 'متغيرات')}</span>
                      <div className="px-2 py-1 rounded-lg bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-sm font-bold tabular-nums">
                        −{groupRows.reduce((s, r) => s + r.quantity, 0)}
                      </div>
                    </div>
                  </div>
                )}
                {/* Reservation rows */}
                <div className={isGroup ? 'divide-y divide-border/30' : 'space-y-2'}>
          {groupRows.map((r) => {
            const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.RESERVED
            const name = getProductName(r.variant.productTranslations, locale) || r.variant.sku
            const isExpired = r.status === 'EXPIRED'
            const isZombie = r.status === 'RESERVED' && new Date(r.expiresAt).getTime() < Date.now()
            const orderShipped = r.order && ['shipped', 'delivered', 'cancelled'].includes(r.order.status)
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-background hover:shadow-sm transition-shadow ${
                  isZombie || isExpired ? 'border-red-200' : ''
                }`}
              >
                {/* Product image */}
                {r.variant.productImage ? (
                  <img src={r.variant.productImage} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                )}

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate max-w-[320px]">{name}</span>
                    {r.variant.productDeleted && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600">
                        {t3('Gelöscht', 'Deleted', 'محذوف')}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
                      {cfg.label[locale as 'de' | 'en' | 'ar'] ?? cfg.label.de}
                    </span>
                    {isZombie && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 ring-1 ring-red-200 inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {t3('Zombie', 'Zombie', 'شبح')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                    <span className="font-mono">{r.variant.sku}</span>
                    {r.variant.color && (
                      <>
                        <span className="text-muted-foreground/30">·</span>
                        <span>{translateColor(r.variant.color, locale)}{r.variant.size ? ` / ${r.variant.size}` : ''}</span>
                      </>
                    )}
                    <span className="text-muted-foreground/30">·</span>
                    <span className="inline-flex items-center gap-1">
                      <WarehouseIcon className="h-3 w-3" />
                      {r.warehouse.name}
                    </span>
                  </div>
                  {/* Order + customer line */}
                  {r.order ? (
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/70 flex-wrap">
                      <button
                        onClick={() => router.push(`/${locale}/admin/orders/${r.order!.id}`)}
                        className="inline-flex items-center gap-1 font-mono font-semibold text-[#0f1419] hover:text-[#d4a853] transition-colors"
                      >
                        {r.order.orderNumber}
                        <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                      </button>
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold">
                        {orderStatusLabel(r.order.status, locale)}
                      </span>
                      {orderShipped && r.status === 'RESERVED' && (
                        <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-semibold inline-flex items-center gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {t3('Drift: Order bereits versandt', 'Drift: order already shipped', 'انحراف: الطلب تم شحنه')}
                        </span>
                      )}
                      {r.order.customerName && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="inline-flex items-center gap-1">
                            <UserIcon className="h-3 w-3" />
                            {r.order.customerName}
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted-foreground/50 italic">
                      {t3('Keine Bestellung verknüpft (Gast-Cart oder Session)', 'No order linked (guest cart or session)', 'لا يوجد طلب مرتبط (سلة ضيف أو جلسة)')}
                    </div>
                  )}
                </div>

                {/* Quantity badge */}
                <div className="w-[60px] text-center flex-shrink-0">
                  <div className="px-2 py-1.5 rounded-xl bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-base font-bold tabular-nums">
                    −{r.quantity}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {t3('Stück', 'units', 'وحدة')}
                  </div>
                </div>

                {/* Expires */}
                <div className="w-[140px] flex-shrink-0 text-end text-[11px]">
                  <div className="inline-flex items-center gap-1 text-muted-foreground font-semibold">
                    <Clock className="h-3 w-3" />
                    <span>{t3('Läuft ab', 'Expires', 'ينتهي')}</span>
                  </div>
                  <div className={`mt-0.5 font-mono tabular-nums ${isZombie || isExpired ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {formatDateTime(r.expiresAt, locale)}
                  </div>
                </div>
              </div>
            )
          })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-6 px-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} {t3('von', 'of', 'من')} {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-semibold tabular-nums" dir="ltr">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
