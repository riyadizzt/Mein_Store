'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { useCheckoutStore, type CheckoutAddress } from '@/store/checkout-store'
import { useAuthStore } from '@/store/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowRight, MapPin, Plus } from 'lucide-react'

const COUNTRIES = [
  { code: 'DE', name: 'Deutschland' },
  { code: 'AT', name: 'Österreich' },
  { code: 'CH', name: 'Schweiz' },
  { code: 'NL', name: 'Niederlande' },
  { code: 'BE', name: 'Belgien' },
  { code: 'LU', name: 'Luxemburg' },
  { code: 'FR', name: 'Frankreich' },
  { code: 'PL', name: 'Polen' },
]

export function StepAddress() {
  const t = useTranslations('checkout')
  const tErr = useTranslations('checkout.errors')
  const tAuth = useTranslations('auth')
  const { isAuthenticated } = useAuthStore()
  const {
    shippingAddress, billingSameAsShipping,
    setShippingAddress, setBillingAddress, setBillingSameAsShipping, setStep,
  } = useCheckoutStore()

  const [showForm, setShowForm] = useState(!isAuthenticated)
  const [form, setForm] = useState<CheckoutAddress>(
    shippingAddress ?? {
      firstName: '', lastName: '', street: '', houseNumber: '',
      postalCode: '', city: '', country: 'DE',
    },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Fetch saved addresses for logged-in users
  const { data: savedAddresses } = useQuery({
    queryKey: ['my-addresses'],
    queryFn: async () => {
      const { data } = await api.get('/users/me/addresses')
      return data as any[]
    },
    enabled: isAuthenticated,
  })

  const hasSavedAddresses = isAuthenticated && (savedAddresses ?? []).length > 0

  const selectSavedAddress = (addr: any) => {
    const mapped: CheckoutAddress = {
      firstName: addr.firstName ?? '',
      lastName: addr.lastName ?? '',
      street: addr.street ?? '',
      houseNumber: addr.houseNumber ?? '',
      postalCode: addr.postalCode ?? '',
      city: addr.city ?? '',
      country: addr.country ?? 'DE',
      company: addr.company,
      addressLine2: addr.addressLine2,
    }
    setForm(mapped)
    setShippingAddress(mapped)
    if (billingSameAsShipping) setBillingAddress(null)
    setStep('shipping')
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!form.firstName.trim()) e.firstName = tAuth('errors.required')
    if (!form.lastName.trim()) e.lastName = tAuth('errors.required')
    if (!form.street.trim()) e.street = tAuth('errors.required')
    if (!form.houseNumber.trim()) e.houseNumber = tAuth('errors.required')
    if (!form.city.trim()) e.city = tAuth('errors.required')
    if (!form.postalCode.trim()) e.postalCode = tAuth('errors.required')
    if (form.country === 'DE' && !/^\d{5}$/.test(form.postalCode)) e.postalCode = tErr('plzInvalid', { digits: '5' })
    if (['AT', 'CH', 'BE', 'NL'].includes(form.country) && !/^\d{4}/.test(form.postalCode)) e.postalCode = tErr('plzInvalidGeneric')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleContinue = () => {
    if (!validate()) return
    setShippingAddress(form)
    if (billingSameAsShipping) setBillingAddress(null)
    setStep('shipping')
  }

  const updateField = (field: keyof CheckoutAddress, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => { const { [field]: _, ...rest } = prev; return rest })
  }

  return (
    <div className="max-w-lg mx-auto py-6">
      <h2 className="text-xl font-bold mb-6">{t('address.title')}</h2>

      {/* Saved Addresses */}
      {hasSavedAddresses && !showForm && (
        <div className="space-y-3 mb-6">
          <p className="text-sm text-muted-foreground mb-3">{t('address.savedAddresses')}</p>
          {(savedAddresses ?? []).map((addr: any) => (
            <button
              key={addr.id}
              onClick={() => selectSavedAddress(addr)}
              className="w-full text-left p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                  <MapPin className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{addr.firstName} {addr.lastName}</p>
                  <p className="text-xs text-muted-foreground">{addr.street} {addr.houseNumber}</p>
                  <p className="text-xs text-muted-foreground">{addr.postalCode} {addr.city}, {addr.country}</p>
                </div>
              </div>
            </button>
          ))}
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-left p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-all duration-200 flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">{t('address.newAddress')}</span>
          </button>
        </div>
      )}

      {/* Address Form */}
      {(showForm || !hasSavedAddresses) && (
        <div className="space-y-4">
          {hasSavedAddresses && (
            <button onClick={() => setShowForm(false)} className="text-sm text-primary hover:underline mb-2">
              ← {t('address.backToSaved')}
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={tAuth('firstName')} value={form.firstName} error={errors.firstName}
              onChange={(v) => updateField('firstName', v)} />
            <Field label={tAuth('lastName')} value={form.lastName} error={errors.lastName}
              onChange={(v) => updateField('lastName', v)} />
          </div>

          <Field label={t('address.company')} value={form.company ?? ''} required={false}
            onChange={(v) => updateField('company', v)} />

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label={t('address.street')} value={form.street} error={errors.street}
                onChange={(v) => updateField('street', v)} />
            </div>
            <Field label={t('address.houseNumber')} value={form.houseNumber} error={errors.houseNumber}
              onChange={(v) => updateField('houseNumber', v)} />
          </div>

          <Field label={t('address.addressLine2')} value={form.addressLine2 ?? ''} required={false}
            onChange={(v) => updateField('addressLine2', v)} />

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('address.postalCode')} value={form.postalCode} error={errors.postalCode}
              onChange={(v) => updateField('postalCode', v)} />
            <div className="col-span-2">
              <Field label={t('address.city')} value={form.city} error={errors.city}
                onChange={(v) => updateField('city', v)} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('address.country')}</label>
            <select
              value={form.country}
              onChange={(e) => updateField('country', e.target.value)}
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
            <input type="checkbox" checked={billingSameAsShipping} onChange={(e) => setBillingSameAsShipping(e.target.checked)} className="rounded" />
            {t('address.billingSameAsShipping')}
          </label>

          <Button onClick={handleContinue} className="w-full gap-2 mt-4 bg-accent text-accent-foreground h-12 rounded-xl hover:bg-accent/90" size="lg">
            {t('address.continueToShipping')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({
  label, value, error, onChange, required = true,
}: {
  label: string; value: string; error?: string; onChange: (v: string) => void; required?: boolean
}) {
  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={error ? 'border-destructive' : ''} required={required} aria-label={label} />
      {error && <p className="text-xs text-destructive mt-1" role="alert">{error}</p>}
    </div>
  )
}
