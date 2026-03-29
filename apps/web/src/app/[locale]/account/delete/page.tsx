'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function DeleteAccountPage() {
  const t = useTranslations('account.delete')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const logout = useAuthStore((s) => s.logout)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.post('/users/me/gdpr/delete-account', { password }),
    onSuccess: () => {
      logout()
      router.push(`/${locale}`)
    },
  })

  const exportMutation = useMutation({
    mutationFn: () => api.post('/users/me/gdpr/data-export'),
  })

  const error = deleteMutation.error as any

  return (
    <div className="max-w-lg">
      <h2 className="text-xl font-bold mb-6">{t('title')}</h2>

      {/* Warning */}
      <div className="border-2 border-destructive/30 bg-destructive/5 rounded-lg p-5 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-destructive mb-2">{t('warning')}</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>{t('info1')}</li>
              <li>{t('info2')}</li>
              <li>{t('info3')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* GDPR Data Export */}
      <div className="border rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold mb-2">{t('exportTitle')}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t('exportDescription')}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className="gap-2"
        >
          {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {t('exportButton')}
        </Button>
        {exportMutation.isSuccess && (
          <p className="text-xs text-green-600 mt-2">{t('exportSuccess')}</p>
        )}
      </div>

      {/* Delete Form */}
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-sm text-destructive">
            {error?.response?.data?.message?.de ?? tErrors('generic')}
          </div>
        )}

        <div>
          <label className="text-sm font-medium mb-1.5 block">{t('confirmPassword')}</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded mt-0.5" />
          <span>{t('confirmCheckbox')}</span>
        </label>

        <Button
          variant="destructive"
          onClick={() => deleteMutation.mutate()}
          disabled={!password || !confirmed || deleteMutation.isPending}
          className="w-full"
        >
          {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {t('deleteButton')}
        </Button>
      </div>
    </div>
  )
}
