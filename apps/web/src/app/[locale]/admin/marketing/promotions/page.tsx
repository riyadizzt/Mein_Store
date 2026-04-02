'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Megaphone, Plus, Calendar, Percent, Package, Clock,
  Zap, Tag, X, Check,
} from 'lucide-react'

type PromotionType = 'seasonal' | 'quantity_discount' | 'flash_sale'
interface Promotion {
  id: string; name: string; type: PromotionType; description: string | null
  discountPercent: number | null; discountAmount: number | null; minQuantity: number | null
  categoryId: string | null; productId: string | null
  startAt: string | null; endAt: string | null; isActive: boolean; createdAt: string
}
const TYPE_BADGE: Record<PromotionType, string> = { seasonal: 'bg-orange-100 text-orange-800', quantity_discount: 'bg-green-100 text-green-800', flash_sale: 'bg-red-100 text-red-800' }
const TYPE_COLOR: Record<PromotionType, string> = { seasonal: 'border-orange-300 bg-orange-50', quantity_discount: 'border-green-300 bg-green-50', flash_sale: 'border-red-300 bg-red-50' }

export default function AdminPromotionsPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [type, setType] = useState<PromotionType>('seasonal')
  const [description, setDescription] = useState('')
  const [discountPercent, setDiscountPercent] = useState<number | ''>('')
  const [discountAmount, setDiscountAmount] = useState<number | ''>('')
  const [minQuantity, setMinQuantity] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState('')
  const [productId, setProductId] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')

  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])

  // Load categories & products for dropdowns
  const { data: categories } = useQuery({
    queryKey: ['admin-categories-simple'],
    queryFn: async () => { const { data } = await api.get('/admin/categories'); return data?.data ?? data ?? [] },
  })
  const { data: products } = useQuery({
    queryKey: ['admin-products-simple'],
    queryFn: async () => { const { data } = await api.get('/admin/products', { params: { limit: 100 } }); return data?.data ?? data ?? [] },
  })

  const getCatName = (id: string) => {
    const cat = (categories as any[])?.find((c: any) => c.id === id)
    const t = cat?.translations?.find((t: any) => t.language === locale) ?? cat?.translations?.[0]
    return t?.name ?? id?.slice(0, 8) ?? '—'
  }
  const getProdName = (id: string) => {
    const prod = (products as any[])?.find((p: any) => p.id === id)
    const t = prod?.translations?.find((t: any) => t.language === locale) ?? prod?.translations?.[0]
    return t?.name ?? id?.slice(0, 8) ?? '—'
  }

  // Query
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-promotions', activeFilter],
    queryFn: async () => {
      const { data } = await api.get('/admin/marketing/promotions', {
        params: { isActive: activeFilter || undefined, limit: 50, offset: 0 },
      })
      return data as { data: Promotion[]; meta: { total: number } }
    },
  })

  const promotions = result?.data ?? []

  const countByType = (t: PromotionType) => promotions.filter((p) => p.type === t && p.isActive).length

  // Mutations
  const saveMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editId ? api.patch(`/admin/marketing/promotions/${editId}`, payload) : api.post('/admin/marketing/promotions', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-promotions'] }); closePanel() },
  })

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/marketing/promotions/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-promotions'] }),
  })

  // Helpers
  const resetForm = () => {
    setName(''); setType('seasonal'); setDescription(''); setDiscountPercent('')
    setDiscountAmount(''); setMinQuantity(''); setCategoryId(''); setProductId('')
    setStartAt(''); setEndAt('')
  }

  const closePanel = () => { setPanelOpen(false); setEditId(null); resetForm() }
  const openCreate = () => { resetForm(); setEditId(null); setPanelOpen(true) }

  const openEdit = (p: Promotion) => {
    setEditId(p.id); setName(p.name); setType(p.type); setDescription(p.description ?? '')
    setDiscountPercent(p.discountPercent ?? ''); setDiscountAmount(p.discountAmount ?? '')
    setMinQuantity(p.minQuantity ?? ''); setCategoryId(p.categoryId ?? '')
    setProductId(p.productId ?? '')
    setStartAt(p.startAt ? p.startAt.slice(0, 16) : ''); setEndAt(p.endAt ? p.endAt.slice(0, 16) : '')
    setPanelOpen(true)
  }

  const handleSave = () => {
    saveMut.mutate({
      name, type, description: description || null,
      discountPercent: discountPercent !== '' ? Number(discountPercent) : null,
      discountAmount: discountAmount !== '' ? Number(discountAmount) : null,
      minQuantity: type === 'quantity_discount' && minQuantity !== '' ? Number(minQuantity) : null,
      categoryId: (type === 'seasonal' || type === 'quantity_discount') && categoryId ? categoryId : null,
      productId: (type === 'flash_sale' || type === 'quantity_discount') && productId ? productId : null,
      startAt: startAt || null, endAt: endAt || null, isActive: true,
    })
  }

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB') : '—'
  const typeLabel = (t: PromotionType) => t === 'seasonal' ? t3('Saisonrabatt', 'Seasonal', 'موسمي') : t === 'quantity_discount' ? t3('Mengenrabatt', 'Quantity', 'كمية') : t3('Flash Sale', 'Flash Sale', 'تخفيض سريع')
  const typeIcon = (t: PromotionType) => t === 'seasonal' ? Calendar : t === 'quantity_discount' ? Package : Zap
  const isExpired = (p: Promotion) => p.endAt ? new Date(p.endAt).getTime() < now : false
  const discountDisplay = (p: Promotion) => p.discountPercent ? `${p.discountPercent}%` : p.discountAmount ? `${p.discountAmount.toFixed(2)} EUR` : '—'
  const countdown = (end: string) => {
    const diff = new Date(end).getTime() - now
    if (diff <= 0) return t3('Abgelaufen', 'Expired', 'انتهى')
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <AdminBreadcrumb items={[
        { label: t3('Marketing', 'Marketing', 'التسويق'), href: `/${locale}/admin/marketing/coupons` },
        { label: t3('Aktionen', 'Promotions', 'العروض') },
      ]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#d4a853]/10 flex items-center justify-center">
            <Megaphone className="h-5 w-5 text-[#d4a853]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t3('Aktionen', 'Promotions', 'العروض')}</h1>
        </div>
        <Button size="sm" className="rounded-xl gap-2 bg-[#d4a853] hover:bg-[#c49943] text-white" onClick={openCreate}>
          <Plus className="h-4 w-4" />{t3('Neue Aktion', 'New Promotion', 'عرض جديد')}
        </Button>
      </div>

      {/* Type Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {([
          { t: 'seasonal' as PromotionType, icon: Calendar, clr: 'bg-orange-500/20 text-orange-600', l: t3('Saisonrabatte', 'Seasonal', 'موسمي') },
          { t: 'quantity_discount' as PromotionType, icon: Package, clr: 'bg-green-500/20 text-green-600', l: t3('Mengenrabatte', 'Quantity', 'كمية') },
          { t: 'flash_sale' as PromotionType, icon: Zap, clr: 'bg-red-500/20 text-red-600', l: t3('Flash Sales', 'Flash Sales', 'تخفيضات سريعة') },
        ]).map((c) => (
          <div key={c.t} className="bg-[#1a1a2e] rounded-2xl p-5 flex items-center gap-4">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.clr}`}><c.icon className="h-5 w-5" /></div>
            <div><p className="text-2xl font-bold text-white">{countByType(c.t)}</p><p className="text-xs text-gray-400">{c.l}</p></div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-0.5 mb-5 w-fit">
        {(['', 'true', 'false'] as const).map((v) => (
          <button key={v} onClick={() => setActiveFilter(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeFilter === v ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}>
            {v === '' ? t3('Alle', 'All', 'الكل') : v === 'true' ? t3('Aktiv', 'Active', 'نشط') : t3('Inaktiv', 'Inactive', 'غير نشط')}
          </button>
        ))}
      </div>

      {/* Promotions Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-background border rounded-2xl p-5 animate-pulse">
              <div className="h-5 bg-muted rounded-lg w-2/3 mb-3" />
              <div className="h-4 bg-muted rounded-lg w-1/3 mb-2" />
              <div className="h-4 bg-muted rounded-lg w-1/2" />
            </div>
          ))}
        </div>
      ) : promotions.length === 0 ? (
        <div className="text-center py-16">
          <Megaphone className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-muted-foreground">{t3('Keine Aktionen gefunden', 'No promotions found', 'لم يتم العثور على عروض')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {promotions.map((p, i) => {
            const TypeIcon = typeIcon(p.type)
            const expired = isExpired(p)
            return (
              <div key={p.id} className="bg-background border rounded-2xl p-5 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openEdit(p)}
                style={{ animationDelay: `${i * 30}ms`, animation: 'fadeIn 200ms ease-out both' }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${TYPE_COLOR[p.type]}`}>
                      <TypeIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{p.name}</h3>
                      {p.description && <p className="text-[11px] text-muted-foreground line-clamp-1">{p.description}</p>}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); toggleMut.mutate(p.id) }}
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors flex-shrink-0 ${p.isActive && !expired ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                      p.isActive ? 'translate-x-5 rtl:-translate-x-5 ms-0.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${TYPE_BADGE[p.type]}`}>
                    {typeLabel(p.type)}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#d4a853]/10 text-[#d4a853] text-[11px] font-bold">
                    <Tag className="h-3 w-3" />{discountDisplay(p)}
                  </span>
                  {p.isActive && !expired && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />{t3('Aktiv', 'Active', 'نشط')}
                    </span>
                  )}
                  {p.categoryId && (
                    <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{getCatName(p.categoryId)}</span>
                  )}
                  {p.productId && (
                    <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{getProdName(p.productId)}</span>
                  )}
                  {expired && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />{t3('Abgelaufen', 'Expired', 'منتهي')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(p.startAt)} — {fmtDate(p.endAt)}</span>
                  {p.minQuantity && <span className="flex items-center gap-1"><Package className="h-3 w-3" />{t3('Min.', 'Min.', 'الحد الأدنى')} {p.minQuantity}</span>}
                </div>

                {p.type === 'flash_sale' && p.endAt && !expired && p.isActive && (
                  <div className="mt-3 flex items-center gap-2 bg-red-50 rounded-lg px-3 py-2">
                    <Clock className="h-3.5 w-3.5 text-red-500 animate-pulse" />
                    <span className="font-mono text-sm font-bold text-red-600">{countdown(p.endAt)}</span>
                    <span className="text-[11px] text-red-500">{t3('verbleibend', 'remaining', 'متبقي')}</span>
                  </div>
                )}
              </div>
            )
          })}
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
                {editId ? t3('Aktion bearbeiten', 'Edit Promotion', 'تعديل العرض') : t3('Neue Aktion', 'New Promotion', 'عرض جديد')}
              </h3>
              <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Name', 'Name', 'الاسم')}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder={t3('z.B. Winterschlussverkauf', 'e.g. Winter Sale', 'مثال: تخفيضات الشتاء')} />
              </div>

              {/* Type Selector Cards */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">{t3('Typ', 'Type', 'النوع')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: 'seasonal' as PromotionType, label: t3('Saisonrabatt', 'Seasonal', 'موسمي'), icon: Calendar, desc: t3('Kategorie %', 'Category %', '% الفئة') },
                    { v: 'quantity_discount' as PromotionType, label: t3('Mengenrabatt', 'Quantity', 'كمية'), icon: Package, desc: t3('Kauf X, Y% Rabatt', 'Buy X, Y% off', 'اشتر X واحصل Y%') },
                    { v: 'flash_sale' as PromotionType, label: t3('Flash Sale', 'Flash Sale', 'سريع'), icon: Zap, desc: t3('Zeitlich begrenzt', 'Time-limited', 'محدود الوقت') },
                  ]).map((opt) => (
                    <button key={opt.v} onClick={() => setType(opt.v)}
                      className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl text-center transition-all ${
                        type === opt.v ? 'bg-[#d4a853] text-white shadow-md' : 'bg-muted hover:bg-muted/80'
                      }`}>
                      <opt.icon className="h-4 w-4" />
                      <span className="text-[11px] font-semibold leading-tight">{opt.label}</span>
                      <span className={`text-[9px] leading-tight ${type === opt.v ? 'text-white/70' : 'text-muted-foreground'}`}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Discount */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Rabatt (%)', 'Discount (%)', 'الخصم (%)')}</label>
                  <div className="relative">
                    <Input type="number" min={1} max={100} value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value ? Number(e.target.value) : '')}
                      placeholder="20" className="pe-8" />
                    <Percent className="absolute end-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Rabatt (EUR)', 'Discount (EUR)', 'الخصم (يورو)')}</label>
                  <Input type="number" min={0.01} step={0.01} value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder="10.00" />
                </div>
              </div>

              {/* Conditions by Type */}
              <div className="border rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t3('Bedingungen', 'Conditions', 'الشروط')}
                </p>

                {(type === 'seasonal' || type === 'quantity_discount') && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Kategorie', 'Category', 'الفئة')}</label>
                    <SearchableSelect
                      value={categoryId}
                      onChange={setCategoryId}
                      placeholder={t3('Kategorie wählen', 'Select category', 'اختر الفئة')}
                      searchPlaceholder={t3('Kategorie suchen...', 'Search category...', 'بحث عن فئة...')}
                      emptyLabel={t3('Alle Kategorien', 'All Categories', 'جميع الفئات')}
                      options={((categories as any[]) ?? []).map((cat: any) => ({
                        value: cat.id,
                        label: cat.translations?.find((t: any) => t.language === locale)?.name ?? cat.translations?.[0]?.name ?? cat.id,
                      }))}
                    />
                  </div>
                )}

                {type === 'quantity_discount' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Mindestmenge', 'Min. Quantity', 'الحد الأدنى للكمية')}</label>
                    <Input type="number" min={2} value={minQuantity}
                      onChange={(e) => setMinQuantity(e.target.value ? Number(e.target.value) : '')}
                      placeholder="3" />
                    <p className="text-[10px] text-muted-foreground mt-1">{t3('z.B. "Kaufe 3, bekomme 10% Rabatt"', 'e.g. "Buy 3, get 10% off"', 'مثال: "اشتر 3 واحصل على 10% خصم"')}</p>
                  </div>
                )}

                {(type === 'flash_sale' || type === 'quantity_discount') && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Produkt', 'Product', 'المنتج')}</label>
                    <SearchableSelect
                      value={productId}
                      onChange={setProductId}
                      placeholder={t3('Produkt suchen...', 'Search product...', 'بحث عن منتج...')}
                      searchPlaceholder={t3('Name oder SKU...', 'Name or SKU...', 'الاسم أو SKU...')}
                      emptyLabel={t3('Alle Produkte', 'All Products', 'جميع المنتجات')}
                      options={((products as any[]) ?? []).map((p: any) => ({
                        value: p.id,
                        label: p.translations?.find((t: any) => t.language === locale)?.name ?? p.translations?.[0]?.name ?? 'Product',
                        sublabel: p.variants?.[0]?.sku ?? p.slug ?? '',
                      }))}
                    />
                  </div>
                )}
              </div>

              {/* Period */}
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
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Ende', 'End', 'النهاية')}</label>
                    <DateTimePicker value={endAt} onChange={setEndAt} placeholder={t3('Enddatum', 'End date', 'تاريخ الانتهاء')} />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t3('Beschreibung', 'Description', 'الوصف')}</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder={t3('Optionale Beschreibung', 'Optional description', 'وصف اختياري')} />
              </div>
            </div>

            {/* Panel Footer */}
            <div className="sticky bottom-0 bg-background border-t px-5 py-4 flex items-center gap-3">
              <Button onClick={handleSave} disabled={!name || saveMut.isPending}
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
              <div className="mx-5 mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
                {(saveMut.error as Error)?.message ?? t3('Fehler beim Speichern', 'Error saving', 'خطأ في الحفظ')}
              </div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  )
}
