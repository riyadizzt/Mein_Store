'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { MapPin, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

export default function ShippingZonesPage() {
  const locale = useLocale()
  const t = useTranslations('admin')

  const { data: zones, isLoading } = useQuery({
    queryKey: ['admin-shipping-zones'],
    queryFn: async () => { const { data } = await api.get('/admin/shipping-zones'); return data },
  })

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('shippingZones.title') }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="h-6 w-6" />{t('shippingZones.title')}</h1>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />{t('shippingZones.newZone')}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 animate-pulse bg-muted rounded-xl" />)
        ) : (zones ?? []).map((zone: any) => (
          <div key={zone.id} className="bg-background border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{zone.zoneName}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${zone.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {zone.isActive ? t('shippingZones.active') : t('shippingZones.inactive')}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('shippingZones.countries')}</span>
                <span>{(zone.countryCodes ?? []).join(', ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('shippingZones.basePrice')}</span>
                <span className="font-medium">{formatCurrency(Number(zone.basePrice), locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('shippingZones.freeFrom')}</span>
                <span>{zone.freeShippingThreshold ? `€${Number(zone.freeShippingThreshold).toFixed(2)}` : '—'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
