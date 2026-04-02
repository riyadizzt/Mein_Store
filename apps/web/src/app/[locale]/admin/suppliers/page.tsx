'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HandCoins, Plus, Search, MapPin, AlertTriangle, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

export default function SuppliersPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', contactPerson: '', email: '', phone: '', address: '', country: '', notes: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const params: any = { limit: 100 }
      if (search) params.search = search
      const { data } = await api.get('/admin/suppliers', { params })
      return data
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['supplier-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/suppliers/stats'); return data },
  })

  const { data: warnings } = useQuery({
    queryKey: ['supplier-warnings'],
    queryFn: async () => { const { data } = await api.get('/admin/suppliers/warnings'); return data },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editId) await api.put(`/admin/suppliers/${editId}`, form)
      else await api.post('/admin/suppliers', form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      closeForm()
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/admin/suppliers/${id}`) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['supplier-stats'] })
      setDeleteConfirm(null)
    },
  })

  const openEdit = (s: any) => {
    setEditId(s.id)
    setForm({ name: s.name ?? '', contactPerson: s.contactPerson ?? '', email: s.email ?? '', phone: s.phone ?? '', address: s.address ?? '', country: s.country ?? '', notes: s.notes ?? '' })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setForm({ name: '', contactPerson: '', email: '', phone: '', address: '', country: '', notes: '' })
  }

  const suppliers = data?.data ?? []
  const numFmt = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  const fmt = (n: number) => n.toLocaleString(numFmt, { style: 'currency', currency: 'EUR' })
  const dateFmt = (d: string) => new Date(d).toLocaleDateString(numFmt, { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t3(locale, 'Lieferanten', 'Suppliers', 'الموردون') }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HandCoins className="h-6 w-6 text-[#d4a853]" />
            {t3(locale, 'Lieferanten', 'Suppliers', 'الموردون')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t3(locale, 'Lieferanten verwalten, Wareneingänge und Zahlungen', 'Manage suppliers, deliveries and payments', 'إدارة الموردين والتوريدات والمدفوعات')}</p>
        </div>
        <Button onClick={() => { closeForm(); setShowForm(true) }} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black gap-2">
          <Plus className="h-4 w-4" />
          {t3(locale, 'Neuer Lieferant', 'New Supplier', 'مورد جديد')}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-background border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">{t3(locale, 'Lieferanten', 'Suppliers', 'الموردون')}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{stats?.supplierCount ?? 0}</p>
        </div>
        <div className="bg-background border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">{t3(locale, 'Offener Saldo', 'Open Balance', 'الرصيد المفتوح')}</p>
          <p className="text-2xl font-bold mt-1 text-red-400 tabular-nums">{fmt(stats?.totalOwed ?? 0)}</p>
        </div>
        <div className="bg-background border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">{t3(locale, 'Wareneingänge', 'Deliveries', 'التوريدات')}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{stats?.totalDeliveryCount ?? 0}</p>
        </div>
        <div className="bg-background border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">{t3(locale, 'Wartende Produkte', 'Pending Products', 'منتجات بانتظار التفعيل')}</p>
          <p className="text-2xl font-bold mt-1 text-amber-400 tabular-nums">{stats?.pendingProducts ?? 0}</p>
        </div>
      </div>

      {/* Overdue warnings */}
      {(warnings ?? []).length > 0 && (
        <div className="mb-6 space-y-2">
          {(warnings ?? []).map((w: any) => (
            <div key={w.supplierId} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${w.level === 'critical' ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
              <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${w.level === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
              <span className="text-sm">
                <span className="font-semibold">{w.supplierName}</span> — {fmt(w.balance)} {t3(locale, `seit ${w.daysSince} Tagen offen`, `open for ${w.daysSince} days`, `مفتوح منذ ${w.daysSince} يوم`)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t3(locale, 'Lieferant suchen...', 'Search supplier...', 'بحث عن مورد...')} className="w-full h-10 ltr:pl-10 rtl:pr-10 px-4 rounded-lg border bg-background text-sm" />
      </div>

      {/* Table */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Name', 'Name', 'الاسم')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Land', 'Country', 'البلد')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Kontakt', 'Contact', 'جهة الاتصال')}</th>
                <th className="text-end px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Offener Saldo', 'Balance', 'الرصيد')}</th>
                <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Lieferungen', 'Deliveries', 'التوريدات')}</th>
                <th className="text-start px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t3(locale, 'Letzte Lieferung', 'Last Delivery', 'آخر توريد')}</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3.5"><div className="h-4 bg-muted rounded-lg animate-pulse" /></td>)}</tr>
                ))
              ) : suppliers.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <HandCoins className="h-10 w-10 mx-auto mb-2 text-muted-foreground/20" />
                  <p className="text-muted-foreground">{t3(locale, 'Keine Lieferanten', 'No suppliers', 'لا يوجد موردون')}</p>
                </td></tr>
              ) : suppliers.map((s: any) => (
                <tr key={s.id} className="border-b hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3.5">
                    <Link href={`/${locale}/admin/suppliers/${s.id}`} className="font-semibold text-[13px] hover:text-[#d4a853] transition-colors">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-[13px]">
                    {s.country && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{s.country}</span>}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] text-muted-foreground">
                    {s.contactPerson && <div>{s.contactPerson}</div>}
                    {s.phone && <div className="text-xs">{s.phone}</div>}
                  </td>
                  <td className="px-4 py-3.5 text-end">
                    <span className={`font-semibold text-[13px] tabular-nums ${s.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmt(s.balance)}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-lg bg-muted/60 text-xs font-semibold px-2">{s.deliveryCount}</span>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-[13px]">
                    {s.lastDeliveryAt ? dateFmt(s.lastDeliveryAt) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title={t3(locale, 'Bearbeiten', 'Edit', 'تعديل')}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => setDeleteConfirm(s.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" title={t3(locale, 'Löschen', 'Delete', 'حذف')}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
                      </button>
                      <Link href={`/${locale}/admin/suppliers/${s.id}`} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeForm}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{editId ? t3(locale, 'Lieferant bearbeiten', 'Edit Supplier', 'تعديل المورد') : t3(locale, 'Neuer Lieferant', 'New Supplier', 'مورد جديد')}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t3(locale, 'Firmenname *', 'Company Name *', 'اسم الشركة *')}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t3(locale, 'Kontaktperson', 'Contact Person', 'جهة الاتصال')}</label>
                <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t3(locale, 'Land', 'Country', 'البلد')}</label>
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" placeholder={t3(locale, 'z.B. Türkei', 'e.g. Turkey', 'مثال: تركيا')} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t3(locale, 'Telefon', 'Phone', 'الهاتف')}</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t3(locale, 'E-Mail', 'Email', 'البريد')}</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t3(locale, 'Adresse', 'Address', 'العنوان')}</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t3(locale, 'Notizen', 'Notes', 'ملاحظات')}</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full h-20 px-3 py-2 rounded-lg border bg-background text-sm mt-1 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeForm}>{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
              <Button onClick={() => saveMut.mutate()} disabled={!form.name.trim() || saveMut.isPending} className="bg-[#d4a853] hover:bg-[#c49b4a] text-black">
                {saveMut.isPending ? '...' : editId ? t3(locale, 'Speichern', 'Save', 'حفظ') : t3(locale, 'Erstellen', 'Create', 'إنشاء')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-background border rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{t3(locale, 'Lieferant löschen?', 'Delete Supplier?', 'حذف المورد؟')}</h2>
            <p className="text-sm text-muted-foreground">{t3(locale, 'Der Lieferant wird deaktiviert. Bestehende Lieferungen und Zahlungen bleiben erhalten.', 'The supplier will be deactivated. Existing deliveries and payments are preserved.', 'سيتم تعطيل المورد. التوريدات والمدفوعات الحالية ستبقى محفوظة.')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
              <Button onClick={() => deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending} className="bg-red-500 hover:bg-red-600 text-white">
                {deleteMut.isPending ? '...' : t3(locale, 'Löschen', 'Delete', 'حذف')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
