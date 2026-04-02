'use client'

import { useState, Fragment } from 'react'
import { useLocale } from 'next-intl'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HandCoins, CreditCard, MapPin, Phone, Mail, FileText, Package, Banknote, Truck, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

type Tab = 'overview' | 'deliveries' | 'payments'

export default function SupplierProfilePage() {
  const locale = useLocale()
  const { id } = useParams() as { id: string }
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', notes: '' })
  const [editPayment, setEditPayment] = useState<any>(null)
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null)
  const [cancelDeliveryId, setCancelDeliveryId] = useState<string | null>(null)

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => { const { data } = await api.get(`/admin/suppliers/${id}`); return data },
  })

  const { data: deliveries } = useQuery({
    queryKey: ['supplier-deliveries', id],
    queryFn: async () => { const { data } = await api.get(`/admin/suppliers/${id}/deliveries`); return data },
  })

  const { data: payments } = useQuery({
    queryKey: ['supplier-payments', id],
    queryFn: async () => { const { data } = await api.get(`/admin/suppliers/${id}/payments`); return data },
  })

  const payMut = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/suppliers/${id}/payments`, {
        amount: parseFloat(payForm.amount),
        method: payForm.method,
        notes: payForm.notes || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] })
      qc.invalidateQueries({ queryKey: ['supplier-deliveries', id] })
      qc.invalidateQueries({ queryKey: ['supplier-payments', id] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      setShowPayment(false)
      setPayForm({ amount: '', method: 'cash', notes: '' })
    },
  })

  const editPayMut = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/suppliers/payments/${editPayment.id}`, {
        amount: parseFloat(editPayment.amount),
        method: editPayment.method,
        notes: editPayment.notes || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] })
      qc.invalidateQueries({ queryKey: ['supplier-payments', id] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      setEditPayment(null)
    },
  })

  const deletePayMut = useMutation({
    mutationFn: async (paymentId: string) => { await api.delete(`/admin/suppliers/payments/${paymentId}`) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] })
      qc.invalidateQueries({ queryKey: ['supplier-payments', id] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      setDeletePaymentId(null)
    },
  })

  const cancelDeliveryMut = useMutation({
    mutationFn: async (deliveryId: string) => { const { data } = await api.post(`/admin/suppliers/deliveries/${deliveryId}/cancel`); return data },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier', id] })
      qc.invalidateQueries({ queryKey: ['supplier-deliveries', id] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      setCancelDeliveryId(null)
    },
  })

  const numFmt = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  const fmt = (n: number) => n.toLocaleString(numFmt, { style: 'currency', currency: 'EUR' })
  const dateFmt = (d: string) => new Date(d).toLocaleDateString(numFmt, { day: '2-digit', month: '2-digit', year: 'numeric' })

  if (isLoading) return <div className="animate-pulse space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl" />)}</div>
  if (!supplier) return null

  const tabs = [
    { key: 'overview' as Tab, label: t3(locale, 'Übersicht', 'Overview', 'نظرة عامة'), icon: HandCoins },
    { key: 'deliveries' as Tab, label: t3(locale, 'Lieferungen', 'Deliveries', 'التوريدات'), icon: Truck, count: deliveries?.data?.filter((d: any) => d.status !== 'cancelled').length },
    { key: 'payments' as Tab, label: t3(locale, 'Zahlungen', 'Payments', 'المدفوعات'), icon: Banknote, count: payments?.data?.length },
  ]

  return (
    <div>
      <AdminBreadcrumb items={[
        { label: t3(locale, 'Lieferanten', 'Suppliers', 'الموردون'), href: `/${locale}/admin/suppliers` },
        { label: supplier.name },
      ]} />

      {/* Header with balance */}
      <div className="bg-background border rounded-2xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Info */}
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HandCoins className="h-6 w-6 text-[#d4a853]" />
              {supplier.name}
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
              {supplier.country && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{supplier.country}</span>}
              {supplier.contactPerson && <span>{supplier.contactPerson}</span>}
              {supplier.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{supplier.phone}</span>}
              {supplier.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{supplier.email}</span>}
            </div>
            {supplier.notes && <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1"><FileText className="h-3 w-3" />{supplier.notes}</p>}
            <Link href={`/${locale}/admin/suppliers`} className="inline-flex items-center gap-1 mt-2 text-xs text-[#d4a853] hover:underline">
              <Pencil className="h-3 w-3" /> {t3(locale, 'Bearbeiten', 'Edit', 'تعديل')}
            </Link>
          </div>

          {/* Balance + Pay Button */}
          <div className="flex items-center gap-4">
            <div className="text-end">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t3(locale, 'Wir schulden', 'We owe', 'نحن مدينون')}</p>
              <p className={`text-3xl font-bold tabular-nums ${supplier.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {fmt(Math.abs(supplier.balance))}
              </p>
              {supplier.balance <= 0 && <p className="text-xs text-green-400">{t3(locale, 'Alles bezahlt', 'All paid', 'تم السداد')}</p>}
            </div>
            {supplier.balance > 0 && (
              <Button onClick={() => setShowPayment(true)} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-1.5 h-11">
                <CreditCard className="h-4 w-4" />
                {t3(locale, 'Zahlung', 'Pay', 'دفع')}
              </Button>
            )}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{fmt(supplier.totalDeliveries)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t3(locale, 'Warenwert', 'Goods Value', 'قيمة البضاعة')}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-green-400">{fmt(supplier.totalPayments)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t3(locale, 'Bezahlt', 'Paid', 'المدفوع')}</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${supplier.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmt(supplier.balance)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t3(locale, 'Offen', 'Outstanding', 'المتبقي')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted/30 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 tabular-nums">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Recent deliveries */}
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">{t3(locale, 'Letzte Lieferungen', 'Recent Deliveries', 'آخر التوريدات')}</h3>
              <button onClick={() => setTab('deliveries')} className="text-xs text-[#d4a853] flex items-center gap-1">
                {t3(locale, 'Alle anzeigen', 'View all', 'عرض الكل')} <ChevronRight className="h-3 w-3 rtl:rotate-180" />
              </button>
            </div>
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '25%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead><tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">#</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Datum', 'Date', 'التاريخ')}</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Artikel', 'Items', 'القطع')}</th>
                <th className="text-end px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Betrag', 'Amount', 'المبلغ')}</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Status', 'Status', 'الحالة')}</th>
              </tr></thead>
              <tbody>
                {(deliveries?.data ?? []).slice(0, 5).map((d: any) => (
                  <tr key={d.id} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-xs">{d.deliveryNumber}</td>
                    <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{dateFmt(d.receivedAt)}</td>
                    <td className="px-4 py-3.5 text-center"><span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-lg bg-muted/60 text-xs font-semibold px-2">{d.itemCount}</span></td>
                    <td className="px-4 py-3.5 text-end"><span className="font-semibold text-[13px] tabular-nums">{fmt(Number(d.totalAmount))}</span></td>
                    <td className="px-4 py-3.5 text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full ${d.status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300' : d.status === 'partially_paid' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'}`}>{d.status === 'paid' ? t3(locale, 'Bezahlt', 'Paid', 'مدفوع') : d.status === 'partially_paid' ? t3(locale, 'Teilweise', 'Partial', 'جزئي') : t3(locale, 'Offen', 'Unpaid', 'مفتوح')}</span></td>
                  </tr>
                ))}
                {(deliveries?.data ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">{t3(locale, 'Keine Lieferungen', 'No deliveries', 'لا توجد توريدات')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Recent payments */}
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">{t3(locale, 'Letzte Zahlungen', 'Recent Payments', 'آخر المدفوعات')}</h3>
              <button onClick={() => setTab('payments')} className="text-xs text-[#d4a853] flex items-center gap-1">
                {t3(locale, 'Alle anzeigen', 'View all', 'عرض الكل')} <ChevronRight className="h-3 w-3 rtl:rotate-180" />
              </button>
            </div>
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '35%' }} />
                <col style={{ width: '25%' }} />
              </colgroup>
              <thead><tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Datum', 'Date', 'التاريخ')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Art', 'Method', 'الطريقة')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Notiz', 'Note', 'ملاحظة')}</th>
                <th className="text-end px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Betrag', 'Amount', 'المبلغ')}</th>
              </tr></thead>
              <tbody>
                {(payments?.data ?? []).slice(0, 5).map((p: any) => (
                  <tr key={p.id} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{dateFmt(p.paidAt)}</td>
                    <td className="px-4 py-3.5"><span className={`text-[10px] px-2 py-0.5 rounded-full ${p.method === 'cash' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'}`}>{p.method === 'cash' ? t3(locale, 'Bar', 'Cash', 'نقدي') : t3(locale, 'Überweisung', 'Transfer', 'تحويل')}</span></td>
                    <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{p.notes ?? '—'}</td>
                    <td className="px-4 py-3.5 text-end"><span className="font-semibold text-[13px] tabular-nums text-green-400">{fmt(Number(p.amount))}</span></td>
                  </tr>
                ))}
                {(payments?.data ?? []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">{t3(locale, 'Keine Zahlungen', 'No payments', 'لا توجد مدفوعات')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'deliveries' && (
        <div className="space-y-3">
          {(deliveries?.data ?? []).length === 0 ? (
            <div className="bg-background border rounded-xl p-12 text-center">
              <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
              <p className="text-muted-foreground text-sm">{t3(locale, 'Keine Lieferungen', 'No deliveries', 'لا توجد توريدات')}</p>
            </div>
          ) : (() => {
            // Group by date
            const grouped: Record<string, any[]> = {}
            for (const d of (deliveries?.data ?? [])) {
              const dk = new Date(d.receivedAt).toISOString().slice(0, 10)
              if (!grouped[dk]) grouped[dk] = []
              grouped[dk].push(d)
            }
            return Object.entries(grouped).map(([dateKey, dayDeliveries]) => (
              <div key={dateKey}>
                <div className="px-1 py-2 mb-2">
                  <span className="text-xs font-bold text-muted-foreground">{new Date(dateKey + 'T12:00:00').toLocaleDateString(numFmt, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span>
                  <span className="text-[10px] text-muted-foreground/50 ltr:ml-2 rtl:mr-2">{dayDeliveries.length} {t3(locale, 'Lieferungen', 'deliveries', 'توريدات')}</span>
                </div>
                <div className="space-y-2">
                  {dayDeliveries.map((d: any) => {
            const isOpen = expandedDelivery === d.id
            return (
              <div key={d.id} className={`bg-background border rounded-xl overflow-hidden ${d.status === 'cancelled' ? 'opacity-50' : ''}`}>
                {/* Delivery header — clickable */}
                <div className="flex items-center">
                  <div onClick={() => setExpandedDelivery(isOpen ? null : d.id)} className="flex-1 flex items-center gap-4 px-4 py-3 hover:bg-muted/10 transition-colors cursor-pointer">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span className="font-mono text-xs font-bold min-w-[120px]">{d.deliveryNumber}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{dateFmt(d.receivedAt)}</span>
                    <span className="text-xs text-muted-foreground">{d.itemCount} {t3(locale, 'Artikel', 'items', 'قطعة')}</span>
                    <span className="flex-1" />
                    <span className={`font-semibold tabular-nums ${d.status === 'cancelled' ? 'line-through' : ''}`}>{fmt(Number(d.totalAmount))}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      d.status === 'cancelled' ? 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400 line-through' :
                      d.status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300' :
                      d.status === 'partially_paid' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' :
                      'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
                    }`}>
                      {d.status === 'cancelled' ? t3(locale, 'Storniert', 'Cancelled', 'ملغاة') :
                       d.status === 'paid' ? t3(locale, 'Bezahlt', 'Paid', 'مدفوع') :
                       d.status === 'partially_paid' ? t3(locale, 'Teilweise', 'Partial', 'جزئي') :
                       t3(locale, 'Offen', 'Unpaid', 'مفتوح')}
                    </span>
                  </div>
                  {d.status !== 'cancelled' && (
                    <button onClick={() => setCancelDeliveryId(d.id)} className="p-2 ltr:mr-2 rtl:ml-2 rounded-lg hover:bg-red-100 transition-colors" title={t3(locale, 'Stornieren', 'Cancel', 'إلغاء')}>
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                    </button>
                  )}
                </div>

                {/* Expanded items — grouped by product */}
                {isOpen && (d.items ?? []).length > 0 && (
                  <div className="border-t">
                    {(() => {
                      const COLOR_HEX: Record<string, string> = { Schwarz:'#000', Weiß:'#FFF', Grau:'#808080', Rot:'#DC2626', Blau:'#2563EB', Navy:'#1E3A5F', Grün:'#16A34A', Gelb:'#EAB308', Orange:'#EA580C', Pink:'#EC4899', Rosa:'#F9A8D4', Lila:'#9333EA', Braun:'#92400E', Beige:'#D2B48C', Creme:'#FFFDD0', Gold:'#D4A853', Silber:'#C0C0C0', Bordeaux:'#722F37', Khaki:'#BDB76B', Türkis:'#06B6D4', Hellblau:'#93C5FD', Dunkelgrün:'#14532D', Anthrazit:'#374151', Dunkelgrau:'#555' }
                      // Group items by productName
                      const groups: Record<string, any[]> = {}
                      for (const item of (d.items ?? [])) {
                        const key = item.productName || item.sku || 'unknown'
                        if (!groups[key]) groups[key] = []
                        groups[key].push(item)
                      }
                      return Object.entries(groups).map(([productName, items]) => {
                        const firstItem = items[0]
                        const totalQty = items.reduce((s: number, i: any) => s + i.quantity, 0)
                        const totalCost = items.reduce((s: number, i: any) => s + Number(i.totalCost), 0)
                        return (
                          <div key={productName} className="p-4 border-b border-border/10 last:border-0">
                            {/* Product header */}
                            <div className="flex items-center gap-3 mb-3">
                              {firstItem.image ? (
                                <img src={firstItem.image} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
                                  <Package className="h-5 w-5 text-muted-foreground/30" />
                                </div>
                              )}
                              <div className="flex-1">
                                <p className="font-semibold text-sm">{productName}</p>
                                <p className="text-xs text-muted-foreground">{totalQty} {t3(locale, 'Stück', 'pcs', 'قطعة')} · {fmt(totalCost)}</p>
                              </div>
                            </div>
                            {/* Variants table */}
                            <div className="grid grid-cols-4 gap-0 text-xs">
                              {/* Header */}
                              <div className="px-3 py-2 bg-muted/10 font-semibold text-muted-foreground">{t3(locale, 'Größe', 'Size', 'المقاس')}</div>
                              <div className="px-3 py-2 bg-muted/10 font-semibold text-muted-foreground text-center">{t3(locale, 'Menge', 'Qty', 'الكمية')}</div>
                              <div className="px-3 py-2 bg-muted/10 font-semibold text-muted-foreground text-center">{t3(locale, 'Stückpreis', 'Unit', 'سعر الوحدة')}</div>
                              <div className="px-3 py-2 bg-muted/10 font-semibold text-muted-foreground text-center">{t3(locale, 'Gesamt', 'Total', 'الإجمالي')}</div>
                              {/* Rows */}
                              {items.map((item: any, idx: number) => (
                                <Fragment key={idx}>
                                  <div className="px-3 py-2 border-t border-border/5">
                                    <div className="flex items-center gap-1.5">
                                      {item.color && COLOR_HEX[item.color] && <span className={`w-3.5 h-3.5 rounded-full flex-shrink-0 ${COLOR_HEX[item.color] === '#FFF' ? 'border border-gray-200' : ''}`} style={{ backgroundColor: COLOR_HEX[item.color] }} />}
                                      <span>{item.size || '—'}</span>
                                    </div>
                                    {item.sku && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.sku}</p>}
                                  </div>
                                  <div className="px-3 py-2 border-t border-border/5 text-center font-semibold tabular-nums">{item.quantity}</div>
                                  <div className="px-3 py-2 border-t border-border/5 text-center text-muted-foreground tabular-nums">{fmt(Number(item.unitCost))}</div>
                                  <div className="px-3 py-2 border-t border-border/5 text-center font-semibold tabular-nums">{fmt(Number(item.totalCost))}</div>
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    })()}
                    {d.notes && <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border/10">{d.notes}</p>}
                  </div>
                )}
              </div>
            )
          })}
                </div>
              </div>
            ))
          })()}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {supplier.balance > 0 && (
              <Button onClick={() => setShowPayment(true)} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-1.5">
                <CreditCard className="h-4 w-4" />
                {t3(locale, 'Zahlung erfassen', 'Record Payment', 'تسجيل دفعة')}
              </Button>
            )}
          </div>
          <div className="bg-background border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Datum', 'Date', 'التاريخ')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Zahlungsart', 'Method', 'طريقة الدفع')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Notiz', 'Note', 'ملاحظة')}</th>
                <th className="text-end px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Betrag', 'Amount', 'المبلغ')}</th>
                <th className="px-4 py-3 w-20"></th>
              </tr></thead>
              <tbody>
                {(payments?.data ?? []).map((p: any) => (
                  <tr key={p.id} className="border-b hover:bg-muted/20 transition-colors group">
                    <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{dateFmt(p.paidAt)}</td>
                    <td className="px-4 py-3.5"><span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${p.method === 'cash' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'}`}>{p.method === 'cash' ? t3(locale, 'Bar', 'Cash', 'نقدي') : t3(locale, 'Überweisung', 'Transfer', 'تحويل بنكي')}</span></td>
                    <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{p.notes ?? '—'}</td>
                    <td className="px-4 py-3.5 text-end"><span className="font-bold text-[13px] tabular-nums text-green-400">{fmt(Number(p.amount))}</span></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditPayment({ id: p.id, amount: String(Number(p.amount)), method: p.method, notes: p.notes ?? '' })} className="p-1.5 rounded-lg hover:bg-muted"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => setDeletePaymentId(p.id)} className="p-1.5 rounded-lg hover:bg-red-100"><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(payments?.data ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center">
                    <Banknote className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                    <p className="text-muted-foreground text-sm">{t3(locale, 'Keine Zahlungen', 'No payments', 'لا توجد مدفوعات')}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancel Delivery Modal */}
      {cancelDeliveryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCancelDeliveryId(null)}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-red-500">{t3(locale, 'Lieferung stornieren?', 'Cancel Delivery?', 'إلغاء التوريد؟')}</h2>
            <p className="text-sm text-muted-foreground">
              {t3(locale,
                'Die gesamte Lieferung wird storniert. Der Bestand aller enthaltenen Produkte wird zurückgebucht und der Lieferanten-Saldo angepasst.',
                'The entire delivery will be cancelled. Stock for all items will be reverted and the supplier balance adjusted.',
                'سيتم إلغاء التوريد بالكامل. سيتم إرجاع المخزون لجميع المنتجات وتعديل رصيد المورد.'
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelDeliveryId(null)}>{t3(locale, 'Abbrechen', 'Cancel', 'تراجع')}</Button>
              <Button onClick={() => cancelDeliveryMut.mutate(cancelDeliveryId)} disabled={cancelDeliveryMut.isPending} className="bg-red-500 hover:bg-red-600 text-white">
                {cancelDeliveryMut.isPending ? '...' : t3(locale, 'Stornieren', 'Confirm Cancel', 'تأكيد الإلغاء')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      {editPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditPayment(null)}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{t3(locale, 'Zahlung bearbeiten', 'Edit Payment', 'تعديل الدفعة')}</h2>
            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Betrag (€)', 'Amount (€)', 'المبلغ (€)')}</label>
              <input type="number" step="0.01" value={editPayment.amount} onChange={(e) => setEditPayment({ ...editPayment, amount: e.target.value })} className="w-full h-12 px-4 rounded-lg border bg-background text-lg font-bold mt-1 tabular-nums" autoFocus />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Zahlungsart', 'Method', 'طريقة الدفع')}</label>
              <div className="flex gap-3 mt-1">
                {(['cash', 'bank_transfer'] as const).map((m) => (
                  <button key={m} onClick={() => setEditPayment({ ...editPayment, method: m })} className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${editPayment.method === m ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853]' : 'text-muted-foreground'}`}>
                    {m === 'cash' ? t3(locale, 'Bar', 'Cash', 'نقدي') : t3(locale, 'Überweisung', 'Transfer', 'تحويل بنكي')}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Notiz', 'Note', 'ملاحظة')}</label>
              <input value={editPayment.notes} onChange={(e) => setEditPayment({ ...editPayment, notes: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditPayment(null)}>{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
              <Button onClick={() => editPayMut.mutate()} disabled={!editPayment.amount || editPayMut.isPending} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-1">
                {editPayMut.isPending ? '...' : t3(locale, 'Speichern', 'Save', 'حفظ')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Payment Confirm */}
      {deletePaymentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletePaymentId(null)}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-red-500">{t3(locale, 'Zahlung löschen?', 'Delete Payment?', 'حذف الدفعة؟')}</h2>
            <p className="text-sm text-muted-foreground">{t3(locale, 'Diese Zahlung wird dauerhaft gelöscht. Der Lieferanten-Saldo wird automatisch angepasst.', 'This payment will be permanently deleted. The supplier balance will be adjusted.', 'سيتم حذف هذه الدفعة نهائياً. سيتم تعديل رصيد المورد تلقائياً.')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeletePaymentId(null)}>{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
              <Button onClick={() => deletePayMut.mutate(deletePaymentId)} disabled={deletePayMut.isPending} className="bg-red-500 hover:bg-red-600 text-white">
                {deletePayMut.isPending ? '...' : t3(locale, 'Löschen', 'Delete', 'حذف')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPayment(false)}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{t3(locale, 'Zahlung erfassen', 'Record Payment', 'تسجيل دفعة')}</h2>
            <p className="text-sm text-muted-foreground">
              {t3(locale, 'Offener Saldo', 'Open balance', 'الرصيد المفتوح')}: <span className="font-bold text-red-400">{fmt(supplier.balance)}</span>
            </p>

            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Betrag (€)', 'Amount (€)', 'المبلغ (€)')}</label>
              <input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-full h-12 px-4 rounded-lg border bg-background text-lg font-bold mt-1 tabular-nums" autoFocus />
            </div>

            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Zahlungsart', 'Method', 'طريقة الدفع')}</label>
              <div className="flex gap-3 mt-1">
                {(['cash', 'bank_transfer'] as const).map((m) => (
                  <button key={m} onClick={() => setPayForm({ ...payForm, method: m })} className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${payForm.method === m ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853]' : 'text-muted-foreground'}`}>
                    {m === 'cash' ? t3(locale, 'Bar', 'Cash', 'نقدي') : t3(locale, 'Überweisung', 'Transfer', 'تحويل بنكي')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">{t3(locale, 'Notiz', 'Note', 'ملاحظة')}</label>
              <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowPayment(false)}>{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
              <Button onClick={() => payMut.mutate()} disabled={!payForm.amount || parseFloat(payForm.amount) <= 0 || payMut.isPending} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-1">
                <CreditCard className="h-4 w-4" />
                {payMut.isPending ? '...' : t3(locale, 'Zahlung buchen', 'Confirm', 'تأكيد الدفع')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
