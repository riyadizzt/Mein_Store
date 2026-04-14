'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Users, UserPlus, ShieldAlert, ShieldCheck,
  ArrowUpDown, ChevronDown, Eye, Download, Plus, X, Mail, Tag,
  Lock, Unlock, RotateCcw, TrendingUp, Percent, ShoppingCart,
  ChevronLeft, ChevronRight, Check,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDate as fmtDateUtil } from '@/lib/locale-utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const TAG_COLORS: Record<string, string> = {
  VIP: 'bg-amber-100 text-amber-800 border-amber-200',
  Stammkunde: 'bg-blue-100 text-blue-800 border-blue-200',
  Problem: 'bg-red-100 text-red-800 border-red-200',
  Newsletter: 'bg-green-100 text-green-800 border-green-200',
  Großhandel: 'bg-purple-100 text-purple-800 border-purple-200',
}

// Language badge colors — intuitive per-market feel.
//   DE → slate (German precision / neutral dark)
//   EN → blue  (British / US convention)
//   AR → emerald (green is the cultural/brand color across the Arab world)
const LANG_COLORS: Record<string, string> = {
  de: 'bg-slate-100 text-slate-700 border-slate-200',
  en: 'bg-blue-100 text-blue-700 border-blue-200',
  ar: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const AVAILABLE_TAGS = ['VIP', 'Stammkunde', 'Problem', 'Newsletter', 'Großhandel']

export default function AdminCustomersPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  // Filters
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [langFilter, setLangFilter] = useState('')
  const [ordersRange, setOrdersRange] = useState('')
  const [revenueRange, setRevenueRange] = useState('')
  const [dateRange, setDateRange] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(0)

  // Bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkTagModal, setShowBulkTagModal] = useState(false)
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false)
  const [bulkEmailSubject, setBulkEmailSubject] = useState('')
  const [bulkEmailBody, setBulkEmailBody] = useState('')
  const [bulkTags, setBulkTags] = useState<string[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '', lang: 'de', notes: '', tags: [] as string[] })

  // Parse filter ranges
  const orderParams = useMemo(() => {
    const map: Record<string, { min?: number; max?: number }> = {
      '0': { min: 0, max: 0 }, '1-5': { min: 1, max: 5 }, '6-20': { min: 6, max: 20 }, '20+': { min: 20 },
    }
    return map[ordersRange] ?? {}
  }, [ordersRange])

  const revenueParams = useMemo(() => {
    const map: Record<string, { min?: number; max?: number }> = {
      '0-50': { min: 0, max: 50 }, '50-200': { min: 50, max: 200 }, '200-500': { min: 200, max: 500 }, '500+': { min: 500 },
    }
    return map[revenueRange] ?? {}
  }, [revenueRange])

  const dateParams = useMemo(() => {
    const now = new Date()
    const map: Record<string, string> = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
      '7d': new Date(now.getTime() - 7 * 86400000).toISOString(),
      '30d': new Date(now.getTime() - 30 * 86400000).toISOString(),
      year: new Date(now.getTime() - 365 * 86400000).toISOString(),
    }
    return map[dateRange] ? { dateFrom: map[dateRange] } : {}
  }, [dateRange])

  const hasActiveFilters = filter || langFilter || ordersRange || revenueRange || dateRange || tagFilter

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['admin-customer-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/customers/stats'); return data },
  })

  // List
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-customers', search, filter, langFilter, ordersRange, revenueRange, dateRange, tagFilter, sortBy, sortDir, pageSize, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/customers', {
        params: {
          search: search || undefined, filter: filter || undefined,
          lang: langFilter || undefined, tag: tagFilter || undefined,
          ordersMin: orderParams.min, ordersMax: orderParams.max,
          revenueMin: revenueParams.min, revenueMax: revenueParams.max,
          ...dateParams, sortBy, sortDir, limit: pageSize, offset: page * pageSize,
        },
      })
      return data
    },
  })

  const customers = result?.data ?? []
  const totalCount = result?.meta?.total ?? 0
  const totalPages = Math.ceil(totalCount / pageSize)

  // Mutations
  const createMut = useMutation({
    mutationFn: async () => { await api.post('/admin/customers', newCustomer) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-customers'] })
      qc.invalidateQueries({ queryKey: ['admin-customer-stats'] })
      setShowAddModal(false)
      setNewCustomer({ firstName: '', lastName: '', email: '', phone: '', lang: 'de', notes: '', tags: [] })
    },
  })

  const bulkEmailMut = useMutation({
    mutationFn: async () => { await api.post('/admin/customers/bulk-email', { userIds: [...selectedIds], subject: bulkEmailSubject, body: bulkEmailBody }) },
    onSuccess: () => { setShowBulkEmailModal(false); setBulkEmailSubject(''); setBulkEmailBody(''); setSelectedIds(new Set()) },
  })

  const bulkTagMut = useMutation({
    mutationFn: async () => { await api.post('/admin/customers/bulk-tag', { userIds: [...selectedIds], tags: bulkTags }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customers'] }); setShowBulkTagModal(false); setBulkTags([]); setSelectedIds(new Set()) },
  })

  const bulkBlockMut = useMutation({
    mutationFn: async () => { await api.post('/admin/customers/bulk-block', { userIds: [...selectedIds], reason: 'Bulk block by admin' }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customers'] }); setSelectedIds(new Set()) },
  })

  const bulkUnblockMut = useMutation({
    mutationFn: async () => { await api.post('/admin/customers/bulk-unblock', { userIds: [...selectedIds] }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customers'] }); setSelectedIds(new Set()) },
  })

  const unblockOneMut = useMutation({
    mutationFn: async (id: string) => { await api.post(`/admin/customers/${id}/unblock`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-customers'] }),
  })

  // Helpers
  const toggleSort = (key: string) => { if (sortBy === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); else { setSortBy(key); setSortDir('desc') } }
  const toggleSelect = (id: string) => { const next = new Set(selectedIds); next.has(id) ? next.delete(id) : next.add(id); setSelectedIds(next) }
  const toggleSelectAll = () => { if (selectedIds.size === customers.length) setSelectedIds(new Set()); else setSelectedIds(new Set(customers.map((c: any) => c.id))) }
  const resetFilters = () => { setFilter(''); setLangFilter(''); setOrdersRange(''); setRevenueRange(''); setDateRange(''); setTagFilter(''); setPage(0) }

  const fmtCur = (n: number) => formatCurrency(n, locale)
  const fmtDate = (d: string) => fmtDateUtil(d, locale)

  const handleExport = async () => {
    const params = new URLSearchParams()
    if (filter) params.set('filter', filter)
    if (tagFilter) params.set('tag', tagFilter)
    if (search) params.set('search', search)
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/customers/export?${params}`, {
      headers: { Authorization: `Bearer ${(await import('@/store/auth-store')).useAuthStore.getState().accessToken}` },
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'kunden.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const statCards = [
    { key: 'total', label: t('users.totalCustomers'), value: stats?.total ?? 0, icon: Users, color: 'bg-blue-50 text-blue-600', trend: stats?.monthlyTrend },
    { key: 'new', label: t('users.newThisMonth'), value: stats?.newThisMonth ?? 0, icon: UserPlus, color: 'bg-purple-50 text-purple-600', sub: `${stats?.newThisWeek ?? 0} ${t('users.newThisWeek')}` },
    { key: 'avgOrder', label: t('users.avgOrder'), value: fmtCur(stats?.avgOrderValue ?? 0), icon: ShoppingCart, color: 'bg-green-50 text-green-600' },
    { key: 'returning', label: t('users.returningCustomers'), value: `${stats?.returningPercent ?? 0}%`, icon: Percent, color: 'bg-amber-50 text-amber-600' },
  ]

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('users.title') }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('users.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" />{t('users.exportAll')}
          </Button>
          <Button size="sm" className="rounded-xl gap-2" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />{t('users.addCustomer')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((card, i) => (
          <div key={card.key} className="group bg-background border rounded-2xl p-5 hover:shadow-lg hover:border-primary/20 transition-all duration-300" style={{ animationDelay: `${i * 60}ms`, animation: 'fadeSlideUp 400ms ease-out both' }}>
            <div className="flex items-center gap-3">
              <div className={`h-11 w-11 rounded-xl ${card.color} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
                <card.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold tracking-tight">{card.value}</div>
                <div className="text-[11px] text-muted-foreground truncate">{card.label}</div>
              </div>
            </div>
            {card.trend != null && (
              <div className={`mt-2 text-[11px] font-medium flex items-center gap-1 ${card.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <TrendingUp className={`h-3 w-3 ${card.trend < 0 ? 'rotate-180' : ''}`} />
                {card.trend >= 0 ? '+' : ''}{card.trend}% {t('users.monthlyTrend')}
              </div>
            )}
            {card.sub && <div className="mt-1 text-[11px] text-muted-foreground">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-lg mb-4">
        <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder={t('users.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} className="pl-10 rtl:pl-3 rtl:pr-10 h-11 rounded-xl" />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterSelect label={t('users.filterType')} value={filter} onChange={(v) => { setFilter(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: 'registered', label: t('users.filterRegistered') },
          { value: 'guest', label: t('users.filterGuest') }, { value: 'vip', label: t('users.filterVip') },
        ]} />
        <FilterSelect label={t('users.filterStatus')} value={filter === 'active' || filter === 'blocked' ? filter : ''} onChange={(v) => { setFilter(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: 'active', label: t('users.filterActive') }, { value: 'blocked', label: t('users.filterBlocked') },
        ]} />
        <FilterSelect label={t('users.filterGdpr')} value={filter === 'deletion_scheduled' || filter === 'anonymized' ? filter : ''} onChange={(v) => { setFilter(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') },
          { value: 'deletion_scheduled', label: t('users.filterDeletionScheduled') },
          { value: 'anonymized', label: t('users.filterAnonymized') },
        ]} />
        <FilterSelect label={t('users.filterLang')} value={langFilter} onChange={(v) => { setLangFilter(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: 'de', label: 'DE' }, { value: 'en', label: 'EN' }, { value: 'ar', label: 'AR' },
        ]} />
        <FilterSelect label={t('users.filterOrders')} value={ordersRange} onChange={(v) => { setOrdersRange(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: '0', label: t('users.orders0') },
          { value: '1-5', label: t('users.orders1to5') }, { value: '6-20', label: t('users.orders6to20') }, { value: '20+', label: t('users.orders20plus') },
        ]} />
        <FilterSelect label={t('users.filterRevenue')} value={revenueRange} onChange={(v) => { setRevenueRange(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: '0-50', label: t('users.revenue0to50') },
          { value: '50-200', label: t('users.revenue50to200') }, { value: '200-500', label: t('users.revenue200to500') }, { value: '500+', label: t('users.revenue500plus') },
        ]} />
        <FilterSelect label={t('users.filterDate')} value={dateRange} onChange={(v) => { setDateRange(v); setPage(0) }} options={[
          { value: '', label: t('users.filterAll') }, { value: 'today', label: t('users.dateToday') },
          { value: '7d', label: t('users.date7d') }, { value: '30d', label: t('users.date30d') }, { value: 'year', label: t('users.dateYear') },
        ]} />
        {(stats?.allTags?.length ?? 0) > 0 && (
          <FilterSelect label={t('users.filterTags')} value={tagFilter} onChange={(v) => { setTagFilter(v); setPage(0) }} options={[
            { value: '', label: t('users.filterAll') },
            ...(stats?.allTags ?? []).map((tag: string) => ({ value: tag, label: tag })),
          ]} />
        )}
        {hasActiveFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">
            <RotateCcw className="h-3 w-3" />{t('users.filterReset')}
          </button>
        )}
      </div>

      {/* Sort + Bulk Bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpDown className="h-3.5 w-3.5" /></span>
          {['date', 'revenue', 'orders', 'name'].map((s) => (
            <button key={s} onClick={() => toggleSort(s)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sortBy === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {t(`users.sort${s.charAt(0).toUpperCase() + s.slice(1)}`)}
              {sortBy === s && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />}
            </button>
          ))}
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
            <span className="text-xs font-medium text-primary">{selectedIds.size} {t('users.selected')}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg gap-1" onClick={() => setShowBulkEmailModal(true)}><Mail className="h-3 w-3" />{t('users.bulkEmail')}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg gap-1" onClick={() => setShowBulkTagModal(true)}><Tag className="h-3 w-3" />{t('users.bulkTag')}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg gap-1 text-red-600 border-red-200" onClick={() => bulkBlockMut.mutate()}><Lock className="h-3 w-3" />{t('users.bulkBlock')}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg gap-1 text-green-600 border-green-200" onClick={() => bulkUnblockMut.mutate()}><Unlock className="h-3 w-3" />{t('users.bulkUnblock')}</Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleSelectAll} className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.size === customers.length && customers.length > 0 ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>
                    {selectedIds.size === customers.length && customers.length > 0 && <Check className="h-3 w-3 text-white" />}
                  </button>
                </th>
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.customer')}</th>
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.email')}</th>
                <th className="text-center px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.orders')}</th>
                <th className="text-end px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.revenue')}</th>
                <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.registered')}</th>
                <th className="text-center px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('users.status')}</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b" style={{ animationDelay: `${i * 30}ms`, animation: 'fadeIn 300ms ease-out both' }}>
                  {Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-4"><div className={`h-4 bg-muted rounded-lg animate-pulse ${j === 1 ? 'w-32' : 'w-20'}`} /></td>)}
                </tr>
              )) : customers.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center"><Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-muted-foreground">{t('users.noCustomers')}</p></td></tr>
              ) : customers.map((u: any, i: number) => (
                <tr key={u.id} className="border-b hover:bg-muted/20 transition-colors group" style={{ animationDelay: `${i * 20}ms`, animation: 'fadeSlideUp 300ms ease-out both' }}>
                  <td className="px-4 py-3.5">
                    <button onClick={() => toggleSelect(u.id)} className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.has(u.id) ? 'bg-primary border-primary' : 'border-muted-foreground/30 group-hover:border-muted-foreground/50'}`}>
                      {selectedIds.has(u.id) && <Check className="h-3 w-3 text-white" />}
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/${locale}/admin/customers/${u.id}`} className="group/link">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#1a1a2e] to-[#2d2d5e] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{u.firstName?.[0]}{u.lastName?.[0]}</div>
                        <div>
                          <div className="font-semibold group-hover/link:text-primary transition-colors">{u.firstName} {u.lastName}</div>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {u.isGuest ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">{t('users.guest')}</span>
                              : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200">{t('users.filterRegistered')}</span>}
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${LANG_COLORS[u.preferredLang] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>{u.preferredLang}</span>
                            {u.anonymizedAt && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-900 text-gray-100 border border-gray-700" title="DSGVO Art. 17">⚫ {t('users.anonymizedBadge')}</span>}
                            {!u.anonymizedAt && u.scheduledDeletionAt && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 border border-red-200" title="DSGVO Art. 17">⚠ {t('users.deletionScheduledBadge')}</span>}
                            {(u.tags ?? []).map((tag: string) => (
                              <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{u.email}</td>
                  <td className="px-4 py-3.5 text-center"><span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-lg bg-muted/60 text-xs font-semibold px-2">{u.ordersCount}</span></td>
                  <td className="px-4 py-3.5 text-end"><span className={`font-semibold text-[13px] ${u.totalRevenue > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{fmtCur(u.totalRevenue)}</span></td>
                  <td className="px-4 py-3.5 text-muted-foreground text-[13px]">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3.5 text-center">
                    {u.isBlocked
                      ? <button onClick={(e) => { e.stopPropagation(); unblockOneMut.mutate(u.id) }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 hover:ring-2 hover:ring-red-300 hover:ring-offset-1 cursor-pointer transition-all" title={locale === 'ar' ? 'انقر للإلغاء' : 'Klick zum Entsperren'}><ShieldAlert className="h-3 w-3" />{t('users.blocked')}</button>
                      : u.lockedUntil && new Date(u.lockedUntil) > new Date()
                        ? <button onClick={(e) => { e.stopPropagation(); unblockOneMut.mutate(u.id) }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700 hover:ring-2 hover:ring-orange-300 hover:ring-offset-1 cursor-pointer transition-all" title={locale === 'ar' ? 'انقر للإلغاء' : 'Klick zum Entsperren'}><ShieldAlert className="h-3 w-3" />{locale === 'ar' ? 'مقفل' : 'Gesperrt'}</button>
                        : !u.isActive
                          ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{locale === 'ar' ? 'غير نشط' : 'Inaktiv'}</span>
                          : <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700"><ShieldCheck className="h-3 w-3" />{t('users.activeStatus')}</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/${locale}/admin/customers/${u.id}`} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all opacity-0 group-hover:opacity-100 inline-flex"><Eye className="h-4 w-4" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/10">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {totalCount} {t('users.totalCustomers')}
              <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0) }} className="ml-2 px-2 py-1 rounded-lg border bg-background text-xs">
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} {t('users.perPage')}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></button>
              <span className="text-xs font-medium px-3">{page + 1} / {totalPages || 1}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"><ChevronRight className="h-4 w-4 rtl:rotate-180" /></button>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Customer Modal ─── */}
      {showAddModal && (
        <Modal onClose={() => setShowAddModal(false)}>
          <div className="text-center mb-6">
            <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4"><UserPlus className="h-6 w-6 text-blue-600" /></div>
            <h3 className="text-lg font-bold">{t('users.addCustomer')}</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium mb-1 block">{t('users.firstName')}</label><Input value={newCustomer.firstName} onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })} className="rounded-xl" /></div>
              <div><label className="text-xs font-medium mb-1 block">{t('users.lastName')}</label><Input value={newCustomer.lastName} onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })} className="rounded-xl" /></div>
            </div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.email')}</label><Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} className="rounded-xl" /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.phone')}</label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="rounded-xl" /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.language')}</label>
              <select value={newCustomer.lang} onChange={(e) => setNewCustomer({ ...newCustomer, lang: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-background text-sm">
                <option value="de">Deutsch</option><option value="en">English</option><option value="ar">العربية</option>
              </select>
            </div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.tags')}</label>
              <div className="flex flex-wrap gap-1.5">{AVAILABLE_TAGS.map((tag) => (
                <button key={tag} onClick={() => setNewCustomer({ ...newCustomer, tags: newCustomer.tags.includes(tag) ? newCustomer.tags.filter((t) => t !== tag) : [...newCustomer.tags, tag] })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${newCustomer.tags.includes(tag) ? TAG_COLORS[tag] ?? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'}`}>{tag}</button>
              ))}</div>
            </div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.notes')}</label>
              <textarea value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} placeholder={t('users.notePlaceholder')} rows={2} className="w-full px-3 py-2 rounded-xl border bg-transparent text-sm resize-none focus:outline-none focus:border-primary" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowAddModal(false)}>{t('inventory.cancel')}</Button>
              <Button className="flex-1 rounded-xl" disabled={!newCustomer.firstName.trim() || !newCustomer.lastName.trim() || !newCustomer.email.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? t('users.creating') : t('users.create')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Bulk Email Modal ─── */}
      {showBulkEmailModal && (
        <Modal onClose={() => setShowBulkEmailModal(false)}>
          <h3 className="text-lg font-bold mb-4">{t('users.bulkEmail')} ({selectedIds.size} {t('users.selected')})</h3>
          <div className="space-y-3">
            <div><label className="text-xs font-medium mb-1 block">{t('users.emailSubject')}</label><Input value={bulkEmailSubject} onChange={(e) => setBulkEmailSubject(e.target.value)} placeholder={t('users.emailSubjectPlaceholder')} className="rounded-xl" /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.emailBody')}</label>
              <textarea value={bulkEmailBody} onChange={(e) => setBulkEmailBody(e.target.value)} placeholder={t('users.emailBodyPlaceholder')} rows={5} className="w-full px-3 py-2 rounded-xl border bg-transparent text-sm resize-none focus:outline-none focus:border-primary" />
            </div>
            <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowBulkEmailModal(false)}>{t('inventory.cancel')}</Button>
              <Button className="flex-1 rounded-xl" disabled={!bulkEmailSubject.trim() || !bulkEmailBody.trim() || bulkEmailMut.isPending} onClick={() => bulkEmailMut.mutate()}>{bulkEmailMut.isPending ? t('users.emailSending') : t('users.sendEmail')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Bulk Tag Modal ─── */}
      {showBulkTagModal && (
        <Modal onClose={() => setShowBulkTagModal(false)}>
          <h3 className="text-lg font-bold mb-4">{t('users.bulkTag')} ({selectedIds.size} {t('users.selected')})</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {AVAILABLE_TAGS.map((tag) => (
              <button key={tag} onClick={() => setBulkTags(bulkTags.includes(tag) ? bulkTags.filter((t) => t !== tag) : [...bulkTags, tag])}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${bulkTags.includes(tag) ? TAG_COLORS[tag] ?? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'}`}>{tag}</button>
            ))}
          </div>
          <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowBulkTagModal(false)}>{t('inventory.cancel')}</Button>
            <Button className="flex-1 rounded-xl" disabled={bulkTags.length === 0 || bulkTagMut.isPending} onClick={() => bulkTagMut.mutate()}>{t('users.addTag')}</Button>
          </div>
        </Modal>
      )}

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all bg-background cursor-pointer ${value ? 'border-primary/50 text-primary bg-primary/5' : 'border-muted-foreground/20 text-muted-foreground'}`}>
      <option value="" disabled hidden>{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'fadeIn 200ms ease-out' }} />
      <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
        <button onClick={onClose} className="absolute top-4 right-4 rtl:right-auto rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  )
}
