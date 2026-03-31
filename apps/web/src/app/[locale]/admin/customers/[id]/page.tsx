'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Mail, Phone, Globe, Calendar, Clock, ShoppingBag,
  MapPin, Heart, StickyNote, ShieldAlert, ShieldCheck, Send,
  Trash2, Lock, Unlock, X, TrendingUp, Package, Edit3,
  ChevronRight, Tag, Download, AlertTriangle, ShoppingCart,
  History, CheckCircle, XCircle, MailOpen, User, LogIn,
  RefreshCw, Plus,
} from 'lucide-react'
import { api } from '@/lib/api'
import { getProductName, formatCurrency, formatDate as fmtDateUtil, formatDateTime as fmtDtUtil } from '@/lib/locale-utils'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800', pending_payment: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800', processing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-purple-100 text-purple-800', delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600', refunded: 'bg-orange-100 text-orange-800',
  disputed: 'bg-red-100 text-red-800',
}
const TAG_COLORS: Record<string, string> = {
  VIP: 'bg-amber-100 text-amber-800 border-amber-200',
  Stammkunde: 'bg-blue-100 text-blue-800 border-blue-200',
  Problem: 'bg-red-100 text-red-800 border-red-200',
  Newsletter: 'bg-green-100 text-green-800 border-green-200',
  Großhandel: 'bg-purple-100 text-purple-800 border-purple-200',
}
const AVAILABLE_TAGS = ['VIP', 'Stammkunde', 'Problem', 'Newsletter', 'Großhandel']
const LANG_LABELS: Record<string, string> = { de: 'Deutsch', en: 'English', ar: 'العربية' }
const ACTIVITY_ICONS: Record<string, any> = {
  registered: User, order_placed: ShoppingBag, order_cancelled: XCircle,
  return_requested: RefreshCw, login: LogIn, blocked: Lock, unblocked: Unlock,
  email_sent: Mail, data_exported: Download, tag_changed: Tag,
  address_added: MapPin, wishlist_added: Heart,
}

type TabKey = 'orders' | 'addresses' | 'wishlist' | 'activity' | 'notes' | 'emails' | 'cart'

