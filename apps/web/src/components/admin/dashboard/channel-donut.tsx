'use client'

import { CHANNEL_CONFIG } from '@/components/admin/channel-icon'

interface ChannelData {
  channel: string
  revenue: string
  count: number
}

export function ChannelDonut({ data, locale }: { data: ChannelData[]; locale: string }) {
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
        {t3('Keine Kanal-Daten heute', 'No channel data today', 'لا توجد بيانات قنوات اليوم')}
      </div>
    )
  }

  const total = data.reduce((s, d) => s + Number(d.revenue), 0)
  const sorted = [...data].sort((a, b) => Number(b.revenue) - Number(a.revenue))

  // SVG donut
  const radius = 60
  const cx = 70
  const cy = 70
  const circumference = 2 * Math.PI * radius
  let offset = 0

  const segments = sorted.map((ch) => {
    const pct = total > 0 ? Number(ch.revenue) / total : 0
    const dashLength = pct * circumference
    const seg = { ...ch, pct, dashLength, offset, color: CHANNEL_CONFIG[ch.channel]?.color ?? '#888' }
    offset += dashLength
    return seg
  })

  return (
    <div>
      {/* Donut */}
      <div className="flex justify-center mb-4">
        <div className="relative">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="16" />
            {segments.map((seg, i) => (
              <circle
                key={seg.channel}
                cx={cx} cy={cy} r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="16"
                strokeDasharray={`${seg.dashLength} ${circumference - seg.dashLength}`}
                strokeDashoffset={-seg.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={{ transition: 'stroke-dasharray 0.8s ease-out', transitionDelay: `${i * 100}ms` }}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold tabular-nums">
              {total.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-muted-foreground">{t3('Heute', 'Today', 'اليوم')}</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {segments.map((seg) => {
          const cfg = CHANNEL_CONFIG[seg.channel]
          const label = cfg ? (locale === 'ar' ? cfg.labelAr : cfg.label) : seg.channel
          return (
            <div key={seg.channel} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="flex-1 truncate">{label}</span>
              <span className="tabular-nums font-medium">{(seg.pct * 100).toFixed(0)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
