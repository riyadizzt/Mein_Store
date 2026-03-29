'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useRegister } from '@/hooks/use-auth'
import { PasswordStrength } from '@/components/auth/password-strength'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleSignIn } from '@/components/auth/google-sign-in'

export default function RegisterPage() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const register = useRegister()

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' })
  const [gdprConsent, setGdprConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.firstName) e.firstName = 'Pflichtfeld'
    if (!form.lastName) e.lastName = 'Pflichtfeld'
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t('errors.invalidEmail')
    if (form.password.length < 8) e.password = t('errors.passwordTooShort')
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwörter stimmen nicht überein'
    if (!gdprConsent) e.gdpr = t('errors.gdprRequired')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    try {
      await register.mutateAsync({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        gdprConsent,
      })
      router.push(`/${locale}/account`)
    } catch {
      // handled by mutation
    }
  }

  const apiError = register.error as any
  const apiErrorMsg = apiError?.response?.data?.message

  return (
    <div className="min-h-[60vh] flex items-center justify-center py-12">
      <div className="w-full max-w-sm px-4">
        <h1 className="text-2xl font-bold text-center mb-8">{t('registerTitle')}</h1>

        {apiErrorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-sm text-destructive" role="alert">
            {typeof apiErrorMsg === 'string' ? apiErrorMsg : apiErrorMsg[locale] ?? apiErrorMsg.de}
          </div>
        )}

        <div className="space-y-4 border rounded-2xl p-8 shadow-card">
          <GoogleSignIn label={`Google ${t('registerButton')}`} />
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-4 text-muted-foreground">{t('registerButton')}</span></div>
          </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="text-sm font-medium mb-1.5 block">{t('firstName')}</label>
              <Input id="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              {errors.firstName && <p className="text-xs text-destructive mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label htmlFor="lastName" className="text-sm font-medium mb-1.5 block">{t('lastName')}</label>
              <Input id="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              {errors.lastName && <p className="text-xs text-destructive mt-1">{errors.lastName}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="email" className="text-sm font-medium mb-1.5 block">{t('email')}</label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
            {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium mb-1.5 block">{t('password')}</label>
            <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            <PasswordStrength password={form.password} />
            {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="text-sm font-medium mb-1.5 block">Passwort bestätigen</label>
            <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} autoComplete="new-password" />
            {errors.confirmPassword && <p className="text-xs text-destructive mt-1">{errors.confirmPassword}</p>}
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={gdprConsent} onChange={(e) => setGdprConsent(e.target.checked)} className="rounded mt-0.5" />
            <span>{t('gdprConsent')} <a href={`/${locale}/privacy`} target="_blank" className="text-primary underline">Datenschutzerklärung</a></span>
          </label>
          {errors.gdpr && <p className="text-xs text-destructive -mt-2">{errors.gdpr}</p>}

          <Button type="submit" disabled={register.isPending} className="w-full bg-accent text-accent-foreground rounded-xl h-12 hover:bg-accent/90" size="lg">
            {register.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('registerButton')}
          </Button>
        </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('alreadyHaveAccount')}{' '}
          <Link href={`/${locale}/auth/login`} className="text-primary font-medium hover:underline">
            {t('loginButton')}
          </Link>
        </p>
      </div>
    </div>
  )
}
