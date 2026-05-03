'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { api, API_BASE_URL } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import {
  TrendingUp, TrendingDown, Euro, ShoppingBag, Users,
  BarChart3, Receipt, Download, Calendar, Package, ArrowUpDown, Globe,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { MonthlyTabV2 } from '@/components/admin/finance/monthly-tab'
import { deriveMonthlyDisplayValues, deriveDailyVatPerRow } from '@/lib/finance-display'
import { DateTimePicker } from '@/components/ui/datetime-picker'

type Tab = 'overview' | 'daily' | 'monthly' | 'profit' | 'vat' | 'bestsellers' | 'customers'

function fmt(v: number | string | undefined | null): string {
  const n = Number(v ?? 0)
  return `€${n.toFixed(2)}`
}

const PAYMENT_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  stripe_card: { label: 'Kreditkarte', icon: '💳', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  apple_pay: { label: 'Apple Pay', icon: '🍎', color: 'bg-gray-50 text-gray-700 border-gray-200' },
  google_pay: { label: 'Google Pay', icon: '🔵', color: 'bg-green-50 text-green-700 border-green-200' },
  klarna_pay_now: { label: 'Klarna Sofort', icon: '🟢', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  klarna_pay_later: { label: 'Klarna Rechnung', icon: '🟢', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  klarna_installments: { label: 'Klarna Raten', icon: '🟢', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  paypal: { label: 'PayPal', icon: '🅿️', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  sepa_direct_debit: { label: 'SEPA-Lastschrift', icon: '🏦', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  giropay: { label: 'Giropay', icon: '🏦', color: 'bg-blue-50 text-blue-700 border-blue-200' },
}

function downloadDataAsCsv(data: any, filename: string) {
  if (!data) return
  // Flatten nested objects into CSV rows
  const rows: string[] = []
  const flattenForCsv = (obj: any, prefix = '') => {
    if (Array.isArray(obj)) {
      if (obj.length === 0) return
      // Array of objects → table
      const keys = Object.keys(obj[0])
      rows.push(keys.join(';'))
      obj.forEach((item) => rows.push(keys.map((k) => String(item[k] ?? '')).join(';')))
      rows.push('')
    } else if (typeof obj === 'object' && obj !== null) {
      Object.entries(obj).forEach(([key, val]) => {
        if (Array.isArray(val)) {
          rows.push(`\n--- ${prefix}${key} ---`)
          flattenForCsv(val)
        } else if (typeof val === 'object' && val !== null) {
          flattenForCsv(val, `${key}.`)
        } else {
          rows.push(`${prefix}${key};${String(val ?? '')}`)
        }
      })
    }
  }
  flattenForCsv(data)
  const csvName = filename.replace(/\.json$/, '.csv')
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = csvName; a.click()
  URL.revokeObjectURL(url)
}


function pct(current: number, previous: number): { label: string; up: boolean } | null {
  if (!previous) return null
  const diff = ((current - previous) / previous) * 100
  return { label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`, up: diff >= 0 }
}

export default function AdminFinancePage() {
  const locale = useLocale()
  const adminUser = useAuthStore((s) => s.adminUser)
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const hasAccess = adminUser?.role === 'super_admin' || adminUser?.permissions?.includes('finance.revenue')
  const hasMargins = true // Produkt-Tab zeigt nur Umsatz, keine Einkaufspreise

  const [tab, setTab] = useState<Tab>('overview')
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [monthYear, setMonthYear] = useState(() => new Date().getFullYear())
  const [monthMonth, setMonthMonth] = useState(() => new Date().getMonth() + 1)
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [rangeTo, setRangeTo] = useState(() => new Date().toISOString().slice(0, 10))

  const daily = useQuery({
    queryKey: ['finance-daily', dailyDate],
    queryFn: () => api.get('/admin/finance/daily', { params: { date: dailyDate } }).then((r) => r.data),
    enabled: hasAccess && (tab === 'overview' || tab === 'daily'),
  })

  const monthly = useQuery({
    queryKey: ['finance-monthly', monthYear, monthMonth],
    queryFn: () => api.get('/admin/finance/monthly', { params: { year: monthYear, month: monthMonth } }).then((r) => r.data),
    enabled: hasAccess && tab === 'monthly',
  })

  const profit = useQuery({
    queryKey: ['finance-profit', rangeFrom, rangeTo],
    queryFn: () => api.get('/admin/finance/profit', { params: { from: rangeFrom, to: rangeTo } }).then((r) => r.data),
    enabled: hasAccess && hasMargins && tab === 'profit',
  })

  const vat = useQuery({
    queryKey: ['finance-vat', rangeFrom, rangeTo],
    queryFn: () => api.get('/admin/finance/vat', { params: { from: rangeFrom, to: rangeTo } }).then((r) => r.data),
    enabled: hasAccess && tab === 'vat',
  })

  const bestsellers = useQuery({
    queryKey: ['finance-bestsellers', rangeFrom, rangeTo],
    queryFn: () => api.get('/admin/finance/bestsellers', { params: { from: rangeFrom, to: rangeTo } }).then((r) => r.data),
    enabled: hasAccess && tab === 'bestsellers',
  })

  const customers = useQuery({
    queryKey: ['finance-customers', rangeFrom, rangeTo],
    queryFn: () => api.get('/admin/finance/customers', { params: { from: rangeFrom, to: rangeTo } }).then((r) => r.data),
    enabled: hasAccess && tab === 'customers',
  })

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">{t3('Kein Zugriff', 'Access denied', '\u0644\u0627 \u064A\u0648\u062C\u062F \u0635\u0644\u0627\u062D\u064A\u0629')}</p>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: t3('Ubersicht', 'Overview', '\u0646\u0638\u0631\u0629 \u0639\u0627\u0645\u0629'), icon: <BarChart3 className="h-4 w-4" /> },
    { key: 'daily', label: t3('Tagesbericht', 'Daily Report', '\u062A\u0642\u0631\u064A\u0631 \u064A\u0648\u0645\u064A'), icon: <Calendar className="h-4 w-4" /> },
    { key: 'monthly', label: t3('Monatsbericht', 'Monthly Report', '\u062A\u0642\u0631\u064A\u0631 \u0634\u0647\u0631\u064A'), icon: <Receipt className="h-4 w-4" /> },
    { key: 'profit', label: t3('Produkte', 'Products', 'المنتجات'), icon: <Package className="h-4 w-4" /> },
    { key: 'vat', label: t3('MwSt', 'VAT', '\u0636\u0631\u064A\u0628\u0629'), icon: <Receipt className="h-4 w-4" /> },
    { key: 'bestsellers', label: t3('Bestseller', 'Bestsellers', '\u0627\u0644\u0623\u0643\u062B\u0631 \u0645\u0628\u064A\u0639\u0627'), icon: <Package className="h-4 w-4" /> },
    { key: 'customers', label: t3('Kunden', 'Customers', '\u0627\u0644\u0639\u0645\u0644\u0627\u0621'), icon: <Users className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-6">
      <AdminBreadcrumb items={[{ label: t3('Finanzen', 'Finance', '\u0627\u0644\u0645\u0627\u0644\u064A\u0629') }]} />
      <h1 className="text-2xl font-bold">{t3('Finanzbericht', 'Finance Dashboard', '\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0627\u0644\u064A\u0629')}</h1>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-[#d4a853] text-black shadow-md'
                : 'bg-[#1a1a2e] text-white/70 hover:text-white hover:bg-[#1a1a2e]/80'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab data={daily.data} isLoading={daily.isLoading} t3={t3} />}
      {tab === 'daily' && (
        <DailyTab data={daily.data} isLoading={daily.isLoading} date={dailyDate} setDate={setDailyDate} t3={t3} />
      )}
      {tab === 'monthly' && (
        <MonthlyTabV2 data={monthly.data} isLoading={monthly.isLoading}
          year={monthYear} setYear={setMonthYear} month={monthMonth} setMonth={setMonthMonth} t3={t3}
          onPdfExport={async () => {
            try {
              const store = useAuthStore.getState()
              const token = store.adminAccessToken || store.accessToken
              const base = API_BASE_URL + '/api/v1'
              const res = await fetch(`${base}/admin/finance/monthly/pdf?year=${monthYear}&month=${monthMonth}`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
              })
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = `Monatsbericht-${monthYear}-${String(monthMonth).padStart(2, '0')}.pdf`; a.click()
              URL.revokeObjectURL(url)
            } catch (e: any) { alert(t3('PDF-Download fehlgeschlagen', 'PDF download failed', 'فشل تحميل PDF') + (e?.message ? `: ${e.message}` : '')) }
          }}
          onCsvExport={() => {
            // Architectural contract: backend is single authority for tax/net.
            // See apps/web/src/lib/finance-display.ts. Forbidden pattern
            // (gross - net) replaced with direct reads of cur.tax + d.tax.
            const cur = monthly.data?.currentMonth ?? {}
            const daily: any[] = monthly.data?.dailyBreakdown ?? []
            const activeDays = daily.filter((d: any) => d.orderCount > 0)
            const display = deriveMonthlyDisplayValues(monthly.data)
            const tG = display.totalGross; const tN = display.totalNet; const tT = display.totalTax
            const header = 'Datum;Bestellungen;Brutto (EUR);Netto (EUR);USt (EUR)'
            const rows = activeDays.map((d: any) => { const g = Number(d.gross); const n = Number(d.net); const t = deriveDailyVatPerRow(d); return `${d.date};${d.orderCount};${g.toFixed(2).replace('.', ',')};${n.toFixed(2).replace('.', ',')};${t.toFixed(2).replace('.', ',')}` })
            rows.push(''); rows.push(`SUMME;${cur.orderCount ?? 0};${tG.toFixed(2).replace('.', ',')};${tN.toFixed(2).replace('.', ',')};${tT.toFixed(2).replace('.', ',')}`)
            const csv = '\uFEFF' + header + '\n' + rows.join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Monatsbericht-${monthYear}-${String(monthMonth).padStart(2, '0')}.csv`; a.click(); URL.revokeObjectURL(url)
          }}
        />
      )}
      {tab === 'profit' && (
        hasMargins
          ? <ProfitTab data={profit.data} isLoading={profit.isLoading}
              from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} t3={t3} />
          : <p className="text-muted-foreground py-12 text-center">{t3('Keine Berechtigung', 'No permission', '\u0644\u0627 \u062A\u0648\u062C\u062F \u0635\u0644\u0627\u062D\u064A\u0629')}</p>
      )}
      {tab === 'vat' && (
        <VatTab data={vat.data} isLoading={vat.isLoading}
          from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} t3={t3} />
      )}
      {tab === 'bestsellers' && (
        <BestsellersTab data={bestsellers.data} isLoading={bestsellers.isLoading}
          from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} t3={t3} />
      )}
      {tab === 'customers' && (
        <CustomersTab data={customers.data} isLoading={customers.isLoading}
          from={rangeFrom} to={rangeTo} setFrom={setRangeFrom} setTo={setRangeTo} t3={t3} />
      )}
    </div>
  )
}

