'use client'

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts'

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444']

const METHOD_LABELS: Record<string, string> = {
  stripe_card: 'Kreditkarte',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  klarna_pay_now: 'Klarna Sofort',
  klarna_pay_later: 'Klarna Rechnung',
  paypal: 'PayPal',
}

interface PaymentData {
  method: string
  revenue: string
  count: number
}

export function PaymentPieChart({ data }: { data: PaymentData[] }) {
  const chartData = data.map((d) => ({
    name: METHOD_LABELS[d.method] ?? d.method,
    value: Number(d.revenue),
  }))

  if (chartData.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-16">Keine Daten verfügbar</p>
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `€${Number(value).toFixed(2)}`} />
        <Legend verticalAlign="bottom" height={36} iconSize={10} />
      </PieChart>
    </ResponsiveContainer>
  )
}
