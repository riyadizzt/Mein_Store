'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { formatDate, formatCurrency } from '@/lib/locale-utils'
import { useAuthStore } from '@/store/auth-store'
import {
  Search, Download, FileText, Receipt, CreditCard,
  Calendar, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const LABELS: Record<string, Record<string, string>> = {
  title:        { de: 'Rechnungen',         en: 'Invoices',           ar: 'الفواتير' },
  search:       { de: 'Suche nach Nummer, Kunde...', en: 'Search by number, customer...', ar: 'بحث برقم، عميل...' },
  csvExport:    { de: 'CSV Export',          en: 'CSV Export',         ar: 'تصدير CSV' },
  all:          { de: 'Alle',                en: 'All',                ar: 'الكل' },
  invoice:      { de: 'Rechnung',            en: 'Invoice',            ar: 'فاتورة' },
  creditNote:   { de: 'Gutschrift',          en: 'Credit Note',        ar: 'إشعار دائن' },
  number:       { de: 'Nummer',              en: 'Number',             ar: 'الرقم' },
  type:         { de: 'Typ',                 en: 'Type',               ar: 'النوع' },
  order:        { de: 'Bestellung',          en: 'Order',              ar: 'الطلب' },
  customer:     { de: 'Kunde',               en: 'Customer',           ar: 'العميل' },
  date:         { de: 'Datum',               en: 'Date',               ar: 'التاريخ' },
  net:          { de: 'Netto',               en: 'Net',                ar: 'صافي' },
  tax:          { de: 'MwSt',                en: 'VAT',                ar: 'ضريبة' },
  gross:        { de: 'Brutto',              en: 'Gross',              ar: 'إجمالي' },
  actions:      { de: 'Aktionen',            en: 'Actions',            ar: 'إجراءات' },
  download:     { de: 'Herunterladen',       en: 'Download',           ar: 'تحميل' },
  noInvoices:   { de: 'Keine Rechnungen gefunden', en: 'No invoices found', ar: 'لم يتم العثور على فواتير' },
  from:         { de: 'Von',                 en: 'From',               ar: 'من' },
  to:           { de: 'Bis',                 en: 'To',                 ar: 'إلى' },
  page:         { de: 'Seite',               en: 'Page',               ar: 'صفحة' },
  of:           { de: 'von',                 en: 'of',                 ar: 'من' },
  refFor:       { de: 'Ref:',                en: 'Ref:',               ar: 'مرجع:' },
  filters:      { de: 'Filter',              en: 'Filters',            ar: 'تصفية' },
  clearFilters: { de: 'Filter zurücksetzen', en: 'Clear filters',      ar: 'مسح التصفية' },
}

function t3(key: string, locale: string): string {
  return LABELS[key]?.[locale] ?? LABELS[key]?.de ?? key
}

const LIMIT = 50
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface Invoice {
  id: string
  invoiceNumber: string
  type: string
  orderNumber: string
  customerName: string
  customerEmail: string
  originalInvoiceNumber: string | null
  netAmount: number
  taxAmount: number
  grossAmount: number
  createdAt: string
}

interface InvoiceMeta {
  total: number
  limit: number
  offset: number
}

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
        params: {
          search: search || undefined,
          type: typeFilter || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          limit: LIMIT,
          offset,
        },
      })
      return data as { data: Invoice[]; meta: InvoiceMeta }
    },
  })

  const invoices = data?.data ?? []
  const meta = data?.meta ?? { total: 0, limit: LIMIT, offset: 0 }
  const totalPages = Math.max(1, Math.ceil(meta.total / LIMIT))
  const currentPage = Math.floor(offset / LIMIT) + 1

  const handleDownload = async (id: string, invoiceNumber: string) => {
    const token = useAuthStore.getState().adminAccessToken
    const res = await fetch(`${API_URL}/api/v1/admin/invoices/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${invoiceNumber}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = async () => {
    const token = useAuthStore.getState().adminAccessToken
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    const qs = params.toString()
    const res = await fetch(`${API_URL}/api/v1/admin/invoices/export/csv${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rechnungen-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasFilters = !!typeFilter || !!dateFrom || !!dateTo
  const clearFilters = () => {
    setTypeFilter('')
    setDateFrom('')
    setDateTo('')
    setOffset(0)
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3('title', locale) }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" style={{ color: '#d4a853' }} />
          {t3('title', locale)}
        </h1>
        <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {t3('csvExport', locale)}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground rtl:left-auto rtl:right-3" />
          <Input
            placeholder={t3('search', locale)}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0) }}
            className="pl-10 rtl:pl-3 rtl:pr-10"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setOffset(0) }}
          className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[140px]"
        >
          <option value="">{t3('all', locale)}</option>
          <option value="INVOICE">{t3('invoice', locale)}</option>
          <option value="CREDIT_NOTE">{t3('creditNote', locale)}</option>
        </select>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0) }}
            className="h-10 px-3 rounded-lg border bg-background text-sm"
            title={t3('from', locale)}
          />
          <span className="text-muted-foreground text-sm">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0) }}
            className="h-10 px-3 rounded-lg border bg-background text-sm"
            title={t3('to', locale)}
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            {t3('clearFilters', locale)}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left rtl:text-right px-4 py-3 font-medium">{t3('number', locale)}</th>
                <th className="text-left rtl:text-right px-4 py-3 font-medium">{t3('type', locale)}</th>
                <th className="text-left rtl:text-right px-4 py-3 font-medium">{t3('order', locale)}</th>
                <th className="text-left rtl:text-right px-4 py-3 font-medium">{t3('customer', locale)}</th>
                <th className="text-left rtl:text-right px-4 py-3 font-medium">{t3('date', locale)}</th>
                <th className="text-right rtl:text-left px-4 py-3 font-medium">{t3('net', locale)}</th>
                <th className="text-right rtl:text-left px-4 py-3 font-medium">{t3('tax', locale)}</th>
                <th className="text-right rtl:text-left px-4 py-3 font-medium">{t3('gross', locale)}</th>
                <th className="text-center px-4 py-3 font-medium">{t3('actions', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    {t3('noInvoices', locale)}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-primary">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3">
                      {inv.type === 'INVOICE' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <FileText className="h-3 w-3" />
                          {t3('invoice', locale)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <CreditCard className="h-3 w-3" />
                          {t3('creditNote', locale)}
                        </span>
                      )}
                      {inv.originalInvoiceNumber && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t3('refFor', locale)} {inv.originalInvoiceNumber}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{inv.orderNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{inv.customerName}</p>
                      <p className="text-xs text-muted-foreground">{inv.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(inv.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-right rtl:text-left font-medium tabular-nums">
                      {formatCurrency(Number(inv.netAmount), locale)}
                    </td>
                    <td className="px-4 py-3 text-right rtl:text-left text-muted-foreground tabular-nums">
                      {formatCurrency(Number(inv.taxAmount), locale)}
                    </td>
                    <td className="px-4 py-3 text-right rtl:text-left font-bold tabular-nums">
                      {formatCurrency(Number(inv.grossAmount), locale)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(inv.id, inv.invoiceNumber)}
                        className="gap-1 hover:text-[#d4a853]"
                        title={t3('download', locale)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
            <p className="text-sm text-muted-foreground">
              {t3('page', locale)} {currentPage} {t3('of', locale)} {totalPages}
              <span className="ml-2 text-xs">({meta.total})</span>
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= meta.total}
                onClick={() => setOffset(offset + LIMIT)}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
