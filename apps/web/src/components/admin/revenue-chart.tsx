'use client'

import { useLocale } from 'next-intl'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

// Real data shape from dashboard.service.ts getOverview():
// { date: 'YYYY-MM-DD', revenue: number, orderCount: number }
interface DayPoint {
  date: string
  revenue: number
  orderCount: number
}

interface Props {
  data?: DayPoint[]
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso + 'T12:00:00Z')  // noon-of-day avoids DST shifts
  const localeStr = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  return d.toLocaleDateString(localeStr, { weekday: 'short', day: 'numeric' })
}

export function RevenueChart({ data }: Props) {
  const locale = useLocale()
  const isRtl = locale === 'ar'

  // If backend didn't ship data (first load, or the data property is missing),
  // fall back to 7 empty buckets so the axes still render cleanly.
  const buckets: DayPoint[] = data && data.length > 0
    ? data
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        return { date: d.toISOString().slice(0, 10), revenue: 0, orderCount: 0 }
      })

  // Each chart point only needs its display label + revenue number.
  const chartData = buckets.map((b) => ({
    date: formatDate(b.date, locale),
    revenue: b.revenue,
    orderCount: b.orderCount,
  }))

  // RTL: newest day is on the visual left (start side).
  const displayData = isRtl ? [...chartData].reverse() : chartData

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={displayData}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#d4a853" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#d4a853" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="date"
          className="text-xs"
          tick={{ fill: '#888', fontSize: 11 }}
          reversed={isRtl}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          className="text-xs"
          tick={{ fill: '#888', fontSize: 11 }}
          tickFormatter={(v) => `€${v}`}
          orientation={isRtl ? 'right' : 'left'}
          tickLine={false}
          axisLine={false}
          width={55}
        />
        <Tooltip
          formatter={(value) => [`€${Number(value).toFixed(2)}`, locale === 'ar' ? 'الإيرادات' : locale === 'en' ? 'Revenue' : 'Umsatz']}
          contentStyle={{ borderRadius: '10px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--background))' }}
          labelStyle={{ fontWeight: 600, marginBottom: 4 }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#d4a853"
          strokeWidth={2.5}
          fill="url(#revenueGrad)"
          dot={{ r: 3, fill: '#d4a853', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#d4a853', stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
