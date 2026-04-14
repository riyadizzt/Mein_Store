'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { User, ArrowRight } from 'lucide-react'
import { useCheckoutStore } from '@/store/checkout-store'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function GuestOrLogin({ locale }: { locale: string }) {
  const t = useTranslations('auth')
  const tCheckout = useTranslations('checkout')
  const { setGuest, setStep } = useCheckoutStore()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')

  // If already logged in, skip this step
  useEffect(() => {
    if (isAuthenticated) {
      setGuest(false)
      setStep('address')
    }
  }, [isAuthenticated, setGuest, setStep])

  if (isAuthenticated) return null

  const handleGuest = () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(t('errors.invalidEmail'))
      return
    }
    setGuest(true, email)
  }

  return (
    <div className="max-w-md mx-auto py-8">
      <h2 className="text-xl font-bold text-center mb-8">{tCheckout('guest.title')}</h2>

      <div className="space-y-6">
        {/* Guest Checkout */}
        <div className="border rounded-2xl shadow-card hover:shadow-card-hover transition-all p-6">
          <h3 className="font-semibold mb-4">{tCheckout('guest.continueAsGuest')}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {tCheckout('guest.guestDescription')}
          </p>
          <div className="space-y-3">
            <div>
              <Input
                type="email"
                placeholder={t('email')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError('') }}
                className={emailError ? 'border-destructive' : ''}
                aria-label={t('email')}
              />
              {emailError && (
                <p className="text-xs text-destructive mt-1" role="alert">{emailError}</p>
              )}
            </div>
            <Button onClick={handleGuest} className="w-full gap-2">
              {tCheckout('guest.continueAsGuest')}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-muted" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-4 text-muted-foreground">{tCheckout('guest.or')}</span>
          </div>
        </div>

        {/* Login */}
        <div className="border rounded-2xl shadow-card hover:shadow-card-hover transition-all p-6">
          <div className="flex items-center gap-3 mb-4">
            <User className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">{t('loginTitle')}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {tCheckout('guest.loginDescription')}
          </p>
          <Link href={`/${locale}/auth/login?redirect=checkout`}>
            <Button variant="outline" className="w-full gap-2">
              {t('loginButton')}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
