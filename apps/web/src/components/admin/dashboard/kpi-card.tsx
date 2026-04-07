'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface KpiCardProps {
  title: string
  value: number
  prefix?: string
  suffix?: string
  trend?: string | null
  subtitle?: string
  icon: React.ReactNode
  accentColor: string
  sparkData?: number[]
  href?: string
  alert?: boolean
  delay?: number
}

function useCountUp(target: number, duration = 800, delay = 0) {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(target)
  useEffect(() => {
    const from = prevTarget.current !== target ? prevTarget.current : 0
    prevTarget.current = target
    if (target === 0 && from === 0) { setValue(0); return }
    const timer = setTimeout(() => {
      const start = Date.now()
      const step = () => {
        const progress = Math.min((Date.now() - start) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        setValue(from + (target - from) * eased)
        if (progress < 1) requestAnimationFrame(step)
        else setValue(target)
      }
      step()
    }, delay)
    return () => clearTimeout(timer)
  }, [target, duration, delay])
  return value
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const w = 80
  const h = 28
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute bottom-2 ltr:right-2 rtl:left-2 w-20 h-7 opacity-30">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  )
}

export function KpiCard({ title, value, prefix = '', suffix = '', trend, subtitle, icon, accentColor, sparkData, href, alert, delay = 0 }: KpiCardProps) {
  const animatedValue = useCountUp(value, 800, delay)
  const isDecimal = prefix === '€' || suffix === '€'
  const displayValue = isDecimal ? animatedValue.toFixed(2) : Math.round(animatedValue).toString()

  const content = (
    <div
      className={`relative overflow-hidden bg-background border rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg group ${alert ? 'border-red-300 dark:border-red-500/30' : 'hover:border-foreground/15'}`}
      style={{ animationDelay: `${delay}ms`, animation: 'fadeSlideUp 400ms ease-out both' }}
    >
      <MiniSparkline data={sparkData ?? []} color={accentColor} />
      <div className="flex items-start gap-3 relative z-10">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: accentColor + '15', color: accentColor }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium">{title}</p>
          <p className={`text-2xl font-bold mt-0.5 tabular-nums ${alert ? 'text-red-500' : ''}`}>
            {prefix}{displayValue}{suffix}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {trend && (
              <span className={`text-[11px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${
                trend.startsWith('+') || trend.startsWith('0') ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
              }`}>
                {trend.startsWith('+') || trend.startsWith('0') ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {trend}
              </span>
            )}
            {subtitle && <span className="text-[11px] text-muted-foreground truncate">{subtitle}</span>}
          </div>
        </div>
      </div>
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}
