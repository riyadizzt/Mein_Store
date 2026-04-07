'use client'

import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Power } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export function MaintenanceBanner() {
  const locale = useLocale()
  const qc = useQueryClient()
  const t = (d: string, a: string) => locale === 'ar' ? a : d

  const { data: stats } = useQuery({
    queryKey: ['maintenance-stats'],
    queryFn: async () => { const { data } = await api.get('/admin/maintenance/stats'); return data },
    staleTime: 30000,
  })

  const disableMut = useMutation({
    mutationFn: async () => { await api.patch('/admin/settings', { maintenance_enabled: 'false' }) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['public-settings-maintenance'] })
    },
  })

  if (!stats?.enabled) return null

  return (
    <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">
          {t('⚠ WARTUNGSMODUS AKTIV — Kunden sehen die Wartungsseite', '⚠ وضع الصيانة نشط — العملاء يرون صفحة الصيانة')}
        </span>
        <span className="text-white/70 text-xs">
          ({stats.views} {t('Aufrufe', 'مشاهدة')} · {stats.emails} {t('E-Mails', 'بريد')})
        </span>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs border-white/30 text-white hover:bg-white/10 rounded-lg gap-1.5"
        onClick={() => disableMut.mutate()} disabled={disableMut.isPending}>
        <Power className="h-3 w-3" />
        {t('Jetzt deaktivieren', 'إيقاف الآن')}
      </Button>
    </div>
  )
}
