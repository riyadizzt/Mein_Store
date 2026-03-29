'use client'

import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Monitor, Smartphone, LogOut, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function SessionsPage() {
  const t = useTranslations('account.sessions')
  const queryClient = useQueryClient()

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: async () => { const { data } = await api.get('/users/me/sessions'); return data },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-sessions'] }),
  })

  const revokeAllMutation = useMutation({
    mutationFn: () => api.delete('/users/me/sessions'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-sessions'] }),
  })

  if (isLoading) return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse bg-muted rounded-lg" />)}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">{t('title')}</h2>
        {(sessions ?? []).length > 1 && (
          <Button variant="outline" size="sm" onClick={() => revokeAllMutation.mutate()} disabled={revokeAllMutation.isPending} className="gap-2 text-destructive">
            {revokeAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {t('revokeAll')}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {(sessions ?? []).map((session: any, i: number) => {
          const isMobile = session.userAgent?.toLowerCase().includes('mobile')
          const Icon = isMobile ? Smartphone : Monitor
          const ipMasked = session.ipAddress?.replace(/\.\d+$/, '.xxx') ?? '—'

          return (
            <div key={session.id} className={`border rounded-2xl p-5 flex items-center gap-4 shadow-card transition-all ${i === 0 ? 'border-accent/30 bg-accent/5' : 'hover:shadow-card-hover'}`}>
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-accent/10' : 'bg-muted'}`}>
                <Icon className={`h-6 w-6 ${i === 0 ? 'text-accent' : 'text-muted-foreground'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{session.deviceName ?? (isMobile ? t('mobile') : t('desktop'))}</p>
                  {i === 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium">{t('thisDevice')}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  IP: {ipMasked} &middot; {t('lastAccess')}: {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleDateString('de-DE') : '—'}
                </p>
              </div>
              {i > 0 && (
                <Button variant="outline" size="sm" onClick={() => revokeMutation.mutate(session.id)} disabled={revokeMutation.isPending} className="text-destructive border-destructive/20 hover:bg-destructive/10 rounded-xl">
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