/* ── Shared ──────────────────────────────────────────────────────────── */
type T3 = (d: string, e: string, a: string) => string

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse bg-muted rounded-xl" />)}
      </div>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-12 animate-pulse bg-muted rounded-lg" />)}
    </div>
  )
}

function KpiCard({ title, value, comparison, icon }: {
  title: string; value: string; comparison?: { label: string; up: boolean } | null; icon: React.ReactNode
}) {
  return (
    <div className="bg-[#1a1a2e] rounded-xl p-5 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white/60">{title}</span>
        <span className="text-[#d4a853]">{icon}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {comparison && (
        <span className={`text-xs font-medium flex items-center gap-0.5 mt-1 ${comparison.up ? 'text-green-400' : 'text-red-400'}`}>
          {comparison.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {comparison.label}
        </span>
      )}
    </div>
  )
}

function DateRange({ from, to, setFrom, setTo }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  // DateTimePicker returns "YYYY-MM-DDTHH:mm"; upstream callers only use the
  // date portion, so we strip the T* suffix when mirroring the value out,
  // and expand the stored date back to midnight when feeding it in.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[180px]">
        <DateTimePicker
          value={from ? `${from}T00:00` : ''}
          onChange={(v) => setFrom(v ? v.slice(0, 10) : '')}
          showTime={false}
        />
      </div>
      <span className="text-muted-foreground">-</span>
      <div className="min-w-[180px]">
        <DateTimePicker
          value={to ? `${to}T00:00` : ''}
          onChange={(v) => setTo(v ? v.slice(0, 10) : '')}
          showTime={false}
        />
      </div>
    </div>
  )
}

