'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { useCheckoutStore, type CheckoutAddress } from '@/store/checkout-store'
import { useAuthStore } from '@/store/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ArrowRight, MapPin, Plus, Loader2, AlertTriangle } from 'lucide-react'
import { useLocale } from 'next-intl'
import { FloatInput, FloatSelect } from './float-input'
import { AddressAutocomplete } from '@/components/ui/address-autocomplete'
import { validateAddressOffline, getCityForPLZ } from '@/lib/plz-validation'

const COUNTRIES = [
  { value: 'DE', label: 'Deutschland' },
  { value: 'AT', label: 'Österreich' },
  { value: 'CH', label: 'Schweiz' },
  { value: 'NL', label: 'Niederlande' },
  { value: 'BE', label: 'Belgien' },
  { value: 'LU', label: 'Luxemburg' },
  { value: 'FR', label: 'Frankreich' },
  { value: 'PL', label: 'Polen' },
]

export function StepAddress() {
  const t = useTranslations('checkout')
  const tErr = useTranslations('checkout.errors')
  const tAuth = useTranslations('auth')
  const locale = useLocale()
  const { isAuthenticated } = useAuthStore()
  const {
    shippingAddress, billingSameAsShipping,
    setShippingAddress, setBillingAddress, setBillingSameAsShipping, setSavedAddressId, setStep,
  } = useCheckoutStore()

  // Check if address autocomplete is enabled
  const { data: shopSettings } = useQuery({
    queryKey: ['public-settings-autocomplete'],
    queryFn: async () => { const { data } = await api.get('/settings/public'); return data },
    staleTime: 60000,
  })
  const autocompleteEnabled = shopSettings?.addressAutocompleteEnabled === 'true'

  const [showForm, setShowForm] = useState(!isAuthenticated)
  const [validating, setValidating] = useState(false)
  const [addrWarning, setAddrWarning] = useState<string | null>(null)
  const [bypassWarning, setBypassWarning] = useState(false)
  const [form, setForm] = useState<CheckoutAddress>(
    shippingAddress ?? {
      firstName: '', lastName: '', street: '', houseNumber: '',
      postalCode: '', city: '', country: 'DE',
    },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    setSavedAddressId(addr.id)  // Gespeicherte Adress-ID merken
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

  const proceedToShipping = () => {
    setShippingAddress(form)
    setSavedAddressId(null)
    if (billingSameAsShipping) setBillingAddress(null)
    setStep('shipping')
  }

  const handleContinue = async () => {
    if (!validate()) return

    // Step 1: Offline PLZ + field validation
    const offline = validateAddressOffline(form)
    if (!offline.valid && !bypassWarning) {
      let msg = offline.warnings.map(w => w.message[locale as 'de' | 'en' | 'ar'] ?? w.message.de).join('\n')
      if (offline.suggestion?.city) {
        msg += `\n\n${locale === 'ar' ? `هل تقصد: \u200E${offline.suggestion.city}\u200F؟` : locale === 'en' ? `Did you mean: ${offline.suggestion.city}?` : `Meinten Sie: ${offline.suggestion.city}?`}`
      }
      setAddrWarning(msg)
      return
    }

    // Step 2: DHL API validation (if basic checks pass)
    setValidating(true)
    try {
      const { data } = await api.post('/address/validate', {
        street: form.street,
        houseNumber: form.houseNumber,
        postalCode: form.postalCode,
        city: form.city,
        country: form.country,
      })
      setValidating(false)

      if (!data.valid && !bypassWarning) {
        const dhlMsg = locale === 'ar'
          ? 'لم يتم التعرف على هذا العنوان. يرجى التحقق من المدخلات.'
          : locale === 'en'
          ? 'This address was not recognized. Please check your input.'
          : 'Diese Adresse wurde nicht erkannt. Bitte überprüfen Sie Ihre Eingabe.'
        setAddrWarning(dhlMsg)
        return
      }
    } catch {
      // DHL API not available — proceed anyway (basic validation already passed)
      setValidating(false)
    }

    // All checks passed → proceed
    setAddrWarning(null)
    setBypassWarning(false)
    proceedToShipping()
  }

  const updateField = (field: keyof CheckoutAddress, value: string) => {
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
    if (errors[field]) setErrors((prev) => { const { [field]: _, ...rest } = prev; return rest })
    if (addrWarning) { setAddrWarning(null); setBypassWarning(false) }
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
              className="w-full text-start p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group"
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
            className="w-full text-start p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-all duration-200 flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">{t('address.newAddress')}</span>
          </button>
        </div>
      )}

      {/* Address Form — Float Labels */}
      {(showForm || !hasSavedAddresses) && (
        <div className="space-y-4">
          {hasSavedAddresses && (
            <button onClick={() => setShowForm(false)} className="text-sm text-primary hover:underline mb-2">
              &larr; {t('address.backToSaved')}
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FloatInput
              label={tAuth('firstName')}
              value={form.firstName}
              error={errors.firstName}
              onChange={(v) => updateField('firstName', v)}
              autoComplete="given-name"
            />
            <FloatInput
              label={tAuth('lastName')}
              value={form.lastName}
              error={errors.lastName}
              onChange={(v) => updateField('lastName', v)}
              autoComplete="family-name"
            />
          </div>

          <FloatInput
            label={t('address.company')}
            value={form.company ?? ''}
            required={false}
            onChange={(v) => updateField('company', v)}
            autoComplete="organization"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              {autocompleteEnabled ? (
                <>
                  <AddressAutocomplete
                    placeholder={t('address.street')}
                    value={form.street}
                    onChange={(v) => updateField('street', v)}
                    onSelect={(addr) => {
                      setForm((prev) => ({
                        ...prev,
                        street: addr.street,
                        houseNumber: addr.houseNumber || prev.houseNumber,
                        postalCode: addr.postalCode || prev.postalCode,
                        city: addr.city || prev.city,
                        country: addr.country || prev.country,
                      }))
                      setErrors({})
                    }}
                    className="h-12 w-full rounded-xl border border-input bg-background px-4 text-base transition-colors focus:outline-none focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853]"
                  />
                  {errors.street && <p className="text-xs text-red-600 mt-1">{errors.street}</p>}
                </>
              ) : (
                <FloatInput
                  label={t('address.street')}
                  value={form.street}
                  error={errors.street}
                  onChange={(v) => updateField('street', v)}
                  autoComplete="address-line1"
                />
              )}
            </div>
            <FloatInput
              label={t('address.houseNumber')}
              value={form.houseNumber}
              error={errors.houseNumber}
              onChange={(v) => updateField('houseNumber', v)}
            />
          </div>

          <FloatInput
            label={t('address.addressLine2')}
            value={form.addressLine2 ?? ''}
            required={false}
            onChange={(v) => updateField('addressLine2', v)}
            autoComplete="address-line2"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FloatInput
              label={t('address.postalCode')}
              value={form.postalCode}
              error={errors.postalCode}
              onChange={(v) => updateField('postalCode', v)}
              autoComplete="postal-code"
            />
            <div className="sm:col-span-2">
              <FloatInput
                label={t('address.city')}
                value={form.city}
                error={errors.city}
                onChange={(v) => updateField('city', v)}
                autoComplete="address-level2"
              />
            </div>
          </div>

          <FloatSelect
            label={t('address.country')}
            value={form.country}
            onChange={(v) => updateField('country', v)}
            options={COUNTRIES}
          />

          <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={billingSameAsShipping}
              onChange={(e) => setBillingSameAsShipping(e.target.checked)}
              className="rounded"
            />
            {t('address.billingSameAsShipping')}
          </label>

          {/* Address validation warning */}
          {addrWarning && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="whitespace-pre-line">{addrWarning}</p>
              </div>
              <button
                onClick={() => { setBypassWarning(true); setAddrWarning(null); proceedToShipping() }}
                className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900"
              >
                {locale === 'ar' ? 'أنا متأكد أن العنوان صحيح — متابعة' : locale === 'en' ? 'I confirm this address is correct — continue' : 'Ich bin sicher, die Adresse ist korrekt — weiter'}
              </button>
            </div>
          )}

          <Button
            onClick={handleContinue}
            disabled={validating}
            className="w-full gap-2 mt-4 bg-accent text-accent-foreground h-12 rounded-xl hover:bg-accent/90 btn-press"
            size="lg"
          >
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
            {validating
              ? (locale === 'ar' ? 'جاري التحقق من العنوان...' : locale === 'en' ? 'Verifying address...' : 'Adresse wird geprüft...')
              : t('address.continueToShipping')}
          </Button>
        </div>
      )}
    </div>
  )
}