export default function CustomerDetailPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const params = useParams()
  const cid = params.id as string
  const qc = useQueryClient()
  const confirmDialog = useConfirm()

  const [activeTab, setActiveTab] = useState<TabKey>('orders')
  const [noteText, setNoteText] = useState('')
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editData, setEditData] = useState({ firstName: '', lastName: '', phone: '', preferredLang: 'de' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showTagPicker, setShowTagPicker] = useState(false)

  // Fetch customer
  const { data: customer, isLoading } = useQuery({
    queryKey: ['admin-customer', cid],
    queryFn: async () => { const { data } = await api.get(`/admin/customers/${cid}`); return data },
    enabled: !!cid,
  })

  // Activity timeline
  const { data: activities } = useQuery({
    queryKey: ['admin-customer-activity', cid],
    queryFn: async () => { const { data } = await api.get(`/admin/customers/${cid}/activity`); return data },
    enabled: activeTab === 'activity',
  })

  // Email history
  const { data: emails } = useQuery({
    queryKey: ['admin-customer-emails', cid],
    queryFn: async () => { const { data } = await api.get(`/admin/customers/${cid}/emails`); return data },
    enabled: activeTab === 'emails',
  })

  // Abandoned carts
  const { data: carts } = useQuery({
    queryKey: ['admin-customer-cart', cid],
    queryFn: async () => { const { data } = await api.get(`/admin/customers/${cid}/cart`); return data },
    enabled: activeTab === 'cart',
  })

  // Mutations
  const addNoteMut = useMutation({
    mutationFn: async (content: string) => { await api.post(`/admin/customers/${cid}/notes`, { content }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }); setNoteText('') },
  })
  const deleteNoteMut = useMutation({
    mutationFn: async (noteId: string) => { await api.delete(`/admin/customers/${cid}/notes/${noteId}`) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }) },
  })
  const blockMut = useMutation({
    mutationFn: async () => { await api.post(`/admin/customers/${cid}/block`, { reason: blockReason }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }); setShowBlockModal(false); setBlockReason('') },
  })
  const unblockMut = useMutation({
    mutationFn: async () => { await api.post(`/admin/customers/${cid}/unblock`) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }) },
  })
  const sendEmailMut = useMutation({
    mutationFn: async () => { await api.post(`/admin/customers/${cid}/email`, { subject: emailSubject, body: emailBody }) },
    onSuccess: () => { setShowEmailModal(false); setEmailSubject(''); setEmailBody(''); qc.invalidateQueries({ queryKey: ['admin-customer-emails', cid] }) },
  })
  const updateMut = useMutation({
    mutationFn: async () => { await api.patch(`/admin/customers/${cid}`, editData) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }); setShowEditModal(false) },
  })
  const setTagsMut = useMutation({
    mutationFn: async (tags: string[]) => { await api.post(`/admin/customers/${cid}/tags`, { tags }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer', cid] }); setShowTagPicker(false) },
  })
  const deleteMut = useMutation({
    mutationFn: async () => { await api.delete(`/admin/customers/${cid}`) },
    onSuccess: () => { router.push(`/${locale}/admin/customers`) },
  })
  const sendReminderMut = useMutation({
    mutationFn: async (cartId: string) => { await api.post(`/admin/customers/${cid}/cart/${cartId}/reminder`) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-customer-cart', cid] }) },
  })

  const fmtCur = (n: number) => formatCurrency(n, locale)
  const fmtDate = (d: string) => fmtDateUtil(d, locale)
  const fmtDt = (d: string) => fmtDtUtil(d, locale)
  const getName = (ts: any[]) => getProductName(ts, locale)

  const handleExportData = async () => {
    const { data } = await api.get(`/admin/customers/${cid}/export`)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `customer-${cid}.json`; a.click(); URL.revokeObjectURL(url)
  }

  if (isLoading) return (
    <div><AdminBreadcrumb items={[{ label: t('users.title'), href: `/${locale}/admin/customers` }, { label: '...' }]} />
      <div className="space-y-6 mt-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-background border rounded-2xl p-6"><div className="h-6 w-48 bg-muted rounded-lg animate-pulse mb-4" /><div className="space-y-3"><div className="h-4 w-full bg-muted rounded animate-pulse" /><div className="h-4 w-3/4 bg-muted rounded animate-pulse" /></div></div>)}</div>
    </div>)
  if (!customer) return null

  const tabs: { key: TabKey; label: string; icon: any; count?: number }[] = [
    { key: 'orders', label: t('users.orderHistory'), icon: ShoppingBag, count: customer.stats?.ordersCount },
    { key: 'addresses', label: t('users.addresses'), icon: MapPin, count: customer.addresses?.length },
    { key: 'wishlist', label: t('users.wishlist'), icon: Heart, count: customer.stats?.wishlistCount },
    { key: 'activity', label: t('users.activity'), icon: History },
    { key: 'notes', label: t('users.notes'), icon: StickyNote, count: customer.notes?.length },
    { key: 'emails', label: t('users.emailHistory'), icon: MailOpen },
    { key: 'cart', label: t('users.cart'), icon: ShoppingCart },
  ]

  const customerTags: string[] = customer.tags ?? []

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('users.title'), href: `/${locale}/admin/customers` }, { label: `${customer.firstName} ${customer.lastName}` }]} />
      <button onClick={() => router.push(`/${locale}/admin/customers`)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:ltr:-translate-x-1 group-hover:rtl:translate-x-1" />{t('users.back')}
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ─ Left Column ─ */}
        <div className="xl:col-span-1 space-y-6">
          {/* Profile */}
          <div className="bg-background border rounded-2xl overflow-hidden" style={{ animation: 'fadeSlideUp 500ms ease-out' }}>
            <div className="bg-gradient-to-br from-[#1a1a2e] to-[#2d2d5e] px-6 py-8 text-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #d4a853 0%, transparent 50%)' }} />
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-white/10 border-2 border-[#d4a853]/50 flex items-center justify-center mx-auto mb-4"><span className="text-2xl font-bold text-white">{customer.firstName?.[0]}{customer.lastName?.[0]}</span></div>
                <h2 className="text-lg font-bold text-white">{customer.firstName} {customer.lastName}</h2>
                {/* Tags */}
                <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
                  {customerTags.map((tag) => (
                    <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TAG_COLORS[tag] ?? 'bg-white/10 text-white border-white/20'}`}>{tag}</span>
                  ))}
                  <button onClick={() => setShowTagPicker(true)} className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-dashed border-white/30 text-white/50 hover:text-white hover:border-white/60 transition-colors">
                    <Plus className="h-3 w-3 inline" /> {t('users.addTag')}
                  </button>
                </div>
                {/* Badges */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  {customer.isGuest ? <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300">{t('users.guest')}</span>
                    : <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300">{t('users.filterRegistered')}</span>}
                  {customer.isBlocked
                    ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300"><ShieldAlert className="h-3 w-3" />{t('users.blocked')}</span>
                    : customer.lockedUntil && new Date(customer.lockedUntil) > new Date()
                      ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/20 text-orange-300"><ShieldAlert className="h-3 w-3" />{locale === 'ar' ? 'مقفل مؤقتاً' : 'Login gesperrt'}</span>
                      : <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-300"><ShieldCheck className="h-3 w-3" />{t('users.activeStatus')}</span>}
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <InfoRow icon={Mail} label={t('users.email')} value={customer.email} />
              {customer.phone && <InfoRow icon={Phone} label={t('users.phone')} value={customer.phone} />}
              <InfoRow icon={Globe} label={t('users.language')} value={LANG_LABELS[customer.preferredLang] ?? customer.preferredLang} />
              <InfoRow icon={Calendar} label={t('users.memberSince')} value={fmtDate(customer.createdAt)} />
              {customer.lastActivity && <InfoRow icon={Clock} label={t('users.lastActivity')} value={fmtDt(customer.lastActivity)} />}
            </div>
            <div className="px-6 pb-6 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="justify-center gap-2 rounded-xl h-9 text-xs" onClick={() => { setEditData({ firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone ?? '', preferredLang: customer.preferredLang }); setShowEditModal(true) }}>
                  <Edit3 className="h-3.5 w-3.5" />{t('users.editCustomer')}
                </Button>
                <Button variant="outline" className="justify-center gap-2 rounded-xl h-9 text-xs" onClick={() => setShowEmailModal(true)}>
                  <Send className="h-3.5 w-3.5" />{t('users.sendEmail')}
                </Button>
              </div>
              {customer.isBlocked || customer.lockedUntil ? (
                <Button variant="outline" className="w-full justify-center gap-2 rounded-xl h-9 text-xs border-green-200 text-green-700 hover:bg-green-50" onClick={() => unblockMut.mutate()} disabled={unblockMut.isPending}>
                  <Unlock className="h-3.5 w-3.5" />
                  {customer.isBlocked ? t('users.unblockCustomer') : (locale === 'ar' ? 'إلغاء قفل تسجيل الدخول' : 'Login-Sperre aufheben')}
                </Button>
              ) : (
                <Button variant="outline" className="w-full justify-center gap-2 rounded-xl h-9 text-xs border-red-200 text-red-700 hover:bg-red-50" onClick={() => setShowBlockModal(true)}>
                  <Lock className="h-3.5 w-3.5" />{t('users.blockCustomer')}
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" className="justify-center gap-2 rounded-xl h-9 text-xs" onClick={handleExportData}>
                  <Download className="h-3.5 w-3.5" />{t('users.exportData')}
                </Button>
                <Button variant="outline" className="justify-center gap-2 rounded-xl h-9 text-xs border-red-200 text-red-600 hover:bg-red-50" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" />{t('users.deleteCustomer')}
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="bg-background border rounded-2xl p-6" style={{ animation: 'fadeSlideUp 500ms ease-out 100ms both' }}>
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-[#d4a853]" />{t('users.statistics')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatBox label={t('users.revenue')} value={fmtCur(customer.stats?.totalRevenue ?? 0)} highlight />
              <StatBox label={t('users.avgOrder')} value={fmtCur(customer.stats?.avgOrderValue ?? 0)} />
              <StatBox label={t('users.orders')} value={String(customer.stats?.ordersCount ?? 0)} />
              <StatBox label={t('users.wishlist')} value={String(customer.stats?.wishlistCount ?? 0)} />
            </div>
          </div>
        </div>

        {/* ─ Right Column ─ */}
        <div className="xl:col-span-2" style={{ animation: 'fadeSlideUp 500ms ease-out 200ms both' }}>
          {/* Tab Nav */}
          <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-2xl mb-6 overflow-x-auto">
            {tabs.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <tab.icon className="h-3.5 w-3.5" />{tab.label}
                {(tab.count ?? 0) > 0 && <span className={`h-5 min-w-[20px] rounded-full text-[10px] font-bold flex items-center justify-center px-1.5 ${activeTab === tab.key ? 'bg-[#1a1a2e] text-white' : 'bg-muted text-muted-foreground'}`}>{tab.count}</span>}
              </button>
            ))}
          </div>

          <div className="bg-background border rounded-2xl overflow-hidden">
            {/* ── Orders ── */}
            {activeTab === 'orders' && (<div>{(customer.orders?.length ?? 0) === 0 ? <Empty icon={ShoppingBag} text={t('users.noOrders')} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30">
              <th className="text-start px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.orderNumber')}</th>
              <th className="text-start px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.date')}</th>
              <th className="text-center px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.status')}</th>
              <th className="text-center px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.items')}</th>
              <th className="text-end px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.amount')}</th>
              <th className="text-center px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.channel')}</th>
              <th className="px-5 py-3"></th>
            </tr></thead><tbody>{customer.orders.map((o: any, i: number) => (
              <tr key={o.id} className="border-b hover:bg-muted/20 transition-colors group" style={{ animationDelay: `${i * 25}ms`, animation: 'fadeIn 250ms ease-out both' }}>
                <td className="px-5 py-3 font-mono text-xs font-semibold">{o.orderNumber}</td>
                <td className="px-5 py-3 text-muted-foreground text-[13px]">{fmtDate(o.createdAt)}</td>
                <td className="px-5 py-3 text-center"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_COLORS[o.status] ?? 'bg-gray-100'}`}>{o.status}</span></td>
                <td className="px-5 py-3 text-center text-muted-foreground">{o.itemsCount}</td>
                <td className="px-5 py-3 text-end font-semibold text-[13px]">{fmtCur(o.totalAmount)}</td>
                <td className="px-5 py-3 text-center"><span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted uppercase">{o.channel}</span></td>
                <td className="px-5 py-3"><Link href={`/${locale}/admin/orders/${o.id}`} className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-all"><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Link></td>
              </tr>))}</tbody></table></div>}</div>)}

            {/* ── Addresses ── */}
            {activeTab === 'addresses' && (<div className="p-6">{(customer.addresses?.length ?? 0) === 0 ? <Empty icon={MapPin} text={t('users.noAddresses')} /> :
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{customer.addresses.map((a: any, i: number) => (
                <div key={a.id} className="border rounded-xl p-5 hover:border-primary/30 transition-all" style={{ animationDelay: `${i * 50}ms`, animation: 'fadeSlideUp 300ms ease-out both' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#d4a853]" /><span className="font-semibold text-sm">{a.label ?? `${a.firstName} ${a.lastName}`}</span></div>
                    <div className="flex gap-1">
                      {a.isDefaultShipping && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">{t('users.defaultShipping')}</span>}
                      {a.isDefaultBilling && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">{t('users.defaultBilling')}</span>}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    <div>{a.firstName} {a.lastName}</div>{a.company && <div>{a.company}</div>}
                    <div>{a.street} {a.houseNumber}</div>{a.addressLine2 && <div>{a.addressLine2}</div>}
                    <div>{a.postalCode} {a.city}</div><div>{a.country}</div>
                  </div>
                </div>))}</div>}</div>)}

            {/* ── Wishlist ── */}
            {activeTab === 'wishlist' && (<div className="p-6">{(customer.wishlist?.length ?? 0) === 0 ? <Empty icon={Heart} text={t('users.noWishlist')} /> :
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{customer.wishlist.map((item: any, i: number) => (
                <div key={item.id} className="border rounded-xl overflow-hidden hover:border-primary/30 hover:shadow-md transition-all group" style={{ animationDelay: `${i * 40}ms`, animation: 'fadeSlideUp 300ms ease-out both' }}>
                  <div className="aspect-square bg-muted/30 relative overflow-hidden">
                    {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      : <div className="w-full h-full flex items-center justify-center"><Package className="h-10 w-10 text-muted-foreground/20" /></div>}
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-semibold line-clamp-1">{getName(item.translations)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {item.salePrice ? <><span className="text-sm font-bold text-red-600">{fmtCur(item.salePrice)}</span><span className="text-xs text-muted-foreground line-through">{fmtCur(item.basePrice)}</span></>
                        : <span className="text-sm font-bold">{fmtCur(item.basePrice)}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-2">{fmtDate(item.addedAt)}</div>
                  </div>
                </div>))}</div>}</div>)}

            {/* ── Activity Timeline ── */}
            {activeTab === 'activity' && (<div className="p-6">{(!activities || activities.length === 0) ? <Empty icon={History} text={t('users.noActivity')} /> :
              <div className="relative">
                <div className="absolute top-0 bottom-0 ltr:left-5 rtl:right-5 w-px bg-muted-foreground/10" />
                <div className="space-y-0">{(activities as any[]).map((a, i: number) => {
                  const Icon = ACTIVITY_ICONS[a.type] ?? History
                  const actKey = `act${a.type.charAt(0).toUpperCase() + a.type.slice(1).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())}` as any
                  const label = (() => { try { return t(`users.${actKey}`) } catch { return a.type } })()
                  return (
                    <div key={a.id ?? i} className="flex items-start gap-4 py-3 relative" style={{ animationDelay: `${i * 30}ms`, animation: 'fadeIn 250ms ease-out both' }}>
                      <div className="h-10 w-10 rounded-full bg-background border-2 border-muted flex items-center justify-center flex-shrink-0 z-10">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="text-sm font-medium">{label}</div>
                        {a.metadata?.orderNumber && <div className="text-xs text-muted-foreground mt-0.5">#{a.metadata.orderNumber} {a.metadata.amount ? `· ${fmtCur(a.metadata.amount)}` : ''}</div>}
                        {a.metadata?.reason && <div className="text-xs text-muted-foreground mt-0.5">{a.metadata.reason}</div>}
                        {a.metadata?.subject && <div className="text-xs text-muted-foreground mt-0.5">{a.metadata.subject}</div>}
                        <div className="text-[10px] text-muted-foreground/60 mt-1">{fmtDt(a.createdAt)}</div>
                      </div>
                    </div>)
                })}</div>
              </div>}</div>)}

            {/* ── Notes ── */}
            {activeTab === 'notes' && (<div className="p-6">
              <div className="mb-6">
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t('users.notePlaceholder')} rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-muted-foreground/20 bg-transparent text-sm resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all" />
                <div className="flex justify-end mt-2">
                  <Button size="sm" className="rounded-xl gap-2" disabled={!noteText.trim() || addNoteMut.isPending} onClick={() => addNoteMut.mutate(noteText)}>
                    <StickyNote className="h-3.5 w-3.5" />{t('users.addNote')}
                  </Button>
                </div>
              </div>
              {(customer.notes?.length ?? 0) === 0 ? <Empty icon={StickyNote} text={t('users.noNotes')} /> :
                <div className="space-y-3">{customer.notes.map((n: any, i: number) => (
                  <div key={n.id} className="border rounded-xl p-4 group hover:border-primary/20 transition-all" style={{ animationDelay: `${i * 30}ms`, animation: 'fadeSlideUp 250ms ease-out both' }}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1"><p className="text-sm leading-relaxed whitespace-pre-wrap">{n.content}</p>
                        <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground"><span className="font-medium">{n.adminName}</span><span>&middot;</span><span>{fmtDt(n.createdAt)}</span></div>
                      </div>
                      <button onClick={async () => { const ok = await confirmDialog({ title: t('users.deleteNote'), description: t('users.deleteNoteConfirm'), variant: 'default', confirmLabel: t('categories.delete'), cancelLabel: t('categories.cancel') }); if (ok) deleteNoteMut.mutate(n.id) }} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>))}</div>}
            </div>)}

            {/* ── Email History ── */}
            {activeTab === 'emails' && (<div>{(!emails || emails.length === 0) ? <div className="p-6"><Empty icon={MailOpen} text={t('users.noEmails')} /></div> :
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30">
                <th className="text-start px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.emailSubject')}</th>
                <th className="text-start px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.date')}</th>
                <th className="text-center px-5 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t('users.emailStatus')}</th>
              </tr></thead><tbody>{(emails as any[]).map((e, i: number) => {
                const sc: Record<string, string> = { queued: 'bg-yellow-100 text-yellow-800', sent: 'bg-blue-100 text-blue-800', delivered: 'bg-green-100 text-green-800', failed: 'bg-red-100 text-red-800' }
                return (<tr key={e.id} className="border-b hover:bg-muted/20 transition-colors" style={{ animationDelay: `${i * 25}ms`, animation: 'fadeIn 250ms ease-out both' }}>
                  <td className="px-5 py-3"><div className="font-medium text-[13px]">{e.subject}</div>{e.template && <div className="text-[10px] text-muted-foreground mt-0.5">{e.template}</div>}</td>
                  <td className="px-5 py-3 text-muted-foreground text-[13px]">{fmtDt(e.createdAt)}</td>
                  <td className="px-5 py-3 text-center"><span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${sc[e.status] ?? 'bg-gray-100'}`}>{e.status}</span></td>
                </tr>)})}</tbody></table></div>}</div>)}

            {/* ── Cart / Abandoned Carts ── */}
            {activeTab === 'cart' && (<div className="p-6">{(!carts || carts.length === 0) ? <Empty icon={ShoppingCart} text={t('users.noCart')} /> :
              <div className="space-y-4">{(carts as any[]).map((cart, i: number) => {
                const items = (cart.items ?? []) as any[]
                return (<div key={cart.id} className="border rounded-xl p-5 hover:border-primary/20 transition-all" style={{ animationDelay: `${i * 50}ms`, animation: 'fadeSlideUp 300ms ease-out both' }}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-sm font-semibold flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-[#d4a853]" />{t('users.abandonedCart')}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{t('users.cartDate')}: {fmtDt(cart.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{fmtCur(Number(cart.totalAmount))}</span>
                      {cart.reminderSentAt ? <span className="text-[10px] text-green-600 font-medium">{t('users.reminderSent')}</span>
                        : <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg gap-1" onClick={() => sendReminderMut.mutate(cart.id)} disabled={sendReminderMut.isPending}>
                            <Mail className="h-3 w-3" />{t('users.sendReminder')}
                          </Button>}
                    </div>
                  </div>
                  <div className="space-y-2">{items.map((item: any, j: number) => (
                    <div key={j} className="flex items-center gap-3 text-sm">
                      <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0"><Package className="h-4 w-4 text-muted-foreground/30" /></div>
                      <div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{item.name ?? item.sku}</div>
                        <div className="text-[11px] text-muted-foreground">{item.color} / {item.size} &times; {item.quantity}</div>
                      </div>
                      <div className="text-[13px] font-semibold">{fmtCur(item.price * item.quantity)}</div>
                    </div>))}</div>
                </div>)})}
              </div>}</div>)}
          </div>
        </div>
      </div>

      {/* ── Block Modal ── */}
      {showBlockModal && <Modal onClose={() => setShowBlockModal(false)}>
        <div className="text-center mb-6"><div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><Lock className="h-6 w-6 text-red-600" /></div><h3 className="text-lg font-bold">{t('users.blockCustomer')}</h3></div>
        <div className="space-y-4">
          <div><label className="text-sm font-medium mb-1.5 block">{t('users.blockReason')}</label>
            <textarea value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder={t('users.blockReasonPlaceholder')} rows={3} className="w-full px-4 py-3 rounded-xl border bg-transparent text-sm resize-none focus:outline-none focus:border-red-500" /></div>
          <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowBlockModal(false)}>{t('inventory.cancel')}</Button>
            <Button className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white" disabled={!blockReason.trim() || blockMut.isPending} onClick={() => blockMut.mutate()}><Lock className="h-4 w-4 mr-2 rtl:ml-2 rtl:mr-0" />{t('users.blockCustomer')}</Button></div>
        </div>
      </Modal>}

      {/* ── Email Modal ── */}
      {showEmailModal && <Modal onClose={() => setShowEmailModal(false)}>
        <div className="text-center mb-6"><div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4"><Send className="h-6 w-6 text-blue-600" /></div><h3 className="text-lg font-bold">{t('users.sendEmail')}</h3><p className="text-sm text-muted-foreground mt-1">{customer.email}</p></div>
        <div className="space-y-4">
          <div><label className="text-sm font-medium mb-1.5 block">{t('users.emailSubject')}</label><Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder={t('users.emailSubjectPlaceholder')} className="rounded-xl" /></div>
          <div><label className="text-sm font-medium mb-1.5 block">{t('users.emailBody')}</label>
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={t('users.emailBodyPlaceholder')} rows={5} className="w-full px-4 py-3 rounded-xl border bg-transparent text-sm resize-none focus:outline-none focus:border-primary" /></div>
          <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowEmailModal(false)}>{t('inventory.cancel')}</Button>
            <Button className="flex-1 rounded-xl" disabled={!emailSubject.trim() || !emailBody.trim() || sendEmailMut.isPending} onClick={() => sendEmailMut.mutate()}>{sendEmailMut.isPending ? t('users.emailSending') : t('users.sendEmail')}</Button></div>
        </div>
      </Modal>}

      {/* ── Edit Modal ── */}
      {showEditModal && <Modal onClose={() => setShowEditModal(false)}>
        <h3 className="text-lg font-bold mb-4">{t('users.editCustomer')}</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium mb-1 block">{t('users.firstName')}</label><Input value={editData.firstName} onChange={(e) => setEditData({ ...editData, firstName: e.target.value })} className="rounded-xl" /></div>
            <div><label className="text-xs font-medium mb-1 block">{t('users.lastName')}</label><Input value={editData.lastName} onChange={(e) => setEditData({ ...editData, lastName: e.target.value })} className="rounded-xl" /></div>
          </div>
          <div><label className="text-xs font-medium mb-1 block">{t('users.phone')}</label><Input value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} className="rounded-xl" /></div>
          <div><label className="text-xs font-medium mb-1 block">{t('users.language')}</label>
            <select value={editData.preferredLang} onChange={(e) => setEditData({ ...editData, preferredLang: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-background text-sm">
              <option value="de">Deutsch</option><option value="en">English</option><option value="ar">العربية</option>
            </select></div>
          <div className="flex gap-3 pt-2"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowEditModal(false)}>{t('inventory.cancel')}</Button>
            <Button className="flex-1 rounded-xl" disabled={updateMut.isPending} onClick={() => updateMut.mutate()}>{t('users.saveChanges')}</Button></div>
        </div>
      </Modal>}

      {/* ── Tag Picker Modal ── */}
      {showTagPicker && <Modal onClose={() => setShowTagPicker(false)}>
        <h3 className="text-lg font-bold mb-4">{t('users.tags')}</h3>
        <div className="flex flex-wrap gap-2 mb-6">{AVAILABLE_TAGS.map((tag) => {
          const active = customerTags.includes(tag)
          return (<button key={tag} onClick={() => { const next = active ? customerTags.filter((t) => t !== tag) : [...customerTags, tag]; setTagsMut.mutate(next) }}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${active ? TAG_COLORS[tag] ?? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'}`}>
            {active && <CheckCircle className="h-3.5 w-3.5 inline mr-1.5 rtl:ml-1.5 rtl:mr-0" />}{tag}
          </button>)
        })}</div>
      </Modal>}

      {/* ── Delete Confirm Modal ── */}
      {showDeleteConfirm && <Modal onClose={() => setShowDeleteConfirm(false)}>
        <div className="text-center mb-6"><div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"><AlertTriangle className="h-6 w-6 text-red-600" /></div>
          <h3 className="text-lg font-bold">{t('users.deleteCustomer')}</h3><p className="text-sm text-muted-foreground mt-2 leading-relaxed">{t('users.deleteConfirm')}</p></div>
        <div className="flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowDeleteConfirm(false)}>{t('inventory.cancel')}</Button>
          <Button className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}><Trash2 className="h-4 w-4 mr-2 rtl:ml-2 rtl:mr-0" />{t('users.deleteCustomer')}</Button></div>
      </Modal>}

      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (<div className="flex items-center gap-3"><div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0"><Icon className="h-4 w-4 text-muted-foreground" /></div>
    <div className="min-w-0"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-sm font-medium truncate">{value}</div></div></div>)
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (<div className={`rounded-xl p-4 text-center ${highlight ? 'bg-[#d4a853]/10 border border-[#d4a853]/20' : 'bg-muted/30'}`}>
    <div className={`text-lg font-bold ${highlight ? 'text-[#d4a853]' : ''}`}>{value}</div><div className="text-[11px] text-muted-foreground mt-0.5">{label}</div></div>)
}

function Empty({ icon: Icon, text }: { icon: any; text: string }) {
  return (<div className="py-16 text-center"><Icon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-sm text-muted-foreground">{text}</p></div>)
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'fadeIn 200ms ease-out' }} />
    <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" style={{ animation: 'fadeSlideUp 300ms ease-out' }}>
      <button onClick={onClose} className="absolute top-4 right-4 rtl:right-auto rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
      {children}
    </div>
  </div>)
}