function ExportButtons({ onCsv }: { t3: T3; onCsv?: () => void }) {
  const activeCls = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
  return (
    <div className="flex gap-2">
      {onCsv && (
        <button onClick={onCsv} className={activeCls}><Download className="h-3.5 w-3.5" /> CSV</button>
      )}
      <button onClick={() => window.print()} className={activeCls}><Download className="h-3.5 w-3.5" /> PDF</button>
    </div>
  )
}

/* ── Overview (Premium Redesign) ─────────────────────────────────────── */
function OverviewTab({ data, isLoading, t3 }: { data: any; isLoading: boolean; t3: T3 }) {
  if (isLoading) return <Skeleton />
  const today = data?.todaySales ?? {}
  const yesterday = data?.yesterdaySales ?? {}
  const lastWeek = data?.lastWeekSameDaySales ?? {}
  const refunds = data?.refunds ?? {}
  const hourly: any[] = data?.hourlyBreakdown ?? []
  const methods: any[] = data?.byPaymentMethod ?? []
  const topProducts: any[] = data?.topProducts ?? []
  const channels: any[] = data?.byChannel ?? []
  const CHANNEL_LABELS: Record<string, string> = { website: 'Webshop', mobile: 'Mobile App', pos: 'POS', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google: 'Google', whatsapp: 'WhatsApp' }
  const MEDAL = ['#d4a853', '#94a3b8', '#b45309']

  return (
    <div className="space-y-5">
      {/* ── Row 1: KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title={t3('Umsatz heute', 'Revenue Today', 'إيرادات اليوم')}
          value={fmt(today.gross)} icon={<Euro className="h-5 w-5" />}
          comparison={pct(Number(today.gross ?? 0), Number(yesterday.gross ?? 0))} />
        <KpiCard title={t3('Bestellungen', 'Orders', 'الطلبات')}
          value={String(today.orderCount ?? 0)} icon={<ShoppingBag className="h-5 w-5" />}
          comparison={pct(Number(today.orderCount ?? 0), Number(yesterday.orderCount ?? 0))} />
        <KpiCard title={t3('Durchschn. Wert', 'Avg. Value', 'متوسط القيمة')}
          value={fmt(today.avgOrderValue)} icon={<ArrowUpDown className="h-5 w-5" />}
          comparison={pct(Number(today.avgOrderValue ?? 0), Number(yesterday.avgOrderValue ?? 0))} />
        <KpiCard title={t3('Netto', 'Net', 'صافي')}
          value={fmt(today.net)} icon={<Receipt className="h-5 w-5" />} />
      </div>

      {/* ── Row 2: Comparison Cards (richer) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-background border rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-0 ltr:left-0 rtl:right-0 w-1 h-full bg-muted-foreground/20 rounded-full" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t3('Gestern', 'Yesterday', 'أمس')}</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(yesterday.gross)}</p>
          <p className="text-xs text-muted-foreground mt-1">{yesterday.orderCount ?? 0} {t3('Bestellungen', 'orders', 'طلبات')} · Ø {fmt(yesterday.avgOrderValue)}</p>
        </div>
        <div className="bg-background border rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-0 ltr:left-0 rtl:right-0 w-1 h-full bg-[#d4a853]/40 rounded-full" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t3('Gleicher Tag letzte Woche', 'Same Day Last Week', 'نفس اليوم الأسبوع الماضي')}</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(lastWeek.gross)}</p>
          <p className="text-xs text-muted-foreground mt-1">{lastWeek.orderCount ?? 0} {t3('Bestellungen', 'orders', 'طلبات')} · Ø {fmt(lastWeek.avgOrderValue)}</p>
        </div>
        <div className="bg-background border rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-0 ltr:left-0 rtl:right-0 w-1 h-full bg-red-400/40 rounded-full" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{t3('Erstattungen', 'Refunds', 'المرتجعات')}</p>
          <p className="text-2xl font-bold tabular-nums text-red-500">{Number(refunds.total ?? 0) > 0 ? `- ${fmt(refunds.total)}` : '€0,00'}</p>
          <p className="text-xs text-muted-foreground mt-1">{refunds.count ?? 0} {t3('Erstattung(en)', 'refund(s)', 'مرتجع(ات)')}</p>
        </div>
      </div>

      {/* ── Row 3: Hourly Chart (full width, taller) ── */}
      <div className="bg-background border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-1 w-4 rounded-full bg-[#d4a853]" />
            <h3 className="text-sm font-bold">{t3('Umsatz nach Stunde', 'Hourly Revenue', 'الإيرادات حسب الساعة')}</h3>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t3('Heute', 'Today', 'اليوم')}</span>
        </div>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: '#888', fontSize: 10 }} tickFormatter={(h) => `${h}:00`} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#888', fontSize: 10 }} tickFormatter={(v) => `€${v}`} width={50} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(212,168,83,0.08)' }} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} formatter={(v: any) => [`€${Number(v).toFixed(2)}`, t3('Umsatz', 'Revenue', 'إيرادات')]} />
              <Bar dataKey="gross" fill="#d4a853" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-sm text-muted-foreground text-center py-16">{t3('Keine Daten', 'No data', 'لا توجد بيانات')}</p>}
      </div>

      {/* ── Row 4: Payment Methods + Channels (side by side, richer) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Payment Methods */}
        <div className="bg-background border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-4 rounded-full bg-blue-500" />
            <h3 className="text-sm font-bold">{t3('Zahlungsarten', 'Payment Methods', 'طرق الدفع')}</h3>
          </div>
          {methods.length > 0 ? (
            <div className="space-y-3">
              {methods.sort((a: any, b: any) => Number(b.gross) - Number(a.gross)).map((m: any) => {
                const total = methods.reduce((s: number, x: any) => s + Number(x.gross ?? 0), 0)
                const pctVal = total > 0 ? (Number(m.gross) / total * 100) : 0
                const pm = PAYMENT_LABELS[m.method]
                return (
                  <div key={m.method} className="group">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${pm?.color ?? 'bg-muted text-muted-foreground border-muted'} border`}>
                          {pm?.icon} {pm?.label ?? m.method}
                        </span>
                        <span className="text-xs text-muted-foreground">{m.count} {t3('Zahlung(en)', 'payment(s)', 'عملية')}</span>
                      </div>
                      <span className="text-sm tabular-nums font-bold">{fmt(m.gross)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-[#d4a853] rounded-full transition-all duration-500" style={{ width: `${pctVal}%` }} />
                    </div>
                    <div className="text-end mt-0.5">
                      <span className="text-[10px] text-muted-foreground tabular-nums">{pctVal.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground text-center py-10">{t3('Keine Zahlungen', 'No payments', 'لا توجد مدفوعات')}</p>}
        </div>

        {/* Channels */}
        <div className="bg-background border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-4 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold">{t3('Verkaufskanäle', 'Sales Channels', 'قنوات البيع')}</h3>
          </div>
          {channels.length > 0 ? (
            <div className="space-y-3">
              {channels.sort((a: any, b: any) => Number(b.gross) - Number(a.gross)).map((c: any) => {
                const total = channels.reduce((s: number, x: any) => s + Number(x.gross ?? 0), 0)
                const pctVal = total > 0 ? (Number(c.gross) / total * 100) : 0
                return (
                  <div key={c.channel} className="group">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-semibold">{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                        <span className="text-xs text-muted-foreground">{c.count} {t3('Bestell.', 'orders', 'طلب')}</span>
                      </div>
                      <span className="text-sm tabular-nums font-bold">{fmt(c.gross)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pctVal}%` }} />
                    </div>
                    <div className="text-end mt-0.5">
                      <span className="text-[10px] text-muted-foreground tabular-nums">{pctVal.toFixed(1)}% · Ø {fmt(c.avgOrderValue)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground text-center py-10">{t3('Keine Kanäle', 'No channels', 'لا توجد قنوات')}</p>}
        </div>
      </div>

      {/* ── Row 5: Top Products (premium cards with rank medals) ── */}
      {topProducts.length > 0 && (
        <div className="bg-background border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-4 rounded-full bg-[#d4a853]" />
            <h3 className="text-sm font-bold">{t3('Top Produkte heute', 'Top Products Today', 'أفضل المنتجات اليوم')}</h3>
          </div>
          <div className="space-y-2">
            {topProducts.slice(0, 5).map((p: any, i: number) => {
              const maxRev = Number(topProducts[0]?.revenue ?? 1)
              const barW = maxRev > 0 ? (Number(p.revenue) / maxRev * 100) : 0
              return (
                <div key={i} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-muted/40 transition-colors">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: i < 3 ? `${MEDAL[i]}20` : '#f1f5f9', color: i < 3 ? MEDAL[i] : '#64748b' }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name ?? p.sku}</p>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, backgroundColor: i < 3 ? MEDAL[i] : '#94a3b8' }} />
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <p className="text-sm font-bold tabular-nums">{fmt(p.revenue)}</p>
                    <p className="text-[10px] text-muted-foreground">{p.quantity}× {t3('verkauft', 'sold', 'مبيع')}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Daily — Komplett mit Chart, Top-Produkte, Kanäle ──────────────── */
function DailyTab({ data, isLoading, date, setDate, t3 }: {
  data: any; isLoading: boolean; date: string; setDate: (v: string) => void; t3: T3
}) {
  if (isLoading) return <Skeleton />
  const today = data?.todaySales ?? {}
  const yesterday = data?.yesterdaySales ?? {}
  const lastWeek = data?.lastWeekSameDaySales ?? {}
  const methods: any[] = data?.byPaymentMethod ?? []
  const hourly: any[] = data?.hourlyBreakdown ?? []
  const topProducts: any[] = data?.topProducts ?? []
  const channels: any[] = data?.byChannel ?? []
  const methodsTotal = methods.reduce((s: number, x: any) => s + Number(x.gross ?? 0), 0)
  const channelsTotal = channels.reduce((s: number, x: any) => s + Number(x.gross ?? 0), 0)

  const CHANNEL_LABELS: Record<string, string> = { website: 'Website', mobile: 'Mobile App', pos: 'Shopify POS', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google: 'Google Shopping', whatsapp: 'WhatsApp' }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[200px]">
          <DateTimePicker
            value={date ? `${date}T00:00` : ''}
            onChange={(v) => setDate(v ? v.slice(0, 10) : '')}
            showTime={false}
          />
        </div>
        <ExportButtons t3={t3} onCsv={() => downloadDataAsCsv(data, `Tagesbericht-${date}.csv`)} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title={t3('Brutto', 'Gross', 'إجمالي')} value={fmt(today.gross)} icon={<Euro className="h-5 w-5" />}
          comparison={pct(Number(today.gross ?? 0), Number(yesterday.gross ?? 0))} />
        <KpiCard title={t3('Netto', 'Net', 'صافي')} value={fmt(today.net)} icon={<Euro className="h-5 w-5" />} />
        <KpiCard title={t3('Bestellungen', 'Orders', 'الطلبات')} value={String(today.orderCount ?? 0)} icon={<ShoppingBag className="h-5 w-5" />}
          comparison={pct(Number(today.orderCount ?? 0), Number(yesterday.orderCount ?? 0))} />
        <KpiCard title={t3('Durchschn.', 'Avg. Value', 'المتوسط')} value={fmt(today.avgOrderValue)} icon={<ArrowUpDown className="h-5 w-5" />}
          comparison={pct(Number(today.avgOrderValue ?? 0), Number(lastWeek.avgOrderValue ?? 0))} />
      </div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ComparisonCard label={t3('vs. Gestern', 'vs. Yesterday', 'مقارنة بالأمس')}
          current={Number(today.gross ?? 0)} previous={Number(yesterday.gross ?? 0)} />
        <ComparisonCard label={t3('vs. Gleicher Tag letzte Woche', 'vs. Same Day Last Week', 'مقارنة بنفس اليوم الأسبوع الماضي')}
          current={Number(today.gross ?? 0)} previous={Number(lastWeek.gross ?? 0)} />
      </div>

      {/* Hourly Revenue Chart */}
      {hourly.length > 0 && (
        <div className="bg-[#1a1a2e] rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">{t3('Umsatz nach Uhrzeit', 'Revenue by Hour', 'الإيرادات حسب الساعة')}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="hour" tick={{ fill: '#ffffff60', fontSize: 11 }} tickFormatter={(h) => `${h}:00`} />
              <YAxis tick={{ fill: '#ffffff40', fontSize: 10 }} tickFormatter={(v) => `€${v}`} width={55} />
              <Tooltip
                contentStyle={{ backgroundColor: '#2a2a4e', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12 }}
                labelFormatter={(h) => `${h}:00 - ${Number(h) + 1}:00`}
                formatter={(v: any) => [`€${Number(v ?? 0).toFixed(2)}`, t3('Umsatz', 'Revenue', 'الإيراد')]}
              />
              <Bar dataKey="gross" fill="#d4a853" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Methods */}
        {methods.length > 0 && (
          <div className="bg-background border rounded-xl overflow-hidden">
            <h3 className="font-semibold text-sm p-4 border-b">{t3('Zahlungsarten', 'Payment Methods', 'طرق الدفع')}</h3>
            <div className="p-4 space-y-3">
              {methods.map((m: any, i: number) => {
                const pm = PAYMENT_LABELS[m.method] ?? { label: m.method, icon: '💰', color: 'bg-muted text-muted-foreground border-muted' }
                const pctVal = methodsTotal > 0 ? (Number(m.gross ?? 0) / methodsTotal) * 100 : 0
                return (
                  <div key={i} className="bg-muted/30 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${pm.color}`}>
                        <span>{pm.icon}</span><span>{pm.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold tabular-nums">{fmt(m.gross)}</span>
                        <span className="text-xs text-muted-foreground">{m.count} {t3('Bestellung' + (m.count !== 1 ? 'en' : ''), 'order' + (m.count !== 1 ? 's' : ''), m.count !== 1 ? 'طلبات' : 'طلب')}</span>
                        <span className="text-xs font-semibold text-[#d4a853] tabular-nums w-10 text-end">{pctVal.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-[#d4a853] rounded-full transition-all" style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Channel Breakdown */}
        {channels.length > 0 && (
          <div className="bg-background border rounded-xl overflow-hidden">
            <h3 className="font-semibold text-sm p-4 border-b">{t3('Kanäle', 'Channels', 'القنوات')}</h3>
            <div className="p-4 space-y-3">
              {channels.map((c: any, i: number) => {
                const pctVal = channelsTotal > 0 ? (Number(c.gross ?? 0) / channelsTotal) * 100 : 0
                return (
                  <div key={i} className="bg-muted/30 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border text-sm font-medium">
                        <Globe className="h-3.5 w-3.5" /><span>{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold tabular-nums">{fmt(c.gross)}</span>
                        <span className="text-xs text-muted-foreground">{c.count} {t3('Best.', 'orders', 'طلب')}</span>
                        <span className="text-xs font-semibold text-[#d4a853] tabular-nums w-10 text-end">{pctVal.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pctVal}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top 5 Products */}
      {topProducts.length > 0 && (
        <div className="bg-background border rounded-xl overflow-hidden">
          <h3 className="font-semibold text-sm p-4 border-b">{t3('Top 5 Produkte', 'Top 5 Products', 'أفضل 5 منتجات')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '50%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '30%' }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t3('Produkt', 'Product', 'المنتج')}</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Menge', 'Qty', 'الكمية')}</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Umsatz', 'Revenue', 'الإيراد')}</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p: any, i: number) => (
                  <tr key={i} className={`border-b hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'bg-muted/20' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground ltr:ml-2 rtl:mr-2">{p.sku}</span>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{p.quantity}</td>
                    <td className="px-4 py-3 text-end tabular-nums font-medium">{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ComparisonCard({ label, current, previous }: { label: string; current: number; previous: number }) {
  const diff = previous ? ((current - previous) / previous) * 100 : 0
  const up = diff >= 0
  return (
    <div className="bg-background border rounded-xl p-4 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium">{fmt(previous)}</span>
        <span className="text-lg">&#8594;</span>
        <span className="font-bold">{fmt(current)}</span>
        <span className={`text-xs font-medium flex items-center gap-0.5 ${up ? 'text-green-500' : 'text-red-500'}`}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {diff.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}


/* ── Monthly — Professioneller Monatsbericht (BWA-Style) ─────────────── */
/* ── Profit ──────────────────────────────────────────────────────────── */
function ProfitTab({ data, isLoading, from, to, setFrom, setTo, t3 }: {
  data: any; isLoading: boolean; from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void; t3: T3
}) {
  if (isLoading) return <Skeleton rows={6} />
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButtons t3={t3} onCsv={() => downloadDataAsCsv(data, 'Finanzbericht.json')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <KpiCard title={t3('Gesamtumsatz', 'Total Revenue', 'إجمالي الإيرادات')}
          value={fmt(data?.totalRevenue)} icon={<Euro className="h-5 w-5" />} />
        <KpiCard title={t3('Produkte verkauft', 'Products Sold', 'منتجات مباعة')}
          value={String((data?.topProducts?.length ?? 0) + (data?.bottomProducts?.length ?? 0))} icon={<Package className="h-5 w-5" />} />
      </div>
      <ProductProfitTable title={t3('Top 10 Produkte nach Umsatz', 'Top 10 Products by Revenue', 'أفضل 10 منتجات حسب الإيراد')}
        items={data?.topProducts ?? []} t3={t3} />
    </div>
  )
}

function ProductProfitTable({ title, items, t3 }: { title: string; items: any[]; t3: T3 }) {
  if (!items.length) return null
  const cols = 'grid grid-cols-3 gap-x-2'
  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <h3 className="font-semibold p-4 border-b">{title}</h3>
      <div className={`${cols} bg-muted/50 border-b`}>
        <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Produkt', 'Product', 'المنتج')}</div>
        <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Umsatz', 'Revenue', 'الإيراد')}</div>
        <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Menge', 'Quantity', 'الكمية')}</div>
      </div>
      {items.map((p: any, i: number) => (
        <div key={i} className={`${cols} border-b hover:bg-muted/30 transition-colors items-center`}>
          <div className="px-4 py-3 text-sm font-medium">{p.productName}</div>
          <div className="px-4 py-3 text-sm tabular-nums text-center">{fmt(p.revenue)}</div>
          <div className="px-4 py-3 text-sm tabular-nums text-center">{p.quantitySold ?? p.quantity ?? '—'}</div>
        </div>
      ))}
    </div>
  )
}

/* ── VAT ─────────────────────────────────────────────────────────────── */
function VatTab({ data, isLoading, from, to, setFrom, setTo, t3 }: {
  data: any; isLoading: boolean; from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void; t3: T3
}) {
  if (isLoading) return <Skeleton rows={3} />
  // Backend returns vatLines (one row per tax rate), totalTax (net of
  // refunds), and refunds.grossAmount. Previously the frontend read
  // data?.rates / data?.grossRevenue / data?.totalGross — all of which
  // don't exist in the response — so the table synthesized a fake row
  // with gross=0 and net=0 while the tax card pulled the real totalTax.
  // Result: visually impossible "€3060 VAT on €0 gross" that the admin
  // spotted in ORD-20260420-000001.
  const vatLines = Array.isArray(data?.vatLines) ? data.vatLines : []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButtons t3={t3} onCsv={() => downloadDataAsCsv(data, 'Finanzbericht.json')} />
      </div>
      {(() => {
        const totalTax = Number(data?.totalTax ?? 0)
        // Gross + net derived from the per-rate lines the backend sends.
        // Refunds are already subtracted from totalTax by the backend
        // but NOT from per-line grossAmount (those are sales-side only),
        // so we subtract refund gross here for a consistent trio.
        const grossSales = vatLines.reduce((s: number, l: any) => s + Number(l.grossAmount ?? 0), 0)
        const refundGross = Number(data?.refunds?.grossAmount ?? 0)
        const gross = Math.max(0, grossSales - refundGross)
        const net = Math.max(0, gross - totalTax)
        const displayRates = vatLines.length > 0
          ? vatLines
          : (totalTax > 0 ? [{ rate: 19, taxableAmount: net, taxAmount: totalTax, grossAmount: gross }] : [])

        return (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden">
              <div className="bg-[#1a1a2e] p-5 text-white">
                <p className="text-xs text-white/50 mb-1">{t3('Bruttoerlöse', 'Gross Revenue', 'إجمالي الإيرادات')}</p>
                <p className="text-xl font-bold tabular-nums">{fmt(gross)}</p>
              </div>
              <div className="bg-[#1a1a2e] p-5 text-white">
                <p className="text-xs text-white/50 mb-1">{t3('Nettoerlöse', 'Net Revenue', 'صافي الإيرادات')}</p>
                <p className="text-xl font-bold tabular-nums">{fmt(net)}</p>
              </div>
              <div className="bg-[#1a1a2e] p-5 text-white">
                <p className="text-xs text-white/50 mb-1">{t3('MwSt gesamt', 'Total VAT', 'إجمالي الضريبة')}</p>
                <p className="text-xl font-bold tabular-nums text-[#d4a853]">{fmt(totalTax)}</p>
              </div>
            </div>

            {/* Tax Table */}
            {displayRates.length > 0 && (
              <div className="bg-background border rounded-xl overflow-hidden">
                <div className="grid grid-cols-4 gap-x-2 bg-muted/50 border-b">
                  <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Steuersatz', 'Tax Rate', 'معدل الضريبة')}</div>
                  <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Nettobetrag', 'Net Amount', 'المبلغ الصافي')}</div>
                  <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Steuerbetrag', 'Tax Amount', 'مبلغ الضريبة')}</div>
                  <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Bruttobetrag', 'Gross Amount', 'المبلغ الإجمالي')}</div>
                </div>
                {displayRates.map((r: any, i: number) => (
                  <div key={i} className="grid grid-cols-4 gap-x-2 border-b hover:bg-muted/30 transition-colors items-center">
                    <div className="px-4 py-3 text-sm font-semibold">{r.rate}%</div>
                    <div className="px-4 py-3 text-sm tabular-nums text-center">{fmt(r.taxableAmount)}</div>
                    <div className="px-4 py-3 text-sm tabular-nums text-center font-medium text-[#d4a853]">{fmt(r.taxAmount)}</div>
                    <div className="px-4 py-3 text-sm tabular-nums text-center">{fmt(r.grossAmount)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Info */}
            <div className="bg-muted/30 rounded-xl p-4 text-sm text-muted-foreground">
              {t3(
                'Die MwSt wird aus den Bruttopreisen herausgerechnet (nicht draufaddiert). Formel: Brutto - (Brutto / 1,19) = enthaltene MwSt.',
                'VAT is extracted from gross prices (not added on top). Formula: Gross - (Gross / 1.19) = included VAT.',
                'يتم استخراج الضريبة من الأسعار الإجمالية (لا تُضاف فوقها). المعادلة: إجمالي - (إجمالي / 1.19) = الضريبة المتضمنة.'
              )}
            </div>
          </>
        )
      })()}
    </div>
  )
}

/* ── Bestsellers ─────────────────────────────────────────────────────── */
function BestsellersTab({ data, isLoading, from, to, setFrom, setTo, t3 }: {
  data: any; isLoading: boolean; from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void; t3: T3
}) {
  if (isLoading) return <Skeleton rows={6} />
  const items = data?.data ?? []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButtons t3={t3} onCsv={() => downloadDataAsCsv(data, 'Finanzbericht.json')} />
      </div>
      {items.length > 0 ? (
        <div className="bg-background border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '8%' }} />
                <col style={{ width: '32%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '22%' }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-start px-4 py-3 text-sm font-semibold">#</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">{t3('Produkt', 'Product', '\u0627\u0644\u0645\u0646\u062A\u062C')}</th>
                  <th className="text-start px-4 py-3 text-sm font-semibold">SKU</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Menge', 'Qty Sold', '\u0627\u0644\u0643\u0645\u064A\u0629')}</th>
                  <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Umsatz', 'Revenue', '\u0627\u0644\u0625\u064A\u0631\u0627\u062F')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{p.productName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{p.quantitySold}</td>
                    <td className="px-4 py-3 text-end tabular-nums font-medium">{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-12">{t3('Keine Daten', 'No data', '\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A')}</p>
      )}
    </div>
  )
}

/* ── Customers ───────────────────────────────────────────────────────── */
function CustomersTab({ data, isLoading, from, to, setFrom, setTo, t3 }: {
  data: any; isLoading: boolean; from: string; to: string
  setFrom: (v: string) => void; setTo: (v: string) => void; t3: T3
}) {
  if (isLoading) return <Skeleton rows={6} />
  const topCustomers = data?.topCustomers ?? []
  const newVsRet = data?.newVsReturning ?? {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportButtons t3={t3} onCsv={() => downloadDataAsCsv(data, 'Finanzbericht.json')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#1a1a2e] rounded-xl p-5 text-white">
          <span className="text-sm text-white/60">{t3('Neukunden', 'New Customers', '\u0639\u0645\u0644\u0627\u0621 \u062C\u062F\u062F')}</span>
          <p className="text-2xl font-bold mt-1">{newVsRet.newCustomers ?? 0}</p>
        </div>
        <div className="bg-[#1a1a2e] rounded-xl p-5 text-white">
          <span className="text-sm text-white/60">{t3('Wiederkehrende', 'Returning', '\u0639\u0627\u0626\u062F\u0648\u0646')}</span>
          <p className="text-2xl font-bold mt-1">{newVsRet.returningCustomers ?? 0}</p>
        </div>
      </div>
      {topCustomers.length > 0 ? (
        <div className="bg-background border rounded-xl overflow-hidden">
          <h3 className="font-semibold p-4 border-b">{t3('Top-Kunden', 'Top Customers', 'أفضل العملاء')}</h3>
          {/* Header */}
          <div className="grid grid-cols-5 gap-x-2 bg-muted/50 border-b">
            <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Name', 'Name', 'الاسم')}</div>
            <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('E-Mail', 'Email', 'البريد')}</div>
            <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Bestellungen', 'Orders', 'الطلبات')}</div>
            <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Gesamtausgaben', 'Total Spent', 'إجمالي الإنفاق')}</div>
            <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Durchschn.', 'Avg. Order', 'المتوسط')}</div>
          </div>
          {/* Rows */}
          {topCustomers.map((c: any, i: number) => (
            <div key={i} className="grid grid-cols-5 gap-x-2 border-b hover:bg-muted/30 transition-colors items-center">
              <div className="px-4 py-3 text-sm font-medium text-center">{c.firstName} {c.lastName}</div>
              <div className="px-4 py-3 text-sm text-muted-foreground text-center" dir="ltr">{c.email}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{c.orderCount}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center font-medium">{fmt(c.totalSpent)}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{fmt(c.avgOrderValue)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-12">{t3('Keine Daten', 'No data', 'لا توجد بيانات')}</p>
      )}
    </div>
  )
}
