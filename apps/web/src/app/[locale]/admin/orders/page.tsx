'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDate, formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { ChannelIcon, CHANNEL_CONFIG } from '@/components/admin/channel-icon'

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
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
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
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t('orders.order')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('orders.customer')}</th>
                <th className="text-center px-2 py-3 font-medium">{locale === 'ar' ? 'القناة' : locale === 'en' ? 'Channel' : 'Kanal'}</th>
                <th className="text-start px-4 py-3 font-medium">{t('orders.date')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('orders.status')}</th>
                <th className="text-end px-4 py-3 font-medium">{t('orders.amount')}</th>
                <th className="text-start px-4 py-3 font-medium">{t('orders.payment')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : (orders ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('orders.noOrders')}</td></tr>
              ) : (
                (orders ?? []).map((order: any) => {
                  const statusColor = STATUS_COLORS[order.status] ?? 'bg-gray-100'
                  return (
                    <tr key={order.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/${locale}/admin/orders/${order.id}`} className="font-mono font-medium text-primary hover:underline">
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium flex items-center gap-1.5">
                          {getCustomerName(order)}
                          {!order.user && order.guestEmail && <span className="text-[10px] font-normal text-muted-foreground">(Gast)</span>}
                          {(() => { const loc = getOrderLocale(order); const badge = LOCALE_BADGE[loc]; return badge ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.bg}`}>{badge.label}</span> : null })()}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.user?.email ?? order.guestEmail ?? ''}</p>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <div className="flex justify-center"><ChannelIcon channel={order.channel ?? 'website'} size={18} /></div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(order.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>{t(`status.${order.status}`)}</span>
                      </td>
                      <td className="px-4 py-3 text-end font-medium">{formatCurrency(Number(order.totalAmount), locale)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{order.payment?.provider ?? '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
