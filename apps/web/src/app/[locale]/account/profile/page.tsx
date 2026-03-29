'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { PasswordStrength } from '@/components/auth/password-strength'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ProfilePage() {
  const t = useTranslations('account.profile')
  const tAuth = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const queryClient = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => { const { data } = await api.get('/users/me'); return data },
  })

  // Profile update
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch('/users/me', {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
      })
      return data
    },
    onSuccess: (data) => {
      setUser(data)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
      queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    },
  })

  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordChanged, setPasswordChanged] = useState(false)

  const changePassword = useMutation({
    mutationFn: () => api.patch('/users/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setPasswordChanged(true)
      setTimeout(() => setPasswordChanged(false), 3000)
    },
  })

  const pwError = changePassword.error as any

  return (
    <div className="space-y-8 max-w-lg">
      <h2 className="text-xl font-bold">{t('title')}</h2>

      {/* Personal Data */}
      <section>
        <h3 className="text-sm font-semibold mb-4">{t('personalData')}</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">{tAuth('firstName')}</label>
              <Input
                defaultValue={profile?.firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{tAuth('lastName')}</label>
              <Input
                defaultValue={profile?.lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{tAuth('email')}</label>
            <Input value={profile?.email ?? ''} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground mt-1">{t('emailChangeNote')}</p>
          </div>
          <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending} size="sm">
            {profileSaved ? <><Check className="h-4 w-4 mr-1" />{t('saved')}</> : updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {!profileSaved && t('save')}
          </Button>
        </div>
      </section>

      {/* Password */}
      <section className="border-t pt-6">
        <h3 className="text-sm font-semibold mb-4">{t('changePassword')}</h3>
        {passwordChanged && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-sm text-green-700">
            {t('passwordChangedSuccess')}
          </div>
        )}
        {pwError && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-sm text-destructive">
            {pwError?.response?.data?.message?.de ?? tErrors('generic')}
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('currentPassword')}</label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('newPassword')}</label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            <PasswordStrength password={newPassword} />
          </div>
          <Button onClick={() => changePassword.mutate()} disabled={changePassword.isPending || !currentPassword || !newPassword} size="sm">
            {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {t('changePassword')}
          </Button>
        </div>
      </section>
    </div>
  )
}
