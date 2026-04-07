'use client'

import { useLocale } from 'next-intl'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

function generateData(locale: string) {
  const localeStr = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
  const data = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    data.push({
      date: d.toLocaleDateString(localeStr, { weekday: 'short', day: 'numeric' }),
      revenue: Math.round(Math.random() * 2000 + 500),
    })
  }
  // RTL: reverse so newest is on the left (start side)
  return locale === 'ar' ? data.reverse() : data
}

export function RevenueChart() {
  const locale = useLocale()
  const data = generateData(locale)
  const isRtl = locale === 'ar'

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data}>
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
