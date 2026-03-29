'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

// Placeholder data until backend provides daily breakdown
const MOCK_DATA = Array.from({ length: 7 }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() - (6 - i))
  return {
    date: d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' }),
    revenue: Math.round(Math.random() * 2000 + 500),
  }
})

export function RevenueChart() {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={MOCK_DATA}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" className="text-xs" tick={{ fill: '#888' }} />
        <YAxis className="text-xs" tick={{ fill: '#888' }} tickFormatter={(v) => `€${v}`} />
        <Tooltip
          formatter={(value) => [`€${Number(value).toFixed(2)}`, 'Umsatz']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
        />
        <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
