'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Ticket, Plus, Search, BarChart3, X, Check, Calendar,
  Percent, Euro, Package,
} from 'lucide-react'

interface Coupon {
  id: string; code: string; type: 'percentage' | 'fixed_amount' | 'free_shipping'
  description: string | null; discountPercent: number | null; discountAmount: number | null
  freeShipping: boolean; minOrderAmount: number | null; maxUsageCount: number | null
  usedCount: number; onePerCustomer: boolean; isActive: boolean
  startAt: string | null; expiresAt: string | null
  appliesToCategoryId: string | null; appliesToProductId: string | null; createdAt: string
}

interface CouponStats { totalUses: number; totalRevenue: number; avgOrderValue: number }

const TYPE_BADGE: Record<string, string> = {
  percentage: 'bg-green-100 text-green-800',
  fixed_amount: 'bg-blue-100 text-blue-800',
  free_shipping: 'bg-purple-100 text-purple-800',
}

export default function AdminCouponsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [statsId, setStatsId] = useState<string | null>(null)

  // Form state
  const [code, setCode] = useState('')
  const [type, setType] = useState<Coupon['type']>('percentage')
  const [description, setDescription] = useState('')
  const [discountPercent, setDiscountPercent] = useState<number | ''>('')
  const [discountAmount, setDiscountAmount] = useState<number | ''>('')
  const [freeShipping, setFreeShipping] = useState(false)
  const [minOrderAmount, setMinOrderAmount] = useState<number | ''>('')
  const [maxUsageCount, setMaxUsageCount] = useState<number | ''>('')
  const [onePerCustomer, setOnePerCustomer] = useState(false)
  const [startAt, setStartAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [appliesToCategoryId, setAppliesToCategoryId] = useState('')
  const [appliesToProductId, setAppliesToProductId] = useState('')
  const [appliesTo, setAppliesTo] = useState<'all' | 'category' | 'product'>('all')

  // Load categories & products for "applies to" dropdowns
  const { data: categoriesData } = useQuery({
    queryKey: ['admin-categories-list'],
    queryFn: async () => { const { data } = await api.get('/admin/categories'); return (data?.data ?? data ?? []) as any[] },
  })
  const { data: productsData } = useQuery({
    queryKey: ['admin-products-list'],
    queryFn: async () => { const { data } = await api.get('/admin/products', { params: { limit: 100 } }); return (data?.data ?? data ?? []) as any[] },
  })

  const categoryOptions = (categoriesData ?? []).map((c: any) => ({
    value: c.id,
    label: c.translations?.find((t: any) => t.language === locale)?.name ?? c.translations?.[0]?.name ?? c.id,
  }))
  const productOptions = (productsData ?? []).map((p: any) => ({
    value: p.id,
    label: p.translations?.find((t: any) => t.language === locale)?.name ?? p.translations?.[0]?.name ?? 'Product',
    sublabel: p.variants?.[0]?.sku ?? p.slug ?? '',
  }))

  // Queries
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-coupons', search, activeFilter],
    queryFn: async () => {
      const { data } = await api.get('/admin/marketing/coupons', {
        params: { search: search || undefined, isActive: activeFilter || undefined, limit: 50, offset: 0 },
      })
      return data as { data: Coupon[]; meta: { total: number } }
    },
  })

  const coupons = result?.data ?? []
  const total = result?.meta?.total ?? 0
  const activeCount = coupons.filter((c) => c.isActive).length
  const totalUses = coupons.reduce((s, c) => s + c.usedCount, 0)

  const { data: stats } = useQuery<CouponStats>({
    queryKey: ['coupon-stats', statsId],
    queryFn: async () => { const { data } = await api.get(`/admin/marketing/coupons/${statsId}/stats`); return data as CouponStats },
    enabled: !!statsId,
  })

  // Mutations
  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editId ? api.patch(`/admin/marketing/coupons/${editId}`, payload) : api.post('/admin/marketing/coupons', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coupons'] }); closePanel() },
  })

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/marketing/coupons/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-coupons'] }),
  })

  // Helpers
  const resetForm = () => {
    setCode(''); setType('percentage'); setDescription(''); setDiscountPercent(''); setDiscountAmount('')
    setFreeShipping(false); setMinOrderAmount(''); setMaxUsageCount(''); setOnePerCustomer(false)
    setStartAt(''); setExpiresAt(''); setAppliesToCategoryId(''); setAppliesToProductId(''); setAppliesTo('all')
  }

  const closePanel = () => { setPanelOpen(false); setEditId(null); resetForm() }

  const openCreate = () => { resetForm(); setEditId(null); setPanelOpen(true) }

  const openEdit = (c: Coupon) => {
    setEditId(c.id); setCode(c.code); setType(c.type); setDescription(c.description ?? '')
    setDiscountPercent(c.discountPercent ?? ''); setDiscountAmount(c.discountAmount ?? '')
    setFreeShipping(c.freeShipping); setMinOrderAmount(c.minOrderAmount ?? '')
    setMaxUsageCount(c.maxUsageCount ?? ''); setOnePerCustomer(c.onePerCustomer)
    setStartAt(c.startAt ? c.startAt.slice(0, 16) : ''); setExpiresAt(c.expiresAt ? c.expiresAt.slice(0, 16) : '')
    if (c.appliesToCategoryId) { setAppliesTo('category'); setAppliesToCategoryId(c.appliesToCategoryId) }
    else if (c.appliesToProductId) { setAppliesTo('product'); setAppliesToProductId(c.appliesToProductId) }
    else setAppliesTo('all')
    setPanelOpen(true)
  }

  const handleSave = () => {
    saveMut.mutate({
      code, type, description: description || null,
      discountPercent: type === 'percentage' && discountPercent !== '' ? Number(discountPercent) : null,
      discountAmount: type === 'fixed_amount' && discountAmount !== '' ? Number(discountAmount) : null,
      freeShipping: type === 'free_shipping' ? true : freeShipping,
      minOrderAmount: minOrderAmount !== '' ? Number(minOrderAmount) : null,
      maxUsageCount: maxUsageCount !== '' ? Number(maxUsageCount) : null,
      onePerCustomer, startAt: startAt || null, expiresAt: expiresAt || null,
      appliesToCategoryId: appliesTo === 'category' ? appliesToCategoryId || null : null,
      appliesToProductId: appliesTo === 'product' ? appliesToProductId || null : null,
      isActive: true,
    })
  }

  const copyCode = (text: string) => navigator.clipboard.writeText(text)
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB') : '—'

  const typeLabel = (t: Coupon['type']) => t === 'percentage' ? t3('Prozent', 'Percent', 'نسبة مئوية') : t === 'fixed_amount' ? t3('Festbetrag', 'Fixed', 'مبلغ ثابت') : t3('Gratis-Versand', 'Free Shipping', 'شحن مجاني')
  const discountDisplay = (c: Coupon) => c.type === 'percentage' ? `${c.discountPercent}%` : c.type === 'fixed_amount' ? `${c.discountAmount?.toFixed(2)} EUR` : t3('Gratis', 'Free', 'مجاني')

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <AdminBreadcrumb items={[
        { label: t3('Marketing', 'Marketing', 'التسويق'), href: `/${locale}/admin/marketing/coupons` },
        { label: t3('Gutscheine', 'Coupons', 'القسائم') },
      ]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center">
            <Ticket className="h-5 w-5 text-[#d4a853]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t3('Gutscheine', 'Coupons', 'القسائم')}</h1>
        </div>
        <Button size="sm" className="rounded-xl gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={openCreate}>
          <Plus className="h-4 w-4" />{t3('Neuer Gutschein', 'New Coupon', 'قسيمة جديدة')}
        </Button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t3('Code suchen...', 'Search code...', 'بحث عن الكود...')}
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-10 rtl:pl-3 rtl:pr-10 h-10 rounded-xl" />
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-0.5">
          {(['', 'true', 'false'] as const).map((v) => (
            <button key={v} onClick={() => setActiveFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === v ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {v === '' ? t3('Alle', 'All', 'الكل') : v === 'true' ? t3('Aktiv', 'Active', 'نشط') : t3('Inaktiv', 'Inactive', 'غير نشط')}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: t3('Gesamt', 'Total', 'الإجمالي'), value: total, icon: Ticket },
          { label: t3('Aktiv', 'Active', 'نشط'), value: activeCount, icon: Check },
          { label: t3('Gesamtnutzungen', 'Total Uses', 'إجمالي الاستخدامات'), value: totalUses, icon: BarChart3 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-[#1a1a2e] rounded-2xl p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-[#d4a853]/20 flex items-center justify-center flex-shrink-0">
              <kpi.icon className="h-5 w-5 text-[#d4a853]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{kpi.value}</p>
              <p className="text-xs text-gray-400">{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Code', 'Code', 'الكود')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Typ', 'Type', 'النوع')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Rabatt', 'Discount', 'الخصم')}</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Genutzt/Max', 'Used/Max', 'مستخدم/أقصى')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Gültig bis', 'Valid Until', 'صالح حتى')}</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3('Status', 'Status', 'الحالة')}</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td colSpan={7} className="px-4 py-4">
                    <div className="h-4 bg-muted rounded-lg animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
                  </td>
                </tr>
              )) : coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <Ticket className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
                    <p className="text-muted-foreground">{t3('Keine Gutscheine gefunden', 'No coupons found', 'لم يتم العثور على قسائم')}</p>
                  </td>
                </tr>
              ) : coupons.map((c, i) => (
                <tr key={c.id} className="border-b hover:bg-muted/20 transition-colors group"
                  style={{ animationDelay: `${i * 20}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                  {/* Code */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-muted/60 px-2.5 py-1 rounded-lg tracking-wider">{c.code}</span>
                      <button onClick={() => copyCode(c.code)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t3('Kopieren', 'Copy', 'نسخ')}>
                        <Package className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {c.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{(() => {
                      // Parse multi-lang descriptions: "DE / EN / AR [email]" → show only current locale
                      const d = c.description.replace(/\[.*?\]/g, '').trim()
                      const parts = d.split(' / ')
                      if (parts.length === 3) return locale === 'ar' ? parts[2] : locale === 'en' ? parts[1] : parts[0]
                      return d
                    })()}</p>}
                  </td>
                  {/* Type */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${TYPE_BADGE[c.type]}`}>
                      {typeLabel(c.type)}
                    </span>
                  </td>
                  {/* Discount */}
                  <td className="px-4 py-3">
                    <span className="text-sm font-bold">{discountDisplay(c)}</span>
                  </td>
                  {/* Used/Max */}
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-medium">{c.usedCount}</span>
                    <span className="text-muted-foreground mx-0.5">/</span>
                    <span className="text-sm text-muted-foreground">{c.maxUsageCount ?? '\u221E'}</span>
                  </td>
                  {/* Valid Until */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      {fmtDate(c.expiresAt)}
                    </div>
                  </td>
                  {/* Status Toggle */}
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleMut.mutate(c.id)}
                      className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${c.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                        c.isActive ? 'translate-x-5 rtl:-translate-x-5 ms-0.5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-muted"
                        title={t3('Bearbeiten', 'Edit', 'تعديل')}>
                        <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => setStatsId(statsId === c.id ? null : c.id)} className="p-1.5 rounded-lg hover:bg-muted"
                        title={t3('Statistiken', 'Statistics', 'الإحصائيات')}>
                        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={async () => {
                        const ok = await confirmDialog({
                          title: t3('Gutschein löschen', 'Delete Coupon', 'حذف القسيمة'),
                          description: t3(
                            `Gutschein "${c.code}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
                            `Really delete coupon "${c.code}"? This action cannot be undone.`,
                            `هل تريد حذف القسيمة "${c.code}" حقاً؟ لا يمكن التراجع عن هذا الإجراء.`,
                          ),
                          variant: 'danger',
                          confirmLabel: t3('Löschen', 'Delete', 'حذف'),
                          cancelLabel: t3('Abbrechen', 'Cancel', 'إلغاء'),
                        })
                        if (!ok) return
                        await api.delete(`/admin/marketing/coupons/${c.id}`)
                        qc.invalidateQueries({ queryKey: ['admin-coupons'] })
                      }} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500"
                        title={t3('Löschen', 'Delete', 'حذف')}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats Drawer */}
      {statsId && stats && (
        <div className="fixed inset-y-0 end-0 w-80 bg-background border-s shadow-2xl z-50 flex flex-col"
          style={{ animation: 'slideInRight 200ms ease-out' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h3 className="font-bold text-sm">{t3('Statistiken', 'Statistics', 'الإحصائيات')}</h3>
            <button onClick={() => setStatsId(null)} className="p-1 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div className="p-5 space-y-4">
            {[
              { label: t3('Gesamtnutzungen', 'Total Uses', 'إجمالي الاستخدامات'), value: stats?.totalUses ?? 0, icon: Ticket },
              { label: t3('Generierter Umsatz', 'Revenue Generated', 'الإيرادات المحققة'), value: `${Number(stats?.totalRevenue ?? 0).toFixed(2)} EUR`, icon: Euro },
              { label: t3('Durchschn. Bestellwert', 'Avg. Order Value', 'متوسط قيمة الطلب'), value: `${Number(stats?.avgOrderValue ?? 0).toFixed(2)} EUR`, icon: BarChart3 },
            ].map((s) => (
              <div key={s.label} className="bg-[#1a1a2e] rounded-xl p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-[#d4a853]/20 flex items-center justify-center flex-shrink-0">
                  <s.icon className="h-4 w-4 text-[#d4a853]" />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">{s.value}</p>
                  <p className="text-[11px] text-gray-400">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create/Edit Slide-over Panel */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closePanel} />
          <div className="fixed inset-y-0 end-0 w-[420px] max-w-full bg-background border-s shadow-2xl z-50 flex flex-col overflow-y-auto"
            style={{ animation: 'slideInRight 250ms ease-out' }}>
            {/* Panel Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-background z-10">
              <h3 className="font-bold">
                {editId ? t3('Gutschein bearbeiten', 'Edit Coupon', 'تعديل القسيمة') : t3('Neuer Gutschein', 'New Coupon', 'قسيمة جديدة')}
              </h3>
              <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              {/* Code */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Code', 'Code', 'الكود')}</label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="SOMMER2026" className="font-mono tracking-wider uppercase" />
              </div>

              {/* Type Pills */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">{t3('Typ', 'Type', 'النوع')}</label>
                <div className="flex gap-2">
                  {([
                    { v: 'percentage' as const, label: t3('Prozent', 'Percent', 'نسبة'), icon: Percent },
                    { v: 'fixed_amount' as const, label: t3('Festbetrag', 'Fixed', 'مبلغ ثابت'), icon: Euro },
                    { v: 'free_shipping' as const, label: t3('Gratis-Versand', 'Free Ship', 'شحن مجاني'), icon: Package },
                  ]).map((opt) => (
                    <button key={opt.v} onClick={() => setType(opt.v)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                        type === opt.v ? 'bg-[#d4a853] text-white shadow-md' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      <opt.icon className="h-3.5 w-3.5" />{opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Discount Value */}
              {type === 'percentage' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Rabatt (%)', 'Discount (%)', 'الخصم (%)')}</label>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={1} max={100} value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value ? Number(e.target.value) : '')}
                      placeholder="10" className="flex-1" />
                    <span className="text-sm font-bold text-muted-foreground">%</span>
                  </div>
                </div>
              )}
              {type === 'fixed_amount' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Rabatt (EUR)', 'Discount (EUR)', 'الخصم (يورو)')}</label>
                  <div className="relative">
                    <Input type="number" min={0.01} step={0.01} value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value ? Number(e.target.value) : '')}
                      placeholder="5.00" className="pe-10" />
                    <Euro className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Beschreibung', 'Description', 'الوصف')}</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder={t3('Optionale Beschreibung', 'Optional description', 'وصف اختياري')} />
              </div>

              {/* Conditions */}
              <div className="border rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t3('Bedingungen', 'Conditions', 'الشروط')}
                </p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t3('Mindestbestellwert (EUR)', 'Min. Order Value (EUR)', 'الحد الأدنى للطلب (يورو)')}
                  </label>
                  <Input type="number" min={0} step={0.01} value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value ? Number(e.target.value) : '')} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {t3('Max. Nutzungen', 'Max. Uses', 'أقصى استخدامات')}
                  </label>
                  <Input type="number" min={1} value={maxUsageCount}
                    onChange={(e) => setMaxUsageCount(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t3('Unbegrenzt', 'Unlimited', 'غير محدود')} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <button onClick={() => setOnePerCustomer(!onePerCustomer)}
                    className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                      onePerCustomer ? 'bg-[#d4a853] border-[#d4a853]' : 'border-muted-foreground/30'
                    }`}>
                    {onePerCustomer && <Check className="h-3 w-3 text-white" />}
                  </button>
                  <span className="text-xs font-medium">{t3('Einmal pro Kunde', 'Once per customer', 'مرة واحدة لكل عميل')}</span>
                </label>
              </div>

              {/* Time Range */}
              <div className="border rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />{t3('Zeitraum', 'Time Period', 'الفترة الزمنية')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Start', 'Start', 'البداية')}</label>
                    <DateTimePicker value={startAt} onChange={setStartAt} placeholder={t3('Startdatum', 'Start date', 'تاريخ البدء')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Ablauf', 'Expires', 'الانتهاء')}</label>
                    <DateTimePicker value={expiresAt} onChange={setExpiresAt} placeholder={t3('Ablaufdatum', 'Expiry date', 'تاريخ الانتهاء')} />
                  </div>
                </div>
              </div>

              {/* Applies To */}
              <div className="border rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t3('Gilt für', 'Applies to', 'ينطبق على')}
                </p>
                <div className="flex gap-2">
                  {([
                    { v: 'all' as const, label: t3('Alle', 'All', 'الكل') },
                    { v: 'category' as const, label: t3('Kategorie', 'Category', 'الفئة') },
                    { v: 'product' as const, label: t3('Produkt', 'Product', 'المنتج') },
                  ]).map((opt) => (
                    <button key={opt.v} type="button" onClick={() => { setAppliesTo(opt.v); if (opt.v === 'all') { setAppliesToCategoryId(''); setAppliesToProductId('') } }}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        appliesTo === opt.v ? 'bg-[#d4a853] text-white shadow-sm' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {appliesTo === 'category' && (
                  <SearchableSelect
                    value={appliesToCategoryId}
                    onChange={setAppliesToCategoryId}
                    options={categoryOptions}
                    placeholder={t3('Kategorie suchen...', 'Search category...', 'بحث عن فئة...')}
                    searchPlaceholder={t3('Name eingeben...', 'Type name...', 'اكتب الاسم...')}
                    emptyLabel={t3('Alle Kategorien', 'All categories', 'جميع الفئات')}
                  />
                )}
                {appliesTo === 'product' && (
                  <SearchableSelect
                    value={appliesToProductId}
                    onChange={setAppliesToProductId}
                    options={productOptions}
                    placeholder={t3('Produkt suchen...', 'Search product...', 'بحث عن منتج...')}
                    searchPlaceholder={t3('Name oder SKU...', 'Name or SKU...', 'الاسم أو SKU...')}
                    emptyLabel={t3('Alle Produkte', 'All products', 'جميع المنتجات')}
                  />
                )}
              </div>
            </div>

            {/* Panel Footer */}
            <div className="sticky bottom-0 bg-background border-t px-5 py-4 flex items-center gap-3">
              <Button onClick={handleSave} disabled={!code || saveMut.isPending}
                className="flex-1 gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white">
                {saveMut.isPending ? (
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : <Check className="h-4 w-4" />}
                {t3('Speichern', 'Save', 'حفظ')}
              </Button>
              <Button variant="outline" onClick={closePanel} className="gap-2">
                <X className="h-4 w-4" />{t3('Abbrechen', 'Cancel', 'إلغاء')}
              </Button>
            </div>

            {saveMut.isError && (
              <div className="mx-5 mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">{(saveMut.error as Error)?.message ?? t3('Fehler beim Speichern', 'Error saving', 'خطأ في الحفظ')}</div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  )
}
