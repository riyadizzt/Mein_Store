'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useRegister } from '@/hooks/use-auth'
import { PasswordStrength } from '@/components/auth/password-strength'
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
    const required = locale === 'ar' ? 'حقل مطلوب' : locale === 'en' ? 'Required' : 'Pflichtfeld'
    if (!form.firstName) e.firstName = required
    if (!form.lastName) e.lastName = required
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t('errors.invalidEmail')
    if (form.password.length < 8) e.password = t('errors.passwordTooShort')
    if (!/(?=.*[0-9])(?=.*[!@#$%^&*])/.test(form.password) && form.password.length >= 8) {
      e.password = locale === 'ar' ? 'يجب أن تحتوي كلمة المرور على رقم وحرف خاص (!@#$%^&*)'
        : locale === 'en' ? 'Password must contain a number and special character (!@#$%^&*)'
        : 'Passwort muss eine Zahl und ein Sonderzeichen enthalten (!@#$%^&*)'
    }
    if (form.password !== form.confirmPassword) {
      e.confirmPassword = locale === 'ar' ? 'كلمات المرور غير متطابقة'
        : locale === 'en' ? 'Passwords do not match'
        : 'Passwörter stimmen nicht überein'
    }
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
  const rawMsg = apiError?.response?.data?.message ?? apiError?.message
  const apiErrorMsg = Array.isArray(rawMsg) ? rawMsg.join('. ') : (typeof rawMsg === 'string' ? rawMsg : null)

  const inputClass = "h-12 rounded-xl border-[#e0e0e0] focus:border-[#d4a853] focus:ring-[#d4a853]/20 text-base"

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-16 bg-[#fafafa]">
      <div className="w-full max-w-[420px] px-4">

        {/* Logo */}
        <div className="text-center mb-10">
          <Link href={`/${locale}`} className="inline-block">
            <span className="text-2xl font-display font-bold text-[#0f1419] tracking-[0.3em]">MALAK</span>
          </Link>
          <p className="text-sm text-[#0f1419]/40 mt-2 tracking-wide">BEKLEIDUNG</p>
        </div>

        {/* API Error */}
        {apiErrorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700" role="alert">
            {apiErrorMsg}
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-[#e5e5e5]/50 p-8 sm:p-10 space-y-6">

          <h1 className="text-xl font-semibold text-center text-[#0f1419]">{t('registerTitle')}</h1>

          {/* Social Login */}
          <GoogleSignIn label={`Google ${t('registerButton')}`} />

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[#e5e5e5]" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-4 text-[#0f1419]/30">
                {locale === 'ar' ? 'أو' : locale === 'en' ? 'or' : 'oder'}
              </span>
            </div>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('firstName')}</label>
                <Input id="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} />
                {errors.firstName && <p className="text-xs text-red-600 mt-1.5">{errors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('lastName')}</label>
                <Input id="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} />
                {errors.lastName && <p className="text-xs text-red-600 mt-1.5">{errors.lastName}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="email" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('email')}</label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" className={inputClass} />
              {errors.email && <p className="text-xs text-red-600 mt-1.5">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">{t('password')}</label>
              <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" className={inputClass} />
              <PasswordStrength password={form.password} />
              {errors.password && <p className="text-xs text-red-600 mt-1.5">{errors.password}</p>}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="text-sm font-medium text-[#0f1419]/70 mb-2 block">
                {locale === 'ar' ? 'تأكيد كلمة المرور' : locale === 'en' ? 'Confirm password' : 'Passwort bestätigen'}
              </label>
              <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} autoComplete="new-password" className={inputClass} />
              {errors.confirmPassword && <p className="text-xs text-red-600 mt-1.5">{errors.confirmPassword}</p>}
            </div>

            {/* GDPR Consent */}
            <label className="flex items-start gap-3 text-sm cursor-pointer group">
              <input
                type="checkbox" checked={gdprConsent} onChange={(e) => setGdprConsent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#d0d0d0] text-[#d4a853] focus:ring-[#d4a853]/30"
              />
              <span className="text-[#0f1419]/60 leading-relaxed">
                {t('gdprConsent')}{' '}
                <a href={`/${locale}/legal/datenschutz`} target="_blank" rel="noopener noreferrer" className="text-[#d4a853] underline underline-offset-2 hover:text-[#c49b45]">
                  {locale === 'ar' ? 'سياسة الخصوصية' : locale === 'en' ? 'Privacy Policy' : 'Datenschutzerklärung'}
                </a>
              </span>
            </label>
            {errors.gdpr && <p className="text-xs text-red-600 -mt-2">{errors.gdpr}</p>}

            <button
              type="submit"
              disabled={register.isPending}
              className="w-full h-13 rounded-xl bg-[#d4a853] text-white text-base font-semibold hover:bg-[#c49b45] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {register.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('registerButton')}
            </button>
          </form>
        </div>

        {/* Login link */}
        <p className="mt-8 text-center text-sm text-[#0f1419]/50">
          {t('alreadyHaveAccount')}{' '}
          <Link href={`/${locale}/auth/login`} className="text-[#d4a853] font-medium hover:text-[#c49b45] transition-colors">
            {t('loginButton')}
          </Link>
        </p>
      </div>
    </div>
  )
}
