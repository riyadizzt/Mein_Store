'use client'

import { API_BASE_URL } from '@/lib/env'
import React, { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RotateCcw, Search, Package, X, Check, Truck,
  Download, Eye, TrendingDown, BarChart3, Euro, AlertTriangle,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { formatDate, formatDateWithWeekday, formatTime, formatCurrency } from '@/lib/locale-utils'
import { PayPalLogo, KlarnaLogo, SumUpLogo, StripeLogo } from '@/components/ui/payment-logos'

// ── Status & Reason maps ────────────────────────────────────
const STATUS_KEYS = ['requested', 'label_sent', 'in_transit', 'received', 'inspected', 'refunded', 'rejected'] as const
type ReturnStatus = (typeof STATUS_KEYS)[number]

const STATUS_DOT: Record<ReturnStatus, string> = {
  requested: 'bg-yellow-400', label_sent: 'bg-blue-400', in_transit: 'bg-purple-400',
  received: 'bg-orange-400', inspected: 'bg-cyan-400', refunded: 'bg-green-400', rejected: 'bg-red-400',
}
const STATUS_BADGE: Record<ReturnStatus, string> = {
  requested: 'bg-yellow-100 text-yellow-800', label_sent: 'bg-blue-100 text-blue-800',
  in_transit: 'bg-purple-100 text-purple-800', received: 'bg-orange-100 text-orange-800',
  inspected: 'bg-cyan-100 text-cyan-800', refunded: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const REASON_KEYS = ['wrong_size', 'wrong_product', 'quality_issue', 'damaged', 'changed_mind', 'right_of_withdrawal', 'other'] as const
type ReturnReason = (typeof REASON_KEYS)[number]

const REASON_LABELS: Record<ReturnReason, { de: string; en: string; ar: string }> = {
  wrong_size:          { de: 'Falsche Gr\u00f6\u00dfe',  en: 'Wrong size',            ar: '\u0645\u0642\u0627\u0633 \u062e\u0627\u0637\u0626' },
  wrong_product:       { de: 'Falscher Artikel',          en: 'Wrong product',          ar: '\u0645\u0646\u062a\u062c \u062e\u0627\u0637\u0626' },
  quality_issue:       { de: 'Qualit\u00e4tsproblem',     en: 'Quality issue',          ar: '\u0645\u0634\u0643\u0644\u0629 \u062c\u0648\u062f\u0629' },
  damaged:             { de: 'Besch\u00e4digt',           en: 'Damaged',                ar: '\u062a\u0627\u0644\u0641' },
  changed_mind:        { de: 'Meinung ge\u00e4ndert',     en: 'Changed mind',           ar: '\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0631\u0623\u064a' },
  right_of_withdrawal: { de: 'Widerrufsrecht',            en: 'Right of withdrawal',    ar: '\u062d\u0642 \u0627\u0644\u0633\u062d\u0628' },
  other:               { de: 'Sonstiges',                 en: 'Other',                  ar: '\u0623\u062e\u0631\u0649' },
}

const STATUS_LABELS: Record<ReturnStatus, { de: string; en: string; ar: string }> = {
  requested:  { de: 'Angefragt',   en: 'Requested',  ar: '\u0645\u0637\u0644\u0648\u0628' },
  label_sent: { de: 'Label gesendet', en: 'Label sent', ar: '\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0635\u0642' },
  in_transit: { de: 'Unterwegs',   en: 'In transit', ar: '\u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642' },
  received:   { de: 'Eingegangen', en: 'Received',   ar: '\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645' },
  inspected:  { de: 'Gepr\u00fcft',    en: 'Inspected',  ar: '\u062a\u0645 \u0627\u0644\u0641\u062d\u0635' },
  refunded:   { de: 'Erstattet',   en: 'Refunded',   ar: '\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f' },
  rejected:   { de: 'Abgelehnt',   en: 'Rejected',   ar: '\u0645\u0631\u0641\u0648\u0636' },
}

// ── Component ───────────────────────────────────────────────
export default function AdminReturnsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const reasonLabel = (r: string) => REASON_LABELS[r as ReturnReason]?.[locale as 'de' | 'en' | 'ar'] ?? r
  const statusLabel = (s: string) => STATUS_LABELS[s as ReturnStatus]?.[locale as 'de' | 'en' | 'ar'] ?? s

  // ── State ──────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectItems, setInspectItems] = useState<Record<string, 'ok' | 'damaged'>>({})
  const [rejectReason, setRejectReason] = useState('')
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())

  // ── Queries ────────────────────────────────────────────────
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-returns', statusFilter, reasonFilter, search],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '50', offset: '0' }
      if (statusFilter) params.status = statusFilter
      if (reasonFilter) params.reason = reasonFilter
      if (search) params.search = search
      const { data } = await api.get('/admin/returns', { params })
      return data as { data: any[]; meta: { total: number } }
    },
  })

  const returns = result?.data ?? []

  const { data: stats } = useQuery({
    queryKey: ['admin-returns-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/returns/stats'); return data },
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin-return', selectedId],
    queryFn: async () => { const { data } = await api.get(`/admin/returns/${selectedId}`); return data },
    enabled: !!selectedId,
  })

  // ── Mutations ──────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-returns'] })
    qc.invalidateQueries({ queryKey: ['admin-return', selectedId] })
    qc.invalidateQueries({ queryKey: ['admin-returns-stats'] })
  }

  const approveMut = useMutation({
    mutationFn: (sendLabel: boolean = false) => api.post(`/admin/returns/${selectedId}/approve`, { sendLabel }),
    onSuccess: invalidate,
  })

  const rejectMut = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/returns/${selectedId}/reject`, { reason }),
    onSuccess: () => { invalidate(); setRejectReason('') },
  })

  const inspectMut = useMutation({
    mutationFn: (items: { itemId: string; condition: 'ok' | 'damaged' }[]) =>
      api.post(`/admin/returns/${selectedId}/inspect`, { items }),
    onSuccess: () => { invalidate(); setInspectItems({}) },
  })

  const refundMut = useMutation({
    mutationFn: () => api.post(`/admin/returns/${selectedId}/refund`),
    onSuccess: invalidate,
  })

  // ── Handlers ───────────────────────────────────────────────
  const openDetail = (ret: any) => {
    setSelectedId(ret.id)
    setInspectItems({})
    setRejectReason('')
  }

  const closeDetail = () => setSelectedId(null)

  const handleApprove = async (sendLabel: boolean) => {
    const ok = await confirmDialog({
      title: t3('Retoure genehmigen', 'Approve Return', 'الموافقة على المرتجع'),
      description: sendLabel
        ? t3(
          'Retoure genehmigen und Rücksendeetikett per E-Mail an den Kunden senden? (Kosten trägt der Shop)',
          'Approve return and send return shipping label to customer by email? (Shop pays shipping)',
          'الموافقة على المرتجع وإرسال ملصق الشحن للعميل عبر البريد الإلكتروني؟ (المتجر يتحمل التكاليف)',
        )
        : t3(
          'Retoure genehmigen? Der Kunde trägt die Rücksendekosten selbst.',
          'Approve return? Customer pays return shipping costs.',
          'الموافقة على المرتجع؟ العميل يتحمل تكاليف الشحن.',
        ),
      confirmLabel: t3('Genehmigen', 'Approve', 'موافقة'),
      cancelLabel: t3('Abbrechen', 'Cancel', 'إلغاء'),
    })
    if (ok) approveMut.mutate(sendLabel)
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    const ok = await confirmDialog({
      title: t3('Retoure ablehnen', 'Reject Return', '\u0631\u0641\u0636 \u0627\u0644\u0645\u0631\u062a\u062c\u0639'),
      description: t3(
        `Retoure mit Begr\u00fcndung ablehnen: "${rejectReason}"`,
        `Reject return with reason: "${rejectReason}"`,
        `\u0631\u0641\u0636 \u0627\u0644\u0645\u0631\u062a\u062c\u0639 \u0628\u0633\u0628\u0628: "${rejectReason}"`,
      ),
      variant: 'danger',
      confirmLabel: t3('Ablehnen', 'Reject', '\u0631\u0641\u0636'),
      cancelLabel: t3('Abbrechen', 'Cancel', '\u0625\u0644\u063a\u0627\u0621'),
    })
    if (ok) rejectMut.mutate(rejectReason)
  }

  const handleRefund = async () => {
    const rawAmt = Number(detail?.refundAmount ?? 0) > 0
      ? Number(detail.refundAmount)
      : (detail?.returnItems ?? []).reduce((s: number, ri: any) => s + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0)
    const amount = rawAmt > 0 ? formatCurrency(rawAmt, locale) : ''
    const ok = await confirmDialog({
      title: t3('Erstattung ausl\u00f6sen', 'Issue Refund', '\u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f'),
      description: t3(
        `Erstattung von ${amount} ausl\u00f6sen? Stripe Refund + Gutschrift werden automatisch erstellt.`,
        `Issue refund of ${amount}? Stripe refund + credit note will be created automatically.`,
        `\u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0628\u0642\u064a\u0645\u0629 ${amount}\u061f \u0633\u064a\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0633\u062a\u0631\u062f\u0627\u062f Stripe + \u0625\u0634\u0639\u0627\u0631 \u062f\u0627\u0626\u0646 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627.`,
      ),
      confirmLabel: t3('Erstattung best\u00e4tigen', 'Confirm Refund', '\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f'),
      cancelLabel: t3('Abbrechen', 'Cancel', '\u0625\u0644\u063a\u0627\u0621'),
    })
    if (ok) refundMut.mutate()
  }

  const handleInspect = () => {
    const items = Object.entries(inspectItems).map(([itemId, condition]) => ({ itemId, condition }))
    if (items.length === 0) return
    inspectMut.mutate(items)
  }

  const handleDownloadLabel = async (id: string) => {
    const API_URL = API_BASE_URL
    const token = useAuthStore.getState().adminAccessToken
    const res = await fetch(`${API_URL}/api/v1/admin/returns/${id}/label`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `return-label-${id.slice(0, 8)}.pdf`; a.click()
    URL.revokeObjectURL(url)
  }

  const getDaysLeft = (deadline: string | null) => {
    if (!deadline) return null
    return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }

  // ── KPI helpers ────────────────────────────────────────────
  const openCount = stats?.statusBreakdown?.filter((s: any) =>
    ['requested', 'label_sent', 'in_transit', 'received', 'inspected'].includes(s.status)
  ).reduce((sum: number, s: any) => sum + s.count, 0) ?? 0

  const topReason = stats?.topReasons?.[0]
  const topReasonLabel = topReason ? reasonLabel(topReason.reason) : '—'

  // ── Timeline ───────────────────────────────────────────────
  const TIMELINE_STEPS: ReturnStatus[] = ['requested', 'in_transit', 'received', 'inspected', 'refunded']

  const getStepIndex = (status: string) => {
    if (status === 'rejected') return -1
    // Map old label_sent status to in_transit
    const mapped = status === 'label_sent' ? 'in_transit' : status
    return TIMELINE_STEPS.indexOf(mapped as ReturnStatus)
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <AdminBreadcrumb items={[{ label: t3('Retouren', 'Returns', '\u0627\u0644\u0645\u0631\u062a\u062c\u0639\u0627\u062a') }]} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <RotateCcw className="h-6 w-6 text-[#d4a853]" />
          {t3('Retourenmanagement', 'Returns Management', '\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u0631\u062a\u062c\u0639\u0627\u062a')}
        </h1>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#1a1a2e] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2 text-sm text-white/60">
            <TrendingDown className="h-4 w-4" />
            {t3('Retourenquote', 'Return Rate', '\u0645\u0639\u062f\u0644 \u0627\u0644\u0625\u0631\u062c\u0627\u0639')}
          </div>
          <p className="text-3xl font-bold">{stats?.returnRate != null ? `${Number(stats.returnRate).toFixed(1)}%` : '—'}</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2 text-sm text-white/60">
            <AlertTriangle className="h-4 w-4" />
            {t3('Offene Retouren', 'Open Returns', '\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0645\u0641\u062a\u0648\u062d\u0629')}
          </div>
          <p className="text-3xl font-bold">{openCount}</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2 text-sm text-white/60">
            <Euro className="h-4 w-4" />
            {t3('Erstattungen diesen Monat', 'Refunds this month', '\u0627\u0633\u062a\u0631\u062f\u0627\u062f\u0627\u062a \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631')}
          </div>
          <p className="text-3xl font-bold">{stats?.totalRefundsThisMonth != null ? formatCurrency(Number(stats.totalRefundsThisMonth), locale) : '—'}</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2 text-sm text-white/60">
            <BarChart3 className="h-4 w-4" />
            {t3('H\u00e4ufigster Grund', 'Top Reason', '\u0627\u0644\u0633\u0628\u0628 \u0627\u0644\u0623\u0643\u062b\u0631 \u0634\u064a\u0648\u0639\u064b\u0627')}
          </div>
          <p className="text-lg font-bold truncate">{topReasonLabel}</p>
          {topReason && <p className="text-sm text-white/40">{topReason.count}x</p>}
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t3('Suche nach RET-Nr, Bestell-Nr, Kunde...', 'Search by RET no, order, customer...', '\u0628\u062d\u062b \u0628\u0631\u0642\u0645 \u0627\u0644\u0645\u0631\u062a\u062c\u0639 \u0623\u0648 \u0627\u0644\u0637\u0644\u0628 \u0623\u0648 \u0627\u0644\u0639\u0645\u064a\u0644...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ltr:pl-10 rtl:pr-10"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]">
          <option value="">{t3('Alle Status', 'All Status', '\u0643\u0644 \u0627\u0644\u062d\u0627\u0644\u0627\u062a')}</option>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[160px]">
          <option value="">{t3('Alle Gr\u00fcnde', 'All Reasons', '\u0643\u0644 \u0627\u0644\u0623\u0633\u0628\u0627\u0628')}</option>
          {REASON_KEYS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </select>
      </div>

      {/* ── Table + Detail Panel ───────────────────────────── */}
      <div className="flex gap-6 items-start">
        {/* Table */}
        <div className="flex-1 bg-background border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-7 gap-x-2 bg-muted/50 border-b">
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('RET-Nr', 'RET No', 'رقم المرتجع')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Bestell-Nr', 'Order No', 'رقم الطلب')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Kunde', 'Customer', 'العميل')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Grund', 'Reason', 'السبب')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Status', 'Status', 'الحالة')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Betrag', 'Amount', 'المبلغ')}</div>
                <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Uhrzeit', 'Time', 'الوقت')}</div>
              </div>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-7 gap-x-2 border-b">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <div key={j} className="px-4 py-4"><div className="h-4 bg-muted rounded animate-pulse" /></div>
                    ))}
                  </div>
                ))
              ) : returns.length === 0 ? (
                <div className="px-4 py-12 text-center text-muted-foreground">{t3('Keine Retouren gefunden', 'No returns found', 'لم يتم العثور على مرتجعات')}</div>
              ) : (
                (() => {
                  // Same day-grouping pattern as /admin/orders and /admin/shipments.
                  // API returns rows sorted by createdAt desc so iteration order
                  // already matches "newest day first".
                  const grouped: Record<string, any[]> = {}
                  for (const r of returns as any[]) {
                    const dateKey = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'unknown'
                    if (!grouped[dateKey]) grouped[dateKey] = []
                    grouped[dateKey].push(r)
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
                          {items.length} {t3('Retouren', 'returns', 'مرتجعات')}
                        </span>
                      </button>
                      {!collapsedDays.has(dateKey) && items.map((ret: any) => (
                        <div
                          key={ret.id}
                          className={`grid grid-cols-7 gap-x-2 border-b cursor-pointer transition-colors items-center ${selectedId === ret.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                          onClick={() => openDetail(ret)}
                        >
                          <div className="px-4 py-4">
                            <span className="font-mono text-sm font-medium text-[#d4a853]">{ret.returnNumber}</span>
                          </div>
                          <div className="px-4 py-4">
                            <span className="font-mono text-sm text-primary">{ret.order?.orderNumber ?? '—'}</span>
                          </div>
                          <div className="px-4 py-4">
                            <p className="text-sm font-medium">{ret.order?.user?.firstName} {ret.order?.user?.lastName}</p>
                            <p className="text-sm text-muted-foreground">{ret.order?.user?.email}</p>
                          </div>
                          <div className="px-4 py-4">
                            <span className="px-2.5 py-1 rounded-full text-sm font-medium bg-muted">{reasonLabel(ret.reason)}</span>
                          </div>
                          <div className="px-4 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[ret.status as ReturnStatus] ?? 'bg-gray-100'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[ret.status as ReturnStatus] ?? 'bg-gray-400'}`} />
                              {statusLabel(ret.status)}
                            </span>
                          </div>
                          <div className="px-4 py-4 text-center text-sm font-medium">{(() => {
                            const amt = Number(ret.refundAmount ?? 0) > 0
                              ? Number(ret.refundAmount)
                              : (ret.returnItems ?? []).reduce((s: number, ri: any) => s + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0)
                            return amt > 0 ? formatCurrency(amt, locale) : '—'
                          })()}</div>
                          <div className="px-4 py-4 text-sm text-muted-foreground tabular-nums">{formatTime(ret.createdAt, locale)}</div>
                        </div>
                      ))}
                    </React.Fragment>
                  ))
                })()
              )}
            </div>
          </div>
          {result?.meta?.total != null && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground">
              {result.meta.total} {t3('Retouren insgesamt', 'returns total', '\u0645\u0631\u062a\u062c\u0639 \u0625\u062c\u0645\u0627\u0644\u064a')}
            </div>
          )}
        </div>

        {/* ── Detail Side Panel (slide-over) ─────────────── */}
        {selectedId && (
          <div className="w-[480px] flex-shrink-0 bg-background border rounded-xl shadow-lg overflow-y-auto max-h-[calc(100vh-160px)]" style={{ animation: 'slideIn 200ms ease-out' }}>
            {detailLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 border-2 border-[#d4a853] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detail ? (
              <div className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-lg font-mono text-[#d4a853]">{detail.returnNumber}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${STATUS_BADGE[detail.status as ReturnStatus] ?? 'bg-gray-100'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[detail.status as ReturnStatus] ?? 'bg-gray-400'}`} />
                      {statusLabel(detail.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {detail.status !== 'rejected' && detail.status !== 'requested' && (
                      <button onClick={() => handleDownloadLabel(detail.id)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t3('Label herunterladen', 'Download Label', '\u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0644\u0635\u0642')}>
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-muted transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Deadline countdown */}
                {detail.deadline && (() => {
                  const days = getDaysLeft(detail.deadline)
                  return (
                    <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${days !== null && days <= 3 ? 'bg-red-50 text-red-700' : 'bg-muted/30'}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <span>{t3('Frist', 'Deadline', '\u0627\u0644\u0645\u0648\u0639\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a')}:</span>
                      <span className="font-medium">
                        {days !== null && days <= 0
                          ? t3('Abgelaufen', 'Expired', '\u0645\u0646\u062a\u0647\u064a')
                          : days !== null
                            ? t3(`${days} Tage verbleibend`, `${days} days left`, `${days} \u0623\u064a\u0627\u0645 \u0645\u062a\u0628\u0642\u064a\u0629`)
                            : '—'
                        }
                      </span>
                    </div>
                  )
                })()}

                {/* Customer info */}
                <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
                  <h4 className="font-semibold text-xs uppercase text-muted-foreground tracking-wide">{t3('Kundeninformationen', 'Customer Info', '\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644')}</h4>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t3('Name', 'Name', '\u0627\u0644\u0627\u0633\u0645')}</span><span className="font-medium">{detail.order?.user?.firstName} {detail.order?.user?.lastName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t3('E-Mail', 'Email', '\u0627\u0644\u0628\u0631\u064a\u062f')}</span><span className="text-xs">{detail.order?.user?.email}</span></div>
                </div>

                {/* Order info */}
                <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
                  <h4 className="font-semibold text-xs uppercase text-muted-foreground tracking-wide">{t3('Bestellinformationen', 'Order Info', '\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0637\u0644\u0628')}</h4>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t3('Bestell-Nr', 'Order No', '\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628')}</span><span className="font-mono font-medium">{detail.order?.orderNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t3('Bestellwert', 'Order Total', '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0637\u0644\u0628')}</span><span className="font-medium">{formatCurrency(Number(detail.order?.totalAmount ?? 0), locale)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t3('Grund', 'Reason', '\u0627\u0644\u0633\u0628\u0628')}</span><span>{reasonLabel(detail.reason)}</span></div>
                  {detail.order?.payment && (
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">{t3('Zahlungsmethode', 'Payment Method', 'طريقة الدفع')}</span><span>{(() => {
                      const m = (detail.order.payment.method ?? '').toLowerCase()
                      const p = (detail.order.payment.provider ?? '').toLowerCase()
                      if (m === 'card' || p === 'stripe') return <StripeLogo className="h-5" />
                      if (m === 'paypal' || p === 'paypal') return <PayPalLogo className="h-5" />
                      if (m === 'klarna' || p === 'klarna') return <KlarnaLogo className="h-5" />
                      if (m === 'sumup' || p === 'sumup') return <SumUpLogo className="h-5" />
                      if (m === 'vorkasse') return <span className="text-sm font-medium">{locale === 'ar' ? 'تحويل بنكي' : 'Vorkasse'}</span>
                      return <span className="text-sm font-medium">{p ?? m ?? '—'}</span>
                    })()}</span></div>
                  )}
                </div>

                {/* Items */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    {t3('Artikel', 'Items', '\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a')}
                  </h4>
                  <div className="space-y-2">
                    {(detail.returnItems ?? detail.order?.items ?? []).map((item: any, idx: number) => {
                      // Find matching order item for inspect (returnItems JSON has no DB id)
                      const orderItem = detail.order?.items?.find((oi: any) => (oi.variantId || oi.variant?.id) === item.variantId) ?? item
                      const inspectKey = orderItem.id ?? item.variantId ?? `item-${idx}`
                      return (
                      <div key={inspectKey} className="flex items-center justify-between text-sm bg-muted/20 rounded-lg px-3 py-2">
                        {(item.imageUrl || item.variant?.product?.images?.[0]?.url) && (
                          <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted flex-shrink-0 ltr:mr-3 rtl:ml-3">
                            <img src={item.imageUrl || item.variant?.product?.images?.[0]?.url} alt="" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{item.snapshotName ?? item.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{item.snapshotSku ?? item.sku ?? ''}</p>
                        </div>
                        <div className="text-end text-xs">
                          <p>{item.quantity}x</p>
                          {item.totalPrice && <p className="font-medium">{formatCurrency(Number(item.totalPrice), locale)}</p>}
                        </div>
                        {/* Per-item inspection when status = received */}
                        {detail.status === 'received' && (
                          <div className="flex gap-1 ltr:ml-3 rtl:mr-3">
                            <button
                              onClick={() => setInspectItems((p) => ({ ...p, [inspectKey]: 'ok' }))}
                              className={`p-1.5 rounded-lg text-xs transition-colors ${inspectItems[inspectKey] === 'ok' ? 'bg-green-100 text-green-700' : 'bg-muted/40 text-muted-foreground hover:bg-green-50'}`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setInspectItems((p) => ({ ...p, [inspectKey]: 'damaged' }))}
                              className={`p-1.5 rounded-lg text-xs transition-colors ${inspectItems[inspectKey] === 'damaged' ? 'bg-red-100 text-red-700' : 'bg-muted/40 text-muted-foreground hover:bg-red-50'}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      )
                    })}
                  </div>
                </div>

                {/* Status Timeline */}
                <div>
                  <h4 className="text-sm font-semibold mb-3">{t3('Verlauf', 'Timeline', '\u0627\u0644\u062c\u062f\u0648\u0644 \u0627\u0644\u0632\u0645\u0646\u064a')}</h4>
                  <div className="flex items-center gap-1">
                    {(detail.status === 'rejected' ? [...TIMELINE_STEPS.slice(0, 1), 'rejected' as ReturnStatus] : TIMELINE_STEPS).map((step, i, arr) => {
                      const currentIdx = detail.status === 'rejected' ? 1 : getStepIndex(detail.status)
                      const isActive = i <= currentIdx
                      const isCurrent = i === currentIdx
                      return (
                        <div key={step} className="flex items-center gap-1 flex-1">
                          <div className={`flex flex-col items-center flex-1`}>
                            <div className={`h-4 w-4 rounded-full transition-colors ${isCurrent ? `${STATUS_DOT[step]} ring-2 ring-offset-2 ring-current shadow-sm` : isActive ? STATUS_DOT[step] : 'bg-muted'}`} />
                            <span className={`text-xs mt-1.5 text-center leading-tight ${isCurrent ? 'text-foreground font-bold' : isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                              {statusLabel(step)}
                            </span>
                          </div>
                          {i < arr.length - 1 && (
                            <div className={`h-0.5 flex-1 rounded-full -mt-4 ${i < currentIdx ? 'bg-[#d4a853]' : 'bg-muted'}`} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* ── Action Buttons by Status ───────────── */}
                <div className="border-t pt-4 space-y-3">
                  {/* requested → approve / reject */}
                  {detail.status === 'requested' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white text-xs py-5" onClick={() => handleApprove(false)} disabled={approveMut.isPending}>
                          <Check className="h-4 w-4" />
                          <span className="leading-tight">{t3('Genehmigen\n(Kunde zahlt Versand)', 'Approve\n(Customer pays)', 'موافقة\n(العميل يدفع الشحن)')}</span>
                        </Button>
                        <Button className="w-full gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white text-xs py-5" onClick={() => handleApprove(true)} disabled={approveMut.isPending}>
                          <Truck className="h-4 w-4" />
                          <span className="leading-tight">{t3('Genehmigen +\nLabel senden', 'Approve +\nSend Label', 'موافقة +\nإرسال ملصق الشحن')}</span>
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Input
                          placeholder={t3('Ablehnungsgrund (Pflicht)', 'Rejection reason (required)', '\u0633\u0628\u0628 \u0627\u0644\u0631\u0641\u0636 (\u0645\u0637\u0644\u0648\u0628)')}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <Button variant="outline" className="w-full gap-2 border-red-200 text-red-600 hover:bg-red-50" onClick={handleReject} disabled={!rejectReason.trim() || rejectMut.isPending}>
                          <X className="h-4 w-4" />{t3('Ablehnen', 'Reject', '\u0631\u0641\u0636')}
                        </Button>
                      </div>
                    </>
                  )}

                  {/* label_sent / in_transit → package on the way, wait for scan */}
                  {(detail.status === 'label_sent' || detail.status === 'in_transit') && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-800 text-sm">
                        <Truck className="h-5 w-5 flex-shrink-0" />
                        <p>{t3(
                          'Paket ist unterwegs. Bei Ankunft im Lager den Retouren-Barcode scannen.',
                          'Package is in transit. Scan the return barcode when it arrives at the warehouse.',
                          'الطرد في الطريق. قم بمسح باركود الإرجاع عند وصوله إلى المستودع.'
                        )}</p>
                      </div>

                      {/* Shipping cost info + send label option */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 rounded-xl text-sm">
                        <span className="text-muted-foreground">
                          {detail.adminNotes === 'shop_pays_shipping'
                            ? t3('Versandkosten: Shop trägt Kosten', 'Shipping: Shop pays', 'الشحن: المتجر يتحمل التكاليف')
                            : detail.adminNotes === 'customer_pays_shipping'
                              ? t3('Versandkosten: Kunde trägt Kosten', 'Shipping: Customer pays', 'الشحن: العميل يتحمل التكاليف')
                              : t3('Versandkosten: Nicht festgelegt', 'Shipping: Not set', 'الشحن: غير محدد')}
                        </span>
                        {detail.adminNotes !== 'shop_pays_shipping' && (
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 bg-[#d4a853]/10 border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/20"
                            onClick={async () => {
                              const ok = await confirmDialog({
                                title: t3('DHL-Label nachsenden', 'Send DHL Label', 'إرسال ملصق DHL'),
                                description: t3(
                                  'DHL-Rücksendeetikett erstellen und per E-Mail an den Kunden senden? (Shop trägt Versandkosten)',
                                  'Create DHL return label and send to customer by email? (Shop pays shipping)',
                                  'إنشاء ملصق إرجاع DHL وإرساله للعميل عبر البريد الإلكتروني؟ (المتجر يتحمل التكاليف)',
                                ),
                                confirmLabel: t3('Label senden', 'Send Label', 'إرسال الملصق'),
                                cancelLabel: t3('Abbrechen', 'Cancel', 'إلغاء'),
                              })
                              if (ok) {
                                try {
                                  await api.post(`/admin/returns/${detail.id}/send-label`)
                                  invalidate()
                                } catch { /* handled by toast */ }
                              }
                            }}>
                            <Truck className="h-3.5 w-3.5" />
                            {t3('Label senden', 'Send Label', 'إرسال ملصق')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* received → inspect */}
                  {detail.status === 'received' && (
                    <Button className="w-full gap-2" onClick={handleInspect} disabled={Object.keys(inspectItems).length === 0 || inspectMut.isPending}>
                      <Eye className="h-4 w-4" />{t3('Pr\u00fcfung abschlie\u00dfen', 'Complete Inspection', '\u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0641\u062d\u0635')}
                    </Button>
                  )}

                  {/* inspected → 1-CLICK REFUND (gold, prominent) */}
                  {detail.status === 'inspected' && (() => {
                    const amt = Number(detail.refundAmount ?? 0) > 0
                      ? Number(detail.refundAmount)
                      : (detail.returnItems ?? []).reduce((s: number, ri: any) => s + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0)
                    return (
                    <Button
                      className="w-full gap-2 text-lg py-6 font-bold bg-[#d4a853] hover:bg-[#c49943] text-white shadow-lg"
                      onClick={handleRefund}
                      disabled={refundMut.isPending}
                    >
                      <Euro className="h-5 w-5" />
                      {t3('Erstattung ausl\u00f6sen', 'Issue Refund', '\u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f')}
                      {amt > 0 && <span className="text-sm font-normal opacity-80">({formatCurrency(amt, locale)})</span>}
                    </Button>
                    )
                  })()}

                  {/* refunded → show info */}
                  {detail.status === 'refunded' && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm">
                      <Check className="h-5 w-5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">{t3('Erstattet am', 'Refunded on', '\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0641\u064a')} {formatDate(detail.refundedAt, locale)}</p>
                        <p className="text-green-700 font-bold">{formatCurrency(Number(detail.refundAmount ?? 0), locale)}</p>
                      </div>
                    </div>
                  )}

                  {/* rejected → show reason */}
                  {detail.status === 'rejected' && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm">
                      <X className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">{t3('Abgelehnt', 'Rejected', '\u0645\u0631\u0641\u0648\u0636')}</p>
                        <p className="text-red-600">{detail.rejectionReason ?? detail.adminNotes ?? '—'}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Admin notes — übersetze Enum-Werte in lesbaren Text */}
                {detail.notes && (
                  <div className="text-xs text-muted-foreground border-t pt-3">
                    <p className="font-medium mb-1">{t3('Kundennotiz', 'Customer Note', '\u0645\u0644\u0627\u062d\u0638\u0629 \u0627\u0644\u0639\u0645\u064a\u0644')}</p>
                    <p>{detail.notes.split(' | ').map((part: string) => {
                      const enumMatch = REASON_LABELS[part.trim() as ReturnReason]
                      return enumMatch ? enumMatch[locale as 'de' | 'en' | 'ar'] : part
                    }).join(' | ')}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: translateX(0) } }
      `}</style>
    </div>
  )
}
