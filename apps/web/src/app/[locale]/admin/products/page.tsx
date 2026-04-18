'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, Fragment } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, Copy, Trash2, LayoutList, LayoutGrid,
  ChevronDown, ChevronRight, ChevronLeft, Check, Download,
  Package, Edit3, ArrowUpDown, RotateCcw, AlertTriangle,
  Flame,
} from 'lucide-react'
import { api } from '@/lib/api'
import { translateColor, getProductName, getCategoryName, formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useAdminCategories } from '@/hooks/use-categories'

const STOCK_BADGE: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-800',
  low: 'bg-orange-100 text-orange-800',
  out_of_stock: 'bg-red-100 text-red-800',
}

export default function AdminProductsPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(0)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Bulk re-categorize modal state
  const [showCategorizeModal, setShowCategorizeModal] = useState(false)
  const [bulkParentCategoryId, setBulkParentCategoryId] = useState('')
  const [bulkSubCategoryId, setBulkSubCategoryId] = useState('')
  // Admin variant — all translations per category, not language-filtered.
  // Lets the dropdown labels fall back AR → DE → EN → slug cleanly.
  const { data: allCategoriesTree } = useAdminCategories()

  // Data
  const { data: departments } = useQuery({
    queryKey: ['inventory-departments'],
    queryFn: async () => { const { data } = await api.get('/admin/inventory/summary'); return data },
  })

  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-products', search, categoryId, statusFilter, stockFilter, channelFilter, sortBy, sortDir, pageSize, page],
    queryFn: async () => {
      const { data } = await api.get('/admin/products', {
        params: {
          search: search || undefined,
          parentCategoryId: categoryId || undefined,
          status: statusFilter || undefined,
          stockStatus: stockFilter || undefined,
          channel: channelFilter || undefined,
          sortBy, sortDir, limit: pageSize, offset: page * pageSize,
        },
      })
      return data
    },
  })

  const products = result?.data ?? []
  const totalCount = result?.meta?.total ?? 0
  const totalPages = Math.ceil(totalCount / pageSize)

  // Mutations
  const bulkMut = useMutation({
    mutationFn: ({ action, ids }: { action: string; ids: string[] }) => {
      if (action === 'activate') return api.post('/admin/products/bulk/status', { productIds: ids, isActive: true })
      if (action === 'deactivate') return api.post('/admin/products/bulk/status', { productIds: ids, isActive: false })
      return api.delete('/admin/products/bulk', { data: { productIds: ids } })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-products'] }); setSelected(new Set()) },
  })

  const channelMut = useMutation({
    mutationFn: ({ ids, channel, enabled }: { ids: string[]; channel: string; enabled: boolean }) =>
      api.post('/admin/products/bulk/channels', { productIds: ids, channel, enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-products'] }); setSelected(new Set()) },
  })

  // Bulk re-categorize — moves N selected products to a new category id.
  // The modal state is kept local to this page; target category is the
  // leaf (sub) category id chosen from the cascading parent → sub picker.
  const categorizeMut = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string }) =>
      api.post('/admin/products/bulk/categorize', { productIds: ids, categoryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] })
      setSelected(new Set())
      setShowCategorizeModal(false)
      setBulkParentCategoryId('')
      setBulkSubCategoryId('')
    },
  })

  const toggleStatusMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.post('/admin/products/bulk/status', { productIds: [id], isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  })

  const dupMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/products/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-products'] }); setDeleteTarget(null); setDeleteConfirmText('') },
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/products/${id}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  })

  // Permanent delete. The backend rejects with ConflictException +
  // { error: 'ProductHasReferences', message: {de,en,ar}, blockers } when
  // the product is still referenced by orders/reviews/coupons/promotions.
  // We catch that specifically and surface it as a read-only info modal
  // instead of a toast, so the admin gets the full list of blockers.
  const hardDeleteMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/products/${id}/hard-delete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] })
      setHardDeleteTarget(null)
      setHardDeleteConfirmText('')
    },
    onError: (err: any) => {
      const data = err?.response?.data
      if (data?.error === 'ProductHasReferences') {
        setHardDeleteBlockers({
          message: data.message,
          blockers: data.blockers,
          name: hardDeleteTarget?.name ?? '',
        })
        setHardDeleteTarget(null)
        setHardDeleteConfirmText('')
      }
    },
  })

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [hardDeleteTarget, setHardDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('')
  const [hardDeleteBlockers, setHardDeleteBlockers] = useState<{
    message: { de: string; en: string; ar: string }
    blockers: { orderItems: number; reviews: number; coupons: number; promotions: number }
    name: string
  } | null>(null)

  // The typed-confirmation phrase for hard delete. Must be spelled out
  // by the admin — "löschen" / "delete" / "حذف" depending on locale.
  // NOT the product name, because typing the name is a "skill check"
  // that the admin already passed for soft-delete; for the dangerous
  // irreversible step we want a separate explicit phrase.
  const hardDeletePhrase = locale === 'ar' ? 'حذف نهائي' : locale === 'en' ? 'permanently delete' : 'endgültig löschen'

  // Helpers
  const getName = (ts: any[]) => getProductName(ts, locale)
  const catName = (cat: any) => { if (!cat?.parent) return getCategoryName(cat, locale); return getCategoryName(cat.parent, locale) }
  const fmtCur = (n: number) => formatCurrency(n, locale)


  const toggleSelect = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }
  const toggleSelectAll = () => { if (selected.size === products.length) setSelected(new Set()); else setSelected(new Set(products.map((p: any) => p.id))) }
  const toggleSort = (key: string) => { if (sortBy === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); else { setSortBy(key); setSortDir('desc') } }
  const hasFilters = categoryId || statusFilter || stockFilter || channelFilter
  const resetFilters = () => { setCategoryId(''); setStatusFilter(''); setStockFilter(''); setChannelFilter(''); setPage(0) }

  const handleExport = async () => {
    // Admin endpoints need the admin JWT, not the customer accessToken.
    // Using accessToken returns 401 and writes the JSON error to disk.
    const store = (await import('@/store/auth-store')).useAuthStore.getState()
    const token = store.adminAccessToken || store.accessToken
    if (!token) {
      alert(locale === 'ar' ? 'يرجى تسجيل الدخول كمسؤول أولاً' : locale === 'en' ? 'Please log in as admin first' : 'Bitte als Admin einloggen')
      return
    }
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products/export`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[products export] HTTP', res.status, errText)
      alert(locale === 'ar' ? `فشل التصدير (${res.status})` : locale === 'en' ? `Export failed (${res.status})` : `Export fehlgeschlagen (${res.status})`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'produkte.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('products.title') }]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('products.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl gap-2" onClick={handleExport}><Download className="h-4 w-4" />{t('products.export')}</Button>
          <Link href={`/${locale}/admin/products/new`}><Button size="sm" className="rounded-xl gap-2"><Plus className="h-4 w-4" />{t('products.newProduct')}</Button></Link>
        </div>
      </div>

      {/* Category Chips */}
      {departments && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => { setCategoryId(''); setPage(0) }} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${!categoryId ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>{t('products.allCategories')}</button>
          {(departments as any[]).map((d: any) => (
            <button key={d.id} onClick={() => { setCategoryId(categoryId === d.id ? '' : d.id); setPage(0) }}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${categoryId === d.id ? 'bg-[#1a1a2e] text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>
              {getName(d.translations)} <span className="opacity-60 ml-1">{d.total}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search + Filters + View Toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('products.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} className="pl-10 rtl:pl-3 rtl:pr-10 h-10 rounded-xl" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${statusFilter ? 'border-primary/50 text-primary bg-primary/5' : ''}`}>
          <option value="">{t('products.allStatus')}</option>
          <option value="active">{t('products.active')}</option>
          <option value="inactive">{t('products.inactive')}</option>
          <option value="deleted">{locale === 'ar' ? 'محذوف' : locale === 'en' ? 'Deleted' : 'Gelöscht'}</option>
        </select>
        <select value={stockFilter} onChange={(e) => { setStockFilter(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${stockFilter ? 'border-primary/50 text-primary bg-primary/5' : ''}`}>
          <option value="">{t('products.stockAll')}</option>
          <option value="in_stock">{t('products.stockInStock')}</option>
          <option value="low">{t('products.stockLow')}</option>
          <option value="out_of_stock">{t('products.stockOut')}</option>
        </select>
        <select value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setPage(0) }} className={`px-3 py-2 rounded-xl text-xs font-medium border bg-background cursor-pointer ${channelFilter ? 'border-primary/50 text-primary bg-primary/5' : ''}`}>
          <option value="">{locale === 'ar' ? 'كل القنوات' : 'Alle Kanäle'}</option>
          <option value="facebook">Facebook / Instagram</option>
          <option value="tiktok">TikTok Shop</option>
          <option value="google">Google Shopping</option>
          <option value="whatsapp">WhatsApp Catalog</option>
        </select>
        {hasFilters && <button onClick={resetFilters} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"><RotateCcw className="h-3 w-3" />{t('products.filterReset')}</button>}

        {/* View Toggle */}
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-xl p-0.5 ml-auto">
          <button onClick={() => setView('list')} className={`p-2 rounded-lg transition-all ${view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><LayoutList className="h-4 w-4" /></button>
          <button onClick={() => setView('grid')} className={`p-2 rounded-lg transition-all ${view === 'grid' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Sort + Bulk */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground"><ArrowUpDown className="h-3.5 w-3.5 inline" /></span>
          {['date', 'price', 'stock', 'name'].map((s) => (
            <button key={s} onClick={() => toggleSort(s)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sortBy === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {t(`products.sort${s.charAt(0).toUpperCase() + s.slice(1)}`)}
              {sortBy === s && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-primary">{selected.size} {t('products.selected')}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => bulkMut.mutate({ action: 'activate', ids: [...selected] })}>{t('products.bulkActivate')}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => bulkMut.mutate({ action: 'deactivate', ids: [...selected] })}>{t('products.bulkDeactivate')}</Button>
            <span className="w-px h-5 bg-border" />
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg text-blue-600 border-blue-200" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'facebook', enabled: true })}>{locale === 'ar' ? '+ فيسبوك' : '+ Facebook'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'facebook', enabled: false })}>{locale === 'ar' ? '− فيسبوك' : '− Facebook'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'tiktok', enabled: true })}>{locale === 'ar' ? '+ تيك توك' : '+ TikTok'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'tiktok', enabled: false })}>{locale === 'ar' ? '− تيك توك' : '− TikTok'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'google', enabled: true })}>{locale === 'ar' ? '+ جوجل' : '+ Google'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'google', enabled: false })}>{locale === 'ar' ? '− جوجل' : '− Google'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg text-green-600 border-green-200" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'whatsapp', enabled: true })}>{locale === 'ar' ? '+ واتساب' : '+ WhatsApp'}</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => channelMut.mutate({ ids: [...selected], channel: 'whatsapp', enabled: false })}>{locale === 'ar' ? '− واتساب' : '− WhatsApp'}</Button>
            <span className="w-px h-5 bg-border" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-lg text-amber-700 border-amber-200"
              onClick={() => setShowCategorizeModal(true)}
            >
              <Package className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
              {locale === 'ar' ? 'نقل إلى فئة...' : locale === 'en' ? 'Move to category…' : 'In Kategorie verschieben…'}
            </Button>
            <span className="w-px h-5 bg-border" />
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg text-red-600 border-red-200" onClick={() => bulkMut.mutate({ action: 'delete', ids: [...selected] })}><Trash2 className="h-3 w-3 mr-1" />{t('products.bulkDelete')}</Button>
          </div>
        )}
      </div>

      {/* ── GRID VIEW ── */}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {isLoading ? Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="bg-background border rounded-2xl overflow-hidden"><div className="aspect-square bg-muted animate-pulse" /><div className="p-4 space-y-2"><div className="h-4 bg-muted rounded animate-pulse" /><div className="h-3 bg-muted rounded animate-pulse w-2/3" /></div></div>
          )) : products.length === 0 ? (
            <div className="col-span-full py-16 text-center"><Package className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-muted-foreground">{t('products.noProducts')}</p></div>
          ) : products.map((p: any, i: number) => (
            <div key={p.id} className="group bg-background border rounded-2xl overflow-hidden hover:shadow-lg hover:border-primary/20 transition-all duration-300"
              style={{ animationDelay: `${i * 30}ms`, animation: 'fadeSlideUp 300ms ease-out both' }}>
              {/* Image */}
              <Link href={`/${locale}/admin/products/${p.id}`}>
                <div className="aspect-square bg-muted/30 relative overflow-hidden">
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    : <div className="w-full h-full flex items-center justify-center"><Package className="h-12 w-12 text-muted-foreground/15" /></div>}
                  {/* Status badge */}
                  <div className="absolute top-2 right-2 rtl:right-auto rtl:left-2">
                    <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleStatusMut.mutate({ id: p.id, isActive: !p.isActive }) }} className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 ${p.isActive ? 'bg-green-100 text-green-800 hover:ring-green-300' : 'bg-gray-100 text-gray-600 hover:ring-gray-300'}`} title={p.isActive ? t('products.activeTooltip') : t('products.inactiveTooltip')}>{p.isActive ? t('products.active') : t('products.inactive')}</button>
                  </div>
                  {/* Stock badge */}
                  <div className="absolute bottom-2 right-2 rtl:right-auto rtl:left-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STOCK_BADGE[p.stockStatus]}`}>{p.totalStock}</span>
                  </div>
                  {/* Hover actions */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Link href={`/${locale}/admin/products/${p.id}`} className="h-9 w-9 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform"><Edit3 className="h-4 w-4" /></Link>
                    <button onClick={(e) => { e.preventDefault(); dupMut.mutate(p.id) }} className="h-9 w-9 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform"><Copy className="h-4 w-4" /></button>
                  </div>
                </div>
              </Link>
              {/* Info */}
              <div className="p-3">
                <div className="text-sm font-semibold line-clamp-1 mb-1">{getName(p.translations)}</div>
                <div className="flex items-center justify-between">
                  <div>
                    {p.salePrice ? <><span className="text-sm font-bold text-red-600">{fmtCur(p.salePrice)}</span><span className="text-xs text-muted-foreground line-through ml-1">{fmtCur(p.basePrice)}</span></>
                      : <span className="text-sm font-bold">{fmtCur(p.basePrice)}</span>}
                  </div>
                  {/* Color dots */}
                  {p.colorHexes?.length > 0 && (
                    <div className="flex -space-x-1">{p.colorHexes.slice(0, 4).map((hex: string, j: number) => (
                      <div key={j} className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: hex }} />
                    ))}{p.colorHexes.length > 4 && <span className="text-[10px] text-muted-foreground ml-1">+{p.colorHexes.length - 4}</span>}</div>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">{p.variantsCount} {t('products.variants')} | {catName(p.category)}</div>
                {/* Missing translations warning */}
                {p.missingLangs?.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-orange-600">
                    <AlertTriangle className="h-3 w-3" />
                    {p.missingLangs.map((l: string) => l.toUpperCase()).join(', ')} {t('products.missingTranslation')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-3 w-8"><button onClick={toggleSelectAll} className={`h-4 w-4 rounded border-2 flex items-center justify-center ${selected.size === products.length && products.length > 0 ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>{selected.size === products.length && products.length > 0 && <Check className="h-3 w-3 text-white" />}</button></th>
                  <th className="px-3 py-3 w-16"></th>
                  <th className="text-start px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.product')}</th>
                  <th className="text-start px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.category')}</th>
                  <th className="text-center px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.variants')}</th>
                  <th className="text-end px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.price')}</th>
                  <th className="text-center px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.stock')}</th>
                  <th className="text-center px-3 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t('products.status')}</th>
                  <th className="px-3 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b"><td colSpan={9} className="px-3 py-4"><div className="h-4 bg-muted rounded-lg animate-pulse" style={{ width: `${50 + Math.random() * 40}%` }} /></td></tr>
                )) : products.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-16 text-center"><Package className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-muted-foreground">{t('products.noProducts')}</p></td></tr>
                ) : products.map((p: any, i: number) => {
                  const isExpanded = expandedId === p.id
                  return (
                    <Fragment key={p.id}><tr className="border-b hover:bg-muted/20 transition-colors group" style={{ animationDelay: `${i * 15}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                      <td className="px-3 py-3"><button onClick={() => toggleSelect(p.id)} className={`h-4 w-4 rounded border-2 flex items-center justify-center ${selected.has(p.id) ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}>{selected.has(p.id) && <Check className="h-3 w-3 text-white" />}</button></td>
                      {/* Thumbnail */}
                      <td className="px-3 py-3">
                        <Link href={`/${locale}/admin/products/${p.id}`}>
                          {p.image ? <img src={p.image} alt="" className="h-14 w-14 rounded-xl object-cover" />
                            : <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground/30" /></div>}
                        </Link>
                      </td>
                      {/* Name + SKU + Missing langs */}
                      <td className="px-3 py-3">
                        <Link href={`/${locale}/admin/products/${p.id}`} className="group/link">
                          <div className={`font-semibold text-[13px] group-hover/link:text-primary transition-colors line-clamp-1 ${p.deletedAt ? 'line-through text-muted-foreground' : ''}`}>{getName(p.translations)}</div>
                          {p.deletedAt && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300">{locale === 'ar' ? 'محذوف' : locale === 'en' ? 'Deleted' : 'Gelöscht'}</span>}
                          {p.variants[0]?.sku && <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{p.variants[0].sku}</div>}
                          {(p.channelFacebook || p.channelTiktok || p.channelGoogle || p.channelWhatsapp) && (
                            <div className="flex items-center gap-1.5 mt-1">
                              {p.channelFacebook && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>}
                              {p.channelTiktok && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.21 8.21 0 004.76 1.52V7.05a4.84 4.84 0 01-1-.36z"/></svg>}
                              {p.channelGoogle && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>}
                              {p.channelWhatsapp && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>}
                            </div>
                          )}
                          {p.missingLangs?.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-orange-600"><AlertTriangle className="h-3 w-3" />{p.missingLangs.map((l: string) => l.toUpperCase()).join(', ')} {t('products.missingTranslation')}</div>
                          )}
                        </Link>
                      </td>
                      {/* Category */}
                      <td className="px-3 py-3">
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-[11px] font-medium bg-muted/60">{catName(p.category)}</span>
                      </td>
                      {/* Variants (expandable) */}
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => setExpandedId(isExpanded ? null : p.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-muted transition-colors">
                          {/* Color dots */}
                          {p.colorHexes?.length > 0 && (
                            <div className="flex -space-x-0.5 mr-1">{p.colorHexes.slice(0, 3).map((hex: string, j: number) => (
                              <div key={j} className="h-3 w-3 rounded-full border border-white" style={{ backgroundColor: hex }} />
                            ))}</div>
                          )}
                          {p.variantsCount}
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </td>
                      {/* Price */}
                      <td className="px-3 py-3 text-end">
                        {p.salePrice ? <><div className="font-bold text-[13px] text-red-600">{fmtCur(p.salePrice)}</div><div className="text-[10px] text-muted-foreground line-through">{fmtCur(p.basePrice)}</div></>
                          : p.priceRange?.min !== p.priceRange?.max ? <div className="text-[13px] font-medium">{fmtCur(p.priceRange.min)} – {fmtCur(p.priceRange.max)}</div>
                          : <div className="text-[13px] font-bold">{fmtCur(p.basePrice)}</div>}
                      </td>
                      {/* Stock */}
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STOCK_BADGE[p.stockStatus]}`}>{p.totalStock}</span>
                      </td>
                      {/* Status — toggle disabled on soft-deleted products
                          so the admin can't accidentally re-flip isActive
                          back to true while deletedAt is still set. That
                          combination would leave the row in a contradictory
                          state ("deleted" + "active") and the storefront
                          filter would still exclude it, but the admin UI
                          would look wrong. */}
                      <td className="px-3 py-3 text-center">
                        {p.deletedAt ? (
                          <span
                            className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-400 cursor-not-allowed"
                            title={locale === 'ar' ? 'استعد المنتج أولاً لتفعيله' : locale === 'en' ? 'Restore the product first to activate it' : 'Produkt erst wiederherstellen, dann aktivieren'}
                          >
                            {t('products.inactive')}
                          </span>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleStatusMut.mutate({ id: p.id, isActive: !p.isActive }) }}
                            className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 ${p.isActive ? 'bg-green-100 text-green-800 hover:ring-green-300' : 'bg-gray-100 text-gray-600 hover:ring-gray-300'}`}
                            title={p.isActive ? t('products.activeTooltip') : t('products.inactiveTooltip')}
                          >
                            {p.isActive ? t('products.active') : t('products.inactive')}
                          </button>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <Link href={`/${locale}/admin/products/${p.id}`} className="p-1.5 rounded-lg hover:bg-muted"><Edit3 className="h-3.5 w-3.5 text-muted-foreground" /></Link>
                          <button onClick={() => dupMut.mutate(p.id)} className="p-1.5 rounded-lg hover:bg-muted"><Copy className="h-3.5 w-3.5 text-muted-foreground" /></button>
                          {p.deletedAt ? (
                            <>
                              <button onClick={() => restoreMut.mutate(p.id)} className="p-1.5 rounded-lg hover:bg-green-100" title={locale === 'ar' ? 'استعادة' : locale === 'en' ? 'Restore' : 'Wiederherstellen'}>
                                <RotateCcw className="h-3.5 w-3.5 text-green-600" />
                              </button>
                              <button
                                onClick={() => setHardDeleteTarget({ id: p.id, name: getName(p.translations) })}
                                className="p-1.5 rounded-lg hover:bg-red-100 ring-1 ring-red-200/60 dark:ring-red-500/30"
                                title={locale === 'ar' ? 'حذف نهائي' : locale === 'en' ? 'Permanently delete' : 'Endgültig löschen'}
                              >
                                <Flame className="h-3.5 w-3.5 text-red-600" />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteTarget({ id: p.id, name: getName(p.translations) })} className="p-1.5 rounded-lg hover:bg-red-100" title={locale === 'ar' ? 'حذف' : 'Löschen'}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded variants row */}
                    {isExpanded && (
                      <tr key={`${p.id}-variants`} className="border-b bg-muted/10">
                        <td colSpan={9} className="px-6 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                            {p.variants.map((v: any) => (
                              <div key={v.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-background border hover:border-primary/20 transition-colors">
                                {v.colorHex && <div className="h-6 w-6 rounded-full border flex-shrink-0" style={{ backgroundColor: v.colorHex }} />}
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium">{translateColor(v.color, locale)} / {v.size}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">{v.sku}</div>
                                </div>
                                <div className="text-end">
                                  <div className="text-xs font-bold">{fmtCur(v.price)}</div>
                                  <div className={`text-[10px] font-semibold ${v.stock <= 0 ? 'text-red-600' : v.stock <= 5 ? 'text-orange-600' : 'text-green-600'}`}>{v.stock}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}</Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {totalCount} {t('products.product')}
                <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0) }} className="ml-2 px-2 py-1 rounded-lg border bg-background text-xs">
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n} {t('products.perPage')}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-xs font-medium px-3 tabular-nums" dir="ltr">{page + 1} / {totalPages || 1}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grid pagination */}
      {view === 'grid' && totalCount > 0 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-muted-foreground">{totalCount} {t('products.product')}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs font-medium px-3 tabular-nums" dir="ltr">{page + 1} / {totalPages || 1}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-red-500">
              {locale === 'ar' ? 'حذف المنتج' : locale === 'en' ? 'Delete Product' : 'Produkt löschen'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {locale === 'ar'
                ? <>هل أنت متأكد من حذف <strong>{deleteTarget.name}</strong>؟ اكتب اسم المنتج للتأكيد.</>
                : locale === 'en'
                ? <>Are you sure you want to delete <strong>{deleteTarget.name}</strong>? Type the product name to confirm.</>
                : <>Bist du sicher, dass du <strong>{deleteTarget.name}</strong> löschen möchtest? Gib den Produktnamen zur Bestätigung ein.</>
              }
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget.name}
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}>
                {locale === 'ar' ? 'إلغاء' : locale === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
              <Button
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteConfirmText !== deleteTarget.name || deleteMut.isPending}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                {deleteMut.isPending ? '...' : locale === 'ar' ? 'حذف' : locale === 'en' ? 'Delete' : 'Löschen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── HARD DELETE CONFIRMATION MODAL (Stufe 3 — gefährlich, irreversibel) ── */}
      {hardDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setHardDeleteTarget(null); setHardDeleteConfirmText('') }}>
          <div className="bg-background border-2 border-red-500/40 rounded-2xl p-6 w-full max-w-md mx-4 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Flame className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-600">
                  {locale === 'ar' ? 'حذف نهائي' : locale === 'en' ? 'Permanently Delete' : 'Endgültig löschen'}
                </h2>
                <p className="text-[11px] text-red-600/80 font-medium">
                  {locale === 'ar' ? 'هذا الإجراء لا يمكن التراجع عنه' : locale === 'en' ? 'This action cannot be undone' : 'Diese Aktion kann nicht rückgängig gemacht werden'}
                </p>
              </div>
            </div>

            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-xs text-red-900 dark:text-red-200 space-y-1">
              <div className="font-semibold">
                {locale === 'ar'
                  ? <>سيتم حذف <strong className="font-bold">{hardDeleteTarget.name}</strong> نهائياً من قاعدة البيانات.</>
                  : locale === 'en'
                  ? <><strong className="font-bold">{hardDeleteTarget.name}</strong> will be permanently erased from the database.</>
                  : <><strong className="font-bold">{hardDeleteTarget.name}</strong> wird dauerhaft aus der Datenbank entfernt.</>}
              </div>
              <div className="opacity-80">
                {locale === 'ar'
                  ? 'سيتم حذف جميع الصور والمتغيرات والترجمات والمخزون المرتبط به.'
                  : locale === 'en'
                  ? 'All images, variants, translations and linked inventory will be wiped.'
                  : 'Alle Bilder, Varianten, Übersetzungen und Bestand werden mitgelöscht.'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {locale === 'ar'
                  ? <>اكتب <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{hardDeletePhrase}</code> للتأكيد:</>
                  : locale === 'en'
                  ? <>Type <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{hardDeletePhrase}</code> to confirm:</>
                  : <>Tippe <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{hardDeletePhrase}</code> zur Bestätigung:</>}
              </label>
              <input
                value={hardDeleteConfirmText}
                onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                placeholder={hardDeletePhrase}
                className="w-full h-11 px-3 rounded-lg border border-red-300 dark:border-red-500/40 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                autoFocus
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setHardDeleteTarget(null); setHardDeleteConfirmText('') }}>
                {locale === 'ar' ? 'إلغاء' : locale === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
              <Button
                onClick={() => hardDeleteMut.mutate(hardDeleteTarget.id)}
                disabled={hardDeleteConfirmText.trim() !== hardDeletePhrase || hardDeleteMut.isPending}
                className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
              >
                {hardDeleteMut.isPending
                  ? '...'
                  : locale === 'ar' ? 'حذف نهائي' : locale === 'en' ? 'Delete Forever' : 'Endgültig löschen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── HARD DELETE BLOCKER MODAL (Produkt ist mit X Bestellungen verknüpft) ── */}
      {hardDeleteBlockers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setHardDeleteBlockers(null)}>
          <div className="bg-background border border-amber-500/40 rounded-2xl p-6 w-full max-w-md mx-4 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-amber-700 dark:text-amber-400">
                  {locale === 'ar' ? 'غير قابل للحذف' : locale === 'en' ? 'Cannot Delete' : 'Nicht löschbar'}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {locale === 'ar' ? 'المنتج مرتبط بسجلات محمية' : locale === 'en' ? 'Product linked to protected records' : 'Produkt ist mit geschützten Datensätzen verknüpft'}
                </p>
              </div>
            </div>

            <p className="text-sm text-foreground">
              {hardDeleteBlockers.message[locale as 'de' | 'en' | 'ar'] ?? hardDeleteBlockers.message.de}
            </p>

            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              {hardDeleteBlockers.blockers.orderItems > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'طلبات مرتبطة' : locale === 'en' ? 'Linked orders' : 'Verknüpfte Bestellungen'}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{hardDeleteBlockers.blockers.orderItems}</span>
                </div>
              )}
              {hardDeleteBlockers.blockers.reviews > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'تقييمات' : locale === 'en' ? 'Reviews' : 'Bewertungen'}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{hardDeleteBlockers.blockers.reviews}</span>
                </div>
              )}
              {hardDeleteBlockers.blockers.coupons > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'قسائم' : locale === 'en' ? 'Coupons' : 'Gutscheine'}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{hardDeleteBlockers.blockers.coupons}</span>
                </div>
              )}
              {hardDeleteBlockers.blockers.promotions > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {locale === 'ar' ? 'عروض' : locale === 'en' ? 'Promotions' : 'Promotionen'}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{hardDeleteBlockers.blockers.promotions}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {locale === 'ar'
                ? 'يبقى المنتج محذوفاً (غير ظاهر للعملاء) لكن البيانات التاريخية محفوظة للامتثال الضريبي.'
                : locale === 'en'
                ? 'The product stays soft-deleted (hidden from customers) but historical data is preserved for tax compliance.'
                : 'Das Produkt bleibt soft-deleted (für Kunden unsichtbar), historische Daten werden für die Steuer-Compliance aufbewahrt.'}
            </p>

            <div className="flex justify-end">
              <Button onClick={() => setHardDeleteBlockers(null)} variant="outline">
                {locale === 'ar' ? 'حسناً' : locale === 'en' ? 'Got it' : 'Verstanden'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── BULK RE-CATEGORIZE MODAL ── */}
      {showCategorizeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-600" />
              {locale === 'ar' ? 'نقل المنتجات إلى فئة' : locale === 'en' ? 'Move products to category' : 'Produkte in Kategorie verschieben'}
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              {locale === 'ar'
                ? `سيتم نقل ${selected.size} منتج إلى الفئة المحددة. هذا الإجراء يمكن عكسه بتغيير الفئة مرة أخرى.`
                : locale === 'en'
                ? `${selected.size} products will be moved to the selected category. Reversible — you can change the category again later.`
                : `${selected.size} Produkte werden in die gewählte Kategorie verschoben. Reversibel — du kannst die Kategorie später wieder ändern.`}
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {locale === 'ar' ? 'الفئة الرئيسية' : locale === 'en' ? 'Main Category' : 'Hauptkategorie'}
                </label>
                <select
                  value={bulkParentCategoryId}
                  onChange={(e) => {
                    setBulkParentCategoryId(e.target.value)
                    setBulkSubCategoryId('')
                  }}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm"
                >
                  <option value="">—</option>
                  {(allCategoriesTree ?? []).map((cat: any) => {
                    const label = cat.translations?.find((t: any) => t.language === locale)?.name
                      ?? cat.translations?.find((t: any) => t.language === 'de')?.name
                      ?? cat.translations?.find((t: any) => t.language === 'en')?.name
                      ?? cat.slug
                    return <option key={cat.id} value={cat.id}>{label}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {locale === 'ar' ? 'الفئة الفرعية' : locale === 'en' ? 'Sub Category' : 'Unterkategorie'}
                </label>
                <select
                  value={bulkSubCategoryId}
                  onChange={(e) => setBulkSubCategoryId(e.target.value)}
                  disabled={!bulkParentCategoryId}
                  className="w-full h-10 px-3 rounded-xl border bg-background text-sm disabled:opacity-50"
                >
                  <option value="">—</option>
                  {(() => {
                    const parent = (allCategoriesTree ?? []).find((c: any) => c.id === bulkParentCategoryId)
                    const children = parent?.children ?? []
                    return children.map((sub: any) => {
                      const label = sub.translations?.find((t: any) => t.language === locale)?.name
                        ?? sub.translations?.find((t: any) => t.language === 'de')?.name
                        ?? sub.translations?.find((t: any) => t.language === 'en')?.name
                        ?? sub.slug
                      return <option key={sub.id} value={sub.id}>{label}</option>
                    })
                  })()}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCategorizeModal(false)
                  setBulkParentCategoryId('')
                  setBulkSubCategoryId('')
                }}
                disabled={categorizeMut.isPending}
              >
                {locale === 'ar' ? 'إلغاء' : locale === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
              <Button
                onClick={() => categorizeMut.mutate({ ids: [...selected], categoryId: bulkSubCategoryId })}
                disabled={!bulkSubCategoryId || categorizeMut.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {categorizeMut.isPending
                  ? '...'
                  : locale === 'ar'
                  ? `نقل ${selected.size}`
                  : locale === 'en'
                  ? `Move ${selected.size}`
                  : `${selected.size} verschieben`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
