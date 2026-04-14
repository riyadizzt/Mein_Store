'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Pencil, Trash2, Star, Loader2, X, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AddressAutocomplete } from '@/components/ui/address-autocomplete'
import { validateAddressOffline, getCityForPLZ } from '@/lib/plz-validation'

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

  const { data: shopSettings } = useQuery({
    queryKey: ['public-settings-autocomplete'],
    queryFn: async () => { const { data } = await api.get('/settings/public'); return data },
    staleTime: 60000,
  })
  const autocompleteEnabled = shopSettings?.addressAutocompleteEnabled === 'true'

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

  const [addrWarning, setAddrWarning] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [bypassWarning, setBypassWarning] = useState(false)

  const handleFormChange = (field: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      // Auto-fill city when PLZ is complete (5 digits for DE)
      if (field === 'postalCode' && /^\d{5}$/.test(value) && next.country === 'DE') {
        const city = getCityForPLZ(value)
        if (city && (!next.city || next.city.length < 2)) {
          next.city = city
        }
      }
      return next
    })
    if (addrWarning) { setAddrWarning(null); setBypassWarning(false) }
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Step 1: Offline validation
    const offline = validateAddressOffline(form)
    if (!offline.valid && !bypassWarning) {
      const msg = offline.warnings.map(w => w.message[locale as 'de' | 'en' | 'ar'] ?? w.message.de).join('\n')
      setAddrWarning(msg + (offline.suggestion?.city ? `\n${locale === 'ar' ? `هل تقصد: \u200E${offline.suggestion.city}\u200F؟` : `Meinten Sie: ${offline.suggestion.city}?`}` : ''))
      return
    }

    // Step 2: DHL API validation
    setValidating(true)
    try {
      const { data } = await api.post('/address/validate', {
        street: form.street, houseNumber: form.houseNumber,
        postalCode: form.postalCode, city: form.city, country: form.country,
      })
      if (!data.valid && !bypassWarning) {
        setValidating(false)
        setAddrWarning(locale === 'ar' ? 'لم يتم التعرف على هذا العنوان. يرجى التحقق.' : locale === 'en' ? 'This address was not recognized. Please check.' : 'Diese Adresse wurde nicht erkannt. Bitte prüfen.')
        return
      }
    } catch { /* DHL unavailable — proceed */ }
    setValidating(false)

    setAddrWarning(null)
    setBypassWarning(false)
    createMutation.mutate(form)
  }

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
            {autocompleteEnabled ? (
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
            ) : (
              <input required placeholder={t('street')} value={form.street} onChange={(e) => handleFormChange('street', e.target.value)} className="h-10 px-3 rounded-lg border bg-background text-sm w-full" />
            )}
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
          {/* Address validation warning */}
          {addrWarning && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="whitespace-pre-line">{addrWarning}</p>
              </div>
              <button type="button" onClick={() => { setBypassWarning(true); setAddrWarning(null); createMutation.mutate(form) }}
                className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900">
                {locale === 'ar' ? 'أنا متأكد أن العنوان صحيح — حفظ' : locale === 'en' ? 'I confirm this address is correct — save' : 'Adresse ist korrekt — trotzdem speichern'}
              </button>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setAddrWarning(null) }}>{t('cancel')}</Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending || validating}>
              {(createMutation.isPending || validating) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {validating ? (locale === 'ar' ? 'جاري التحقق...' : 'Prüfe...') : t('save')}
            </Button>
          </div>
        </form>
      )}

      {(addresses ?? []).length === 0 ? (
        <div className="text-center py-16">
          <div className="h-20 w-20 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-5">
            <MapPin className="h-9 w-9 text-blue-300" />
          </div>
          <h3 className="text-lg font-semibold mb-2">{t('empty')}</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-5">{t('emptyHint')}</p>
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 transition-colors text-sm font-medium btn-press">
            <MapPin className="h-4 w-4" />
            {t('addNew')}
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
