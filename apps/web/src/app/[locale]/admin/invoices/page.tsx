'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { formatDate, formatCurrency } from '@/lib/locale-utils'
import { useAuthStore } from '@/store/auth-store'
import { Search, Download, FileText, Receipt, CreditCard, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateTimePicker } from '@/components/ui/datetime-picker'

const L: Record<string, Record<string, string>> = {
  title: { de: 'Rechnungen', en: 'Invoices', ar: 'الفواتير' },
  search: { de: 'Suche nach Nummer, Kunde...', en: 'Search by number, customer...', ar: 'بحث برقم، عميل...' },
  csv: { de: 'CSV Export', en: 'CSV Export', ar: 'تصدير CSV' },
  all: { de: 'Alle', en: 'All', ar: 'الكل' },
  invoice: { de: 'Rechnung', en: 'Invoice', ar: 'فاتورة' },
  credit: { de: 'Gutschrift', en: 'Credit Note', ar: 'إشعار دائن' },
  number: { de: 'Nummer', en: 'Number', ar: 'الرقم' },
  type: { de: 'Typ', en: 'Type', ar: 'النوع' },
  order: { de: 'Bestellung', en: 'Order', ar: 'الطلب' },
  customer: { de: 'Kunde', en: 'Customer', ar: 'العميل' },
  date: { de: 'Datum', en: 'Date', ar: 'التاريخ' },
  net: { de: 'Netto', en: 'Net', ar: 'صافي' },
  tax: { de: 'MwSt', en: 'VAT', ar: 'ضريبة' },
  gross: { de: 'Brutto', en: 'Gross', ar: 'إجمالي' },
  noData: { de: 'Keine Rechnungen', en: 'No invoices', ar: 'لا توجد فواتير' },
  clear: { de: 'Zurücksetzen', en: 'Clear', ar: 'مسح' },
  page: { de: 'Seite', en: 'Page', ar: 'صفحة' },
  of: { de: 'von', en: 'of', ar: 'من' },
  ref: { de: 'Ref:', en: 'Ref:', ar: 'مرجع:' },
}
const t = (k: string, loc: string) => L[k]?.[loc] ?? L[k]?.de ?? k

const LIMIT = 50
const API = API_BASE_URL

export default function AdminInvoicesPage() {
  const locale = useLocale()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-invoices', search, typeFilter, dateFrom, dateTo, offset],
    queryFn: async () => {
      const { data } = await api.get('/admin/invoices', {
        params: { search: search || undefined, type: typeFilter || undefined, from: dateFrom || undefined, to: dateTo || undefined, limit: LIMIT, offset },
      })
      return data as { data: any[]; meta: { total: number } }
    },
  })

  const rows = data?.data ?? []
  const total = data?.meta?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / LIMIT))
  const page = Math.floor(offset / LIMIT) + 1

  const dl = async (id: string, num: string) => {
    const tk = useAuthStore.getState().adminAccessToken
    const r = await fetch(`${API}/api/v1/admin/invoices/${id}/download`, { headers: { Authorization: `Bearer ${tk}` }, credentials: 'include' })
    if (!r.ok) return
    const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${num}.pdf`; a.click(); URL.revokeObjectURL(u)
  }

  const csv = async () => {
    const tk = useAuthStore.getState().adminAccessToken
    const p = new URLSearchParams(); if (dateFrom) p.set('from', dateFrom); if (dateTo) p.set('to', dateTo); const q = p.toString()
    const r = await fetch(`${API}/api/v1/admin/invoices/export/csv${q ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${tk}` }, credentials: 'include' })
    if (!r.ok) return
    const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `rechnungen-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(u)
  }

  const hasF = !!typeFilter || !!dateFrom || !!dateTo
  const clr = () => { setTypeFilter(''); setDateFrom(''); setDateTo(''); setOffset(0) }
  const fc = (n: number) => formatCurrency(n, locale)

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('title', locale) }]} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" style={{ color: '#d4a853' }} />
          {t('title', locale)}
        </h1>
        <Button variant="outline" size="sm" onClick={csv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />{t('csv', locale)}
        </Button>
      </div>

      {/* Filters — same pattern as orders */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground rtl:left-auto rtl:right-3" />
          <Input placeholder={t('search', locale)} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0) }} className="pl-10 rtl:pl-3 rtl:pr-10" />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setOffset(0) }} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[140px]">
          <option value="">{t('all', locale)}</option>
          <option value="INVOICE">{t('invoice', locale)}</option>
          <option value="CREDIT_NOTE">{t('credit', locale)}</option>
        </select>
        <div className="flex items-center gap-2">
          <DateTimePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setOffset(0) }} placeholder="tt.mm.jjjj" showTime={false} />
          <span className="text-muted-foreground text-sm">—</span>
          <DateTimePicker value={dateTo} onChange={(v) => { setDateTo(v); setOffset(0) }} placeholder="tt.mm.jjjj" showTime={false} />
        </div>
        {hasF && (
          <Button variant="ghost" size="sm" onClick={clr} className="gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" />{t('clear', locale)}
          </Button>
        )}
      </div>

      {/* Table — EXACT same structure as orders/page.tsx */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '3%' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t('number', locale)}</th>
                <th className="text-start px-4 py-3 font-medium">{t('type', locale)}</th>
                <th className="text-start px-4 py-3 font-medium">{t('order', locale)}</th>
                <th className="text-start px-4 py-3 font-medium">{t('customer', locale)}</th>
                <th className="text-start px-4 py-3 font-medium">{t('date', locale)}</th>
                <th className="text-end px-4 py-3 font-medium">{t('net', locale)}</th>
                <th className="text-end px-4 py-3 font-medium">{t('tax', locale)}</th>
                <th className="text-end px-4 py-3 font-medium">{t('gross', locale)}</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">{t('noData', locale)}</td></tr>
              ) : (
                rows.map((inv: any) => (
                  <tr key={inv.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-medium text-primary">{inv.invoiceNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      {inv.type === 'INVOICE' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <FileText className="h-3 w-3" />{t('invoice', locale)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <CreditCard className="h-3 w-3" />{t('credit', locale)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="font-mono text-xs">{inv.orderNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{inv.customerName}</p>
                      <p className="text-xs text-muted-foreground">{inv.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.createdAt, locale)}</td>
                    <td className="px-4 py-3 text-end font-medium">{fc(Number(inv.netAmount))}</td>
                    <td className="px-4 py-3 text-end text-muted-foreground text-xs">{fc(Number(inv.taxAmount))}</td>
                    <td className="px-4 py-3 text-end font-bold">{fc(Number(inv.grossAmount))}</td>
                    <td className="px-2 py-3">
                      <button onClick={() => dl(inv.id, inv.invoiceNumber)} className="p-1 rounded hover:bg-muted" title={inv.invoiceNumber}>
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">{t('page', locale)} {page} {t('of', locale)} {pages}</p>
          <div className="flex gap-1" dir="ltr">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
