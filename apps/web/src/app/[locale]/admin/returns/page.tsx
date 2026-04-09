'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  RotateCcw, Search, Package, X, Check,
  Download, Eye, TrendingDown, BarChart3, Euro, AlertTriangle,
} from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/locale-utils'

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
    mutationFn: () => api.post(`/admin/returns/${selectedId}/approve`),
    onSuccess: invalidate,
  })

  const rejectMut = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/returns/${selectedId}/reject`, { reason }),
    onSuccess: () => { invalidate(); setRejectReason('') },
  })

  const receivedMut = useMutation({
    mutationFn: () => api.post(`/admin/returns/${selectedId}/received`),
    onSuccess: invalidate,
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

  const handleApprove = async () => {
    const ok = await confirmDialog({
      title: t3('Retoure genehmigen', 'Approve Return', '\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u0631\u062a\u062c\u0639'),
      description: t3(
        'Retoure genehmigen und R\u00fccksendeetikett erstellen?',
        'Approve return and create return label?',
        '\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u0631\u062a\u062c\u0639 \u0648\u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0635\u0642 \u0627\u0644\u0625\u0631\u062c\u0627\u0639\u061f',
      ),
      confirmLabel: t3('Genehmigen', 'Approve', '\u0645\u0648\u0627\u0641\u0642\u0629'),
      cancelLabel: t3('Abbrechen', 'Cancel', '\u0625\u0644\u063a\u0627\u0621'),
    })
    if (ok) approveMut.mutate()
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
    const amount = detail?.refundAmount ? formatCurrency(Number(detail.refundAmount), locale) : ''
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
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
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
  const TIMELINE_STEPS: ReturnStatus[] = ['requested', 'label_sent', 'in_transit', 'received', 'inspected', 'refunded']

  const getStepIndex = (status: string) => {
    if (status === 'rejected') return -1
    return TIMELINE_STEPS.indexOf(status as ReturnStatus)
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-start px-4 py-3 font-medium">{t3('RET-Nr', 'RET No', 'رقم المرتجع')}</th>
                  <th className="text-start px-4 py-3 font-medium">{t3('Bestell-Nr', 'Order No', 'رقم الطلب')}</th>
                  <th className="text-start px-4 py-3 font-medium">{t3('Kunde', 'Customer', 'العميل')}</th>
                  <th className="text-start px-4 py-3 font-medium">{t3('Grund', 'Reason', 'السبب')}</th>
                  <th className="text-start px-4 py-3 font-medium">{t3('Status', 'Status', 'الحالة')}</th>
                  <th className="text-end px-4 py-3 font-medium">{t3('Betrag', 'Amount', 'المبلغ')}</th>
                  <th className="text-start px-4 py-3 font-medium">{t3('Datum', 'Date', 'التاريخ')}</th>
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
                ) : returns.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t3('Keine Retouren gefunden', 'No returns found', 'لم يتم العثور على مرتجعات')}</td></tr>
                ) : (
                  returns.map((ret: any) => (
                    <tr
                      key={ret.id}
                      className={`border-b cursor-pointer transition-colors ${selectedId === ret.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                      onClick={() => openDetail(ret)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono font-medium text-[#d4a853]">{ret.returnNumber}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs text-primary">{ret.order?.orderNumber ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{ret.order?.user?.firstName} {ret.order?.user?.lastName}</p>
                        <p className="text-xs text-muted-foreground">{ret.order?.user?.email}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted">{reasonLabel(ret.reason)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[ret.status as ReturnStatus] ?? 'bg-gray-100'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[ret.status as ReturnStatus] ?? 'bg-gray-400'}`} />
                          {statusLabel(ret.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end font-medium">{ret.refundAmount ? formatCurrency(Number(ret.refundAmount), locale) : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(ret.createdAt, locale)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                </div>

                {/* Items */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    {t3('Artikel', 'Items', '\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a')}
                  </h4>
                  <div className="space-y-2">
                    {(detail.returnItems ?? detail.order?.items ?? []).map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between text-sm bg-muted/20 rounded-lg px-3 py-2">
                        <div className="flex-1">
                          <p className="font-medium">{item.snapshotName ?? item.name ?? '—'}</p>
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
                              onClick={() => setInspectItems((p) => ({ ...p, [item.id]: 'ok' }))}
                              className={`p-1.5 rounded-lg text-xs transition-colors ${inspectItems[item.id] === 'ok' ? 'bg-green-100 text-green-700' : 'bg-muted/40 text-muted-foreground hover:bg-green-50'}`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setInspectItems((p) => ({ ...p, [item.id]: 'damaged' }))}
                              className={`p-1.5 rounded-lg text-xs transition-colors ${inspectItems[item.id] === 'damaged' ? 'bg-red-100 text-red-700' : 'bg-muted/40 text-muted-foreground hover:bg-red-50'}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
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
                            <div className={`h-2.5 w-2.5 rounded-full transition-colors ${isCurrent ? `${STATUS_DOT[step]} ring-2 ring-offset-1 ring-current` : isActive ? STATUS_DOT[step] : 'bg-muted'}`} />
                            <span className={`text-[9px] mt-1 text-center leading-tight ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                              {statusLabel(step)}
                            </span>
                          </div>
                          {i < arr.length - 1 && (
                            <div className={`h-0.5 flex-1 rounded-full -mt-3 ${i < currentIdx ? 'bg-[#d4a853]' : 'bg-muted'}`} />
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
                      <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={handleApprove} disabled={approveMut.isPending}>
                        <Check className="h-4 w-4" />{t3('Genehmigen', 'Approve', '\u0645\u0648\u0627\u0641\u0642\u0629')}
                      </Button>
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

                  {/* label_sent → mark received */}
                  {detail.status === 'label_sent' && (
                    <Button className="w-full gap-2" onClick={() => receivedMut.mutate()} disabled={receivedMut.isPending}>
                      <Package className="h-4 w-4" />{t3('Als eingetroffen markieren', 'Mark as received', '\u062a\u062d\u062f\u064a\u062f \u0643\u0645\u0633\u062a\u0644\u0645')}
                    </Button>
                  )}

                  {/* in_transit → mark received */}
                  {detail.status === 'in_transit' && (
                    <Button className="w-full gap-2" onClick={() => receivedMut.mutate()} disabled={receivedMut.isPending}>
                      <Package className="h-4 w-4" />{t3('Als eingetroffen markieren', 'Mark as received', '\u062a\u062d\u062f\u064a\u062f \u0643\u0645\u0633\u062a\u0644\u0645')}
                    </Button>
                  )}

                  {/* received → inspect */}
                  {detail.status === 'received' && (
                    <Button className="w-full gap-2" onClick={handleInspect} disabled={Object.keys(inspectItems).length === 0 || inspectMut.isPending}>
                      <Eye className="h-4 w-4" />{t3('Pr\u00fcfung abschlie\u00dfen', 'Complete Inspection', '\u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0641\u062d\u0635')}
                    </Button>
                  )}

                  {/* inspected → 1-CLICK REFUND (gold, prominent) */}
                  {detail.status === 'inspected' && (
                    <Button
                      className="w-full gap-2 text-lg py-6 font-bold bg-[#d4a853] hover:bg-[#c49943] text-white shadow-lg"
                      onClick={handleRefund}
                      disabled={refundMut.isPending}
                    >
                      <Euro className="h-5 w-5" />
                      {t3('Erstattung ausl\u00f6sen', 'Issue Refund', '\u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f')}
                      {detail.refundAmount && <span className="text-sm font-normal opacity-80">({formatCurrency(Number(detail.refundAmount), locale)})</span>}
                    </Button>
                  )}

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
