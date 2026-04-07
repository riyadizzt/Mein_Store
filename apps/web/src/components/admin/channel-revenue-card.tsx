'use client'

import { ChannelIcon, CHANNEL_CONFIG } from '@/components/admin/channel-icon'

interface ChannelRevenueData {
  channel: string
  revenue: string
  count: number
}

export function ChannelRevenueCard({ data, locale }: { data: ChannelRevenueData[]; locale: string }) {
  if (!data || data.length === 0) return null

  const totalRevenue = data.reduce((s, d) => s + Number(d.revenue), 0)
  const sorted = [...data].sort((a, b) => Number(b.revenue) - Number(a.revenue))

  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  return (
    <div className="bg-background border rounded-xl p-5">
      <h3 className="font-semibold text-sm mb-4">{t3('Umsatz nach Kanal heute', 'Revenue by Channel Today', 'الإيرادات حسب القناة اليوم')}</h3>
      <div className="space-y-2.5">
        {sorted.map((ch) => {
          const rev = Number(ch.revenue)
          const pct = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0
          const cfg = CHANNEL_CONFIG[ch.channel]
          const label = cfg ? (locale === 'ar' ? cfg.labelAr : cfg.label) : ch.channel

          return (
            <div key={ch.channel} className="flex items-center gap-3">
              <ChannelIcon channel={ch.channel} size={16} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium truncate">{label}</span>
                  <span className="text-xs font-bold tabular-nums">{rev.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { style: 'currency', currency: 'EUR' })}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: cfg?.color ?? '#888' }}
                  />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-end">{ch.count}</span>
            </div>
          )
        })}
      </div>
      {totalRevenue > 0 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
          <span className="text-muted-foreground">{t3('Gesamt', 'Total', 'الإجمالي')}</span>
          <span className="font-bold">{totalRevenue.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { style: 'currency', currency: 'EUR' })}</span>
        </div>
      )}
    </div>
  )
}
