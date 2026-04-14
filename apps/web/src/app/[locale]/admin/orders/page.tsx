'use client'

import { API_BASE_URL } from '@/lib/env'
import React, { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateWithWeekday, formatTime, formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { ChannelIcon, CHANNEL_CONFIG } from '@/components/admin/channel-icon'
import { StripeLogo, PayPalLogo, KlarnaLogo, SumUpLogo } from '@/components/ui/payment-logos'

function getOrderLocale(order: any): string {
  if (order.user?.preferredLang) return order.user.preferredLang
  try { return JSON.parse(order.notes ?? '{}').locale ?? '' } catch { return '' }
}

const LOCALE_BADGE: Record<string, { label: string; bg: string }> = {
  de: { label: 'DE', bg: 'bg-yellow-100 text-yellow-800' },
  en: { label: 'EN', bg: 'bg-blue-100 text-blue-800' },
  ar: { label: 'AR', bg: 'bg-green-100 text-green-800' },
}

function getCustomerName(order: any): string {
  if (order.user?.firstName) return `${order.user.firstName} ${order.user.lastName ?? ''}`
  try {
    const notes = JSON.parse(order.notes ?? '{}')
    if (notes.guestFirstName) return `${notes.guestFirstName} ${notes.guestLastName ?? ''}`
  } catch {}
  return order.guestEmail ?? ''
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  pending_payment: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  processing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
  refunded: 'bg-orange-100 text-orange-800',
  disputed: 'bg-red-100 text-red-800',
}

const STATUS_KEYS = Object.keys(STATUS_COLORS)

export default function AdminOrdersPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())

  const { data: orders, isLoading } = useQuery({
    queryKey: ['admin-orders', search, statusFilter, channelFilter],
    queryFn: async () => {
      const { data } = await api.get('/admin/orders', {
        params: { search: search || undefined, status: statusFilter || undefined, channel: channelFilter || undefined, limit: 50 },
      })
      return data
    },
  })

  const handleExportCsv = async () => {
    const API_URL = API_BASE_URL
    const token = (await import('@/store/auth-store')).useAuthStore.getState().accessToken
    const res = await fetch(`${API_URL}/api/v1/admin/orders/export/csv`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bestellungen-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('orders.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('orders.title')}</h1>
        <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />{t('orders.csvExport')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('orders.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ltr:pl-10 rtl:pr-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]"
        >
          <option value="">{t('orders.allStatus')}</option>
          {STATUS_KEYS.map((key) => (
            <option key={key} value={key}>{t(`status.${key}`)}</option>
          ))}
        </select>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]"
        >
          <option value="">{locale === 'ar' ? 'كل القنوات' : locale === 'en' ? 'All Channels' : 'Alle Kanäle'}</option>
          {Object.entries(CHANNEL_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{locale === 'ar' ? cfg.labelAr : cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-7 gap-x-2 bg-muted/50 border-b">
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t('orders.order')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t('orders.customer')}</div>
              <div className="px-2 py-3 text-sm font-semibold text-muted-foreground text-center">{locale === 'ar' ? 'القناة' : 'Kanal'}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{locale === 'ar' ? 'الوقت' : locale === 'en' ? 'Time' : 'Uhrzeit'}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t('orders.status')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t('orders.amount')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t('orders.payment')}</div>
            </div>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-7 gap-x-2 border-b">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <div key={j} className="px-4 py-4"><div className="h-4 bg-muted rounded animate-pulse" /></div>
                  ))}
                </div>
              ))
            ) : (orders ?? []).length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground">{t('orders.noOrders')}</div>
            ) : (
              (() => {
                // Group orders by creation-day (YYYY-MM-DD). The API already
                // returns rows sorted by createdAt desc, so iterating in
                // order preserves the "newest day first" layout the shipments
                // page uses. Each group becomes one collapsible section with
                // a gold header row and one child row per order.
                const grouped: Record<string, any[]> = {}
                for (const o of (orders ?? []) as any[]) {
                  const dateKey = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : 'unknown'
                  if (!grouped[dateKey]) grouped[dateKey] = []
                  grouped[dateKey].push(o)
                }
                return Object.entries(grouped).map(([dateKey, items]) => (
                  <React.Fragment key={dateKey}>
                    <button
                      type="button"
                      onClick={() => setCollapsedDays((prev) => {
                        const next = new Set(prev)
                        if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey)
                        return next
                      })}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-[#d4a853]/5 hover:bg-[#d4a853]/10 border-b transition-colors text-start"
                    >
                      <div className="flex items-center gap-2">
                        {collapsedDays.has(dateKey)
                          ? <ChevronRight className="h-4 w-4 text-[#d4a853]" />
                          : <ChevronDown className="h-4 w-4 text-[#d4a853]" />}
                        <span className="text-sm font-bold text-[#d4a853]">{formatDateWithWeekday(dateKey, locale)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {items.length} {locale === 'ar' ? 'طلبات' : locale === 'en' ? 'orders' : 'Bestellungen'}
                      </span>
                    </button>
                    {!collapsedDays.has(dateKey) && items.map((order: any) => {
                      const statusColor = STATUS_COLORS[order.status] ?? 'bg-gray-100'
                      return (
                        <div key={order.id} className="grid grid-cols-7 gap-x-2 border-b hover:bg-muted/30 transition-colors items-center">
                          <div className="px-4 py-4">
                            <Link href={`/${locale}/admin/orders/${order.id}`} className="font-mono text-sm font-medium text-primary hover:underline">
                              {order.orderNumber}
                            </Link>
                          </div>
                          <div className="px-4 py-4 text-center">
                            <p className="text-sm font-medium">
                              {getCustomerName(order)}
                              {!order.user && order.guestEmail && <span className="text-[10px] font-normal text-muted-foreground"> (Gast)</span>}
                              {(() => { const loc = getOrderLocale(order); const badge = LOCALE_BADGE[loc]; return badge ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.bg} ltr:ml-1.5 rtl:mr-1.5`}>{badge.label}</span> : null })()}
                            </p>
                            <p className="text-sm text-muted-foreground">{order.user?.email ?? order.guestEmail ?? ''}</p>
                          </div>
                          <div className="px-2 py-4 flex justify-center">
                            <ChannelIcon channel={order.channel ?? 'website'} size={18} />
                          </div>
                          <div className="px-4 py-4 text-sm text-muted-foreground tabular-nums text-center">{formatTime(order.createdAt, locale)}</div>
                          <div className="px-4 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${statusColor}`}>{t(`status.${order.status}`)}</span>
                          </div>
                          <div className="px-4 py-4 text-center text-sm font-medium">{formatCurrency(Number(order.totalAmount), locale)}</div>
                          <div className="px-4 py-4 text-sm text-muted-foreground flex items-center justify-center">{(() => {
                            const p = (order.payment?.provider ?? '').toLowerCase()
                            const m = (order.payment?.method ?? '').toLowerCase()
                            if (p === 'stripe' || m === 'card') return <StripeLogo className="h-5" />
                            if (p === 'paypal' || m === 'paypal') return <PayPalLogo className="h-5" />
                            if (p === 'klarna' || m === 'klarna') return <KlarnaLogo className="h-5" />
                            if (p === 'sumup' || m === 'sumup') return <SumUpLogo className="h-5" />
                            if (m === 'vorkasse' || p === 'vorkasse') return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted">Vorkasse</span>
                            return <span>{order.payment?.provider ?? '—'}</span>
                          })()}</div>
                        </div>
                      )
                    })}
                  </React.Fragment>
                ))
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
