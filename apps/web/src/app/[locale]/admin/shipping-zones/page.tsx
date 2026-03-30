'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { MapPin, Plus, Trash2, X, Check, Loader2, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

export default function ShippingZonesPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: zones, isLoading } = useQuery({
    queryKey: ['admin-shipping-zones'],
    queryFn: async () => { const { data } = await api.get('/admin/shipping-zones'); return data },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/admin/shipping-zones/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-shipping-zones'] }); setEditingId(null) },
  })

  const createMut = useMutation({
    mutationFn: (data: any) => api.post('/admin/shipping-zones', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-shipping-zones'] }); setShowNewModal(false) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/shipping-zones/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-shipping-zones'] }); setConfirmDeleteId(null) },
  })

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('shippingZones.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="h-6 w-6" />{t('shippingZones.title')}
        </h1>
        <Button size="sm" className="gap-1.5 rounded-xl" onClick={() => setShowNewModal(true)}>
          <Plus className="h-3.5 w-3.5" />{t('shippingZones.newZone')}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 animate-pulse bg-muted rounded-2xl" />)
        ) : (zones ?? []).map((zone: any) => (
          editingId === zone.id ? (
            <InlineEditCard
              key={zone.id}
              zone={zone}
              locale={locale}
              t={t}
              isPending={updateMut.isPending}
              onSave={(data) => updateMut.mutate({ id: zone.id, data })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={zone.id}
              className="bg-background border rounded-2xl p-5 hover:border-primary/30 hover:shadow-md transition-all group relative cursor-pointer"
              onClick={() => setEditingId(zone.id)}
            >
              {/* Edit hint */}
              <div className="absolute top-3 ltr:right-3 rtl:left-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </div>

              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{zone.zoneName}</h3>
                <button
                  onClick={(e) => { e.stopPropagation(); updateMut.mutate({ id: zone.id, data: { isActive: !zone.isActive } }) }}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 ${zone.isActive ? 'bg-green-100 text-green-700 hover:ring-green-300' : 'bg-gray-100 text-gray-600 hover:ring-gray-300'}`}
                >
                  {zone.isActive ? t('shippingZones.active') : t('shippingZones.inactive')}
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('shippingZones.countries')}</span>
                  <span className="font-medium">{(zone.countryCodes ?? []).join(', ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('shippingZones.basePrice')}</span>
                  <span className="font-semibold">{formatCurrency(Number(zone.basePrice), locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('shippingZones.freeFrom')}</span>
                  <span>{zone.freeShippingThreshold ? formatCurrency(Number(zone.freeShippingThreshold), locale) : '—'}</span>
                </div>
              </div>

              {/* Delete */}
              <div className="mt-4 pt-3 border-t opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDeleteId === zone.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 flex-1">{locale === 'ar' ? 'حذف هذه المنطقة؟' : 'Wirklich löschen?'}</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteMut.mutate(zone.id) }} className="px-2 py-1 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors">
                      {deleteMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : (locale === 'ar' ? 'نعم' : 'Ja')}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">
                      {locale === 'ar' ? 'إلغاء' : 'Nein'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(zone.id) }}
                    className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />{locale === 'ar' ? 'حذف' : 'Löschen'}
                  </button>
                )}
              </div>
            </div>
          )
        ))}
      </div>

      {/* ── New Zone Modal ── */}
      {showNewModal && (
        <NewZoneModal
          locale={locale}
          t={t}
          isPending={createMut.isPending}
          onSave={(data) => createMut.mutate(data)}
          onClose={() => setShowNewModal(false)}
        />
      )}
    </div>
  )
}

// ── Inline Edit Card ────────────────────────────────────────
function InlineEditCard({ zone, locale, t, isPending, onSave, onCancel }: {
  zone: any; locale: string; t: any; isPending: boolean
  onSave: (data: any) => void; onCancel: () => void
}) {
  const [name, setName] = useState(zone.zoneName)
  const [countries, setCountries] = useState((zone.countryCodes ?? []).join(', '))
  const [price, setPrice] = useState(String(zone.basePrice ?? ''))
  const [freeFrom, setFreeFrom] = useState(String(zone.freeShippingThreshold ?? ''))
  const [weightSurcharge, setWeightSurcharge] = useState(String(zone.weightSurchargePerKg ?? ''))

  const handleSave = () => {
    onSave({
      zoneName: name.trim(),
      countryCodes: countries.split(/[,;\s]+/).map((c: string) => c.trim().toUpperCase()).filter(Boolean),
      basePrice: parseFloat(price) || 0,
      freeShippingThreshold: freeFrom ? parseFloat(freeFrom) : undefined,
      weightSurchargePerKg: weightSurcharge ? parseFloat(weightSurcharge) : undefined,
    })
  }

  return (
    <div className="bg-background border-2 border-primary/40 rounded-2xl p-5 shadow-lg" style={{ animation: 'fadeIn 200ms ease-out' }}>
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{locale === 'ar' ? 'اسم المنطقة' : 'Zonenname'}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl h-9 text-sm font-semibold" autoFocus />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{t('shippingZones.countries')} (ISO)</label>
          <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="DE, AT, CH" className="rounded-xl h-9 text-sm font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{t('shippingZones.basePrice')} (€)</label>
            <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-xl h-9 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{t('shippingZones.freeFrom')} (€)</label>
            <Input type="number" step="0.01" min={0} value={freeFrom} onChange={(e) => setFreeFrom(e.target.value)} placeholder="—" className="rounded-xl h-9 text-sm" />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">{locale === 'ar' ? 'رسوم الوزن / كجم' : 'Gewichtszuschlag / kg'} (€)</label>
          <Input type="number" step="0.01" min={0} value={weightSurcharge} onChange={(e) => setWeightSurcharge(e.target.value)} placeholder="0.00" className="rounded-xl h-9 text-sm" />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" className="flex-1 rounded-xl gap-1" onClick={onCancel}>
          <X className="h-3 w-3" />{t('inventory.cancel')}
        </Button>
        <Button size="sm" className="flex-1 rounded-xl gap-1" disabled={!name.trim() || !countries.trim() || isPending} onClick={handleSave}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {t('inventory.save')}
        </Button>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  )
}

// ── New Zone Modal ──────────────────────────────────────────
function NewZoneModal({ locale, t, isPending, onSave, onClose }: {
  locale: string; t: any; isPending: boolean
  onSave: (data: any) => void; onClose: () => void
}) {
  const [name, setName] = useState('')
  const [countries, setCountries] = useState('')
  const [price, setPrice] = useState('')
  const [freeFrom, setFreeFrom] = useState('')
  const [weightSurcharge, setWeightSurcharge] = useState('')

  const handleSave = () => {
    onSave({
      zoneName: name.trim(),
      countryCodes: countries.split(/[,;\s]+/).map((c: string) => c.trim().toUpperCase()).filter(Boolean),
      basePrice: parseFloat(price) || 0,
      freeShippingThreshold: freeFrom ? parseFloat(freeFrom) : undefined,
      weightSurchargePerKg: weightSurcharge ? parseFloat(weightSurcharge) : undefined,
      isActive: true,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} style={{ animation: 'modalBg 200ms ease-out' }} />
      <div className="relative bg-background rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ animation: 'modalSlide 300ms ease-out' }}>
        <button onClick={onClose} className="absolute top-4 ltr:right-4 rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>

        <div className="text-center mb-5">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <h3 className="text-lg font-bold">{t('shippingZones.newZone')}</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">{locale === 'ar' ? 'اسم المنطقة' : 'Zonenname'}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={locale === 'ar' ? 'مثال: ألمانيا' : 'z.B. Deutschland'} className="rounded-xl" autoFocus />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t('shippingZones.countries')} (ISO)</label>
            <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="DE, AT, CH" className="rounded-xl font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">{locale === 'ar' ? 'أكواد ISO مفصولة بفواصل' : 'ISO-Ländercodes, kommagetrennt'}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t('shippingZones.basePrice')} (€)</label>
              <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="4.99" className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t('shippingZones.freeFrom')} (€)</label>
              <Input type="number" step="0.01" min={0} value={freeFrom} onChange={(e) => setFreeFrom(e.target.value)} placeholder="100.00" className="rounded-xl" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">{locale === 'ar' ? 'رسوم الوزن / كجم' : 'Gewichtszuschlag / kg'} (€)</label>
            <Input type="number" step="0.01" min={0} value={weightSurcharge} onChange={(e) => setWeightSurcharge(e.target.value)} placeholder="0.00" className="rounded-xl" />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>{t('inventory.cancel')}</Button>
          <Button className="flex-1 rounded-xl gap-2" disabled={!name.trim() || !countries.trim() || !price || isPending} onClick={handleSave}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('inventory.save')}
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes modalBg { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
