'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Pencil, Trash2, Star, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AddressAutocomplete } from '@/components/ui/address-autocomplete'

const EMPTY_FORM = { firstName: '', lastName: '', street: '', houseNumber: '', postalCode: '', city: '', country: 'DE' }

function formatError(err: unknown, t: (key: string) => string, locale: string): string {
  const e = err as any
  const msg = e?.response?.data?.message ?? e?.message
  // Backend returns {de: "...", en: "...", ar: "..."} → pick current locale
  if (msg && typeof msg === 'object' && !Array.isArray(msg) && (msg.de || msg.en || msg.ar)) {
    return msg[locale] ?? msg.de ?? msg.en ?? t('error')
  }
  // NestJS ValidationPipe returns string[]
  if (Array.isArray(msg)) {
    return msg
      .map((m: string) => m
        .replace(/postalCode must be longer than or equal to \d+ characters/g, t('postalCodeTooShort'))
        .replace(/country must be one of the following values:.*/g, t('countryInvalid'))
      ).join(', ')
  }
  if (typeof msg === 'string') return msg
  return t('error')
}

export default function AddressesPage() {
  const t = useTranslations('account.addresses')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: addresses, isLoading } = useQuery({
    queryKey: ['my-addresses'],
    queryFn: async () => { const { data } = await api.get('/users/me/addresses'); return data },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/addresses/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-addresses'] }),
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) => {
      if (editId) return api.patch(`/users/me/addresses/${editId}`, data)
      return api.post('/users/me/addresses', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-addresses'] })
      setShowForm(false)
      setEditId(null)
      setForm(EMPTY_FORM)
    },
  })

  const handleFormChange = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }))
  const handleFormSubmit = (e: React.FormEvent) => { e.preventDefault(); createMutation.mutate(form) }

  if (isLoading) return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 animate-pulse bg-muted rounded-lg" />)}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">{t('title')}</h2>
        <Button size="sm" onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t('addNew')}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleFormSubmit} className="border rounded-lg p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-bold">{t('addNew')}</h3>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM) }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input required placeholder={t('firstName')} value={form.firstName} onChange={(e) => handleFormChange('firstName', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-full" />
            <input required placeholder={t('lastName')} value={form.lastName} onChange={(e) => handleFormChange('lastName', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-full" />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <AddressAutocomplete
              placeholder={t('street')}
              value={form.street}
              onChange={(v) => handleFormChange('street', v)}
              onSelect={(addr) => {
                setForm((prev) => ({
                  ...prev,
                  street: addr.street,
                  houseNumber: addr.houseNumber,
                  postalCode: addr.postalCode,
                  city: addr.city,
                  country: addr.country || prev.country,
                }))
              }}
              className="h-10 px-3 rounded-lg border bg-background text-sm w-full"
            />
            <input required placeholder={t('houseNumber')} value={form.houseNumber} onChange={(e) => handleFormChange('houseNumber', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-24" />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <input required placeholder={t('postalCode')} value={form.postalCode} onChange={(e) => handleFormChange('postalCode', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-28" />
            <input required placeholder={t('city')} value={form.city} onChange={(e) => handleFormChange('city', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-full" />
          </div>
          <select value={form.country} onChange={(e) => handleFormChange('country', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-full">
            <option value="DE">Deutschland</option>
            <option value="AT">{'\u00D6'}sterreich</option>
            <option value="CH">Schweiz</option>
            <option value="NL">Niederlande</option>
            <option value="BE">Belgien</option>
            <option value="LU">Luxemburg</option>
            <option value="FR">Frankreich</option>
            <option value="PL">Polen</option>
          </select>
          {createMutation.isError && (
            <p className="text-xs text-destructive">{formatError(createMutation.error, t, locale)}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM) }}>{t('cancel')}</Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('save')}
            </Button>
          </div>
        </form>
      )}

      {(addresses ?? []).length === 0 ? (
        <div className="text-center py-16">
          <MapPin className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">{t('empty')}</p>
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-muted transition-colors text-sm font-medium">
            {locale === 'ar' ? 'إضافة عنوان' : locale === 'en' ? 'Add address' : 'Adresse hinzufügen'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(addresses ?? []).map((addr: any) => (
            <div key={addr.id} className="border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all relative">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex gap-2 mb-1.5 flex-wrap">
                    {addr.isDefaultShipping && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold flex items-center gap-1">
                        <Star className="h-3 w-3" />{t('defaultShipping')}
                      </span>
                    )}
                    {addr.isDefaultBilling && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">{t('defaultBilling')}</span>
                    )}
                  </div>
                  <p className="font-semibold text-sm">{addr.firstName} {addr.lastName}</p>
                  {addr.company && <p className="text-xs text-muted-foreground">{addr.company}</p>}
                  <p className="text-sm text-muted-foreground mt-0.5">{addr.street} {addr.houseNumber}</p>
                  <p className="text-sm text-muted-foreground">{addr.postalCode} {addr.city}, {addr.country}</p>
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setEditId(addr.id)
                    setForm({
                      firstName: addr.firstName ?? '',
                      lastName: addr.lastName ?? '',
                      street: addr.street ?? '',
                      houseNumber: addr.houseNumber ?? '',
                      postalCode: addr.postalCode ?? '',
                      city: addr.city ?? '',
                      country: addr.country ?? 'DE',
                    })
                    setShowForm(true)
                  }}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Pencil className="h-3 w-3" />{t('edit')}
                </button>
                <button
                  className="text-xs text-destructive hover:underline flex items-center gap-1"
                  onClick={() => deleteMutation.mutate(addr.id)}
                >
                  {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(addresses ?? []).length >= 10 && (
        <p className="text-xs text-muted-foreground mt-4 text-center">{t('maxReached')}</p>
      )}
    </div>
  )
}
