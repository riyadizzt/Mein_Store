'use client'

import { deriveMonthlyDisplayValues, deriveDailyVatPerRow } from '@/lib/finance-display'

type T3 = (de: string, en: string, ar: string) => string

function fmtNum(v: number): string {
  return v.toFixed(2).replace('.', ',') + ' €'
}

export function MonthlyTabV2({ data, isLoading, year, setYear, month, setMonth, t3, onCsvExport, onPdfExport }: {
  data: any; isLoading: boolean; year: number; setYear: (v: number) => void
  month: number; setMonth: (v: number) => void; t3: T3; onCsvExport: () => void; onPdfExport?: () => void
}) {
  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>

  const cur = data?.currentMonth ?? {}
  const daily: any[] = data?.dailyBreakdown ?? []
  const activeDays = daily.filter((d: any) => d.orderCount > 0)
  // Architectural contract: backend is single authority for tax / net.
  // See apps/web/src/lib/finance-display.ts. Local `gross - net` derivation
  // is forbidden — it silently produces phantom VAT once refunds are
  // applied (the tax-phantom bug discovered in Mai 2026).
  const display = deriveMonthlyDisplayValues(data)
  const totalGross = display.totalGross
  const totalNet = display.totalNet
  const totalTax = display.totalTax
  const refunds = display.refunds
  const monthNames = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

  const gridCols5 = 'grid grid-cols-5 gap-x-2'
  const gridCols2 = 'grid grid-cols-[1fr_auto] gap-x-4'

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-background border rounded-lg px-3 py-2 text-sm">
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="bg-background border rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={onCsvExport} className="h-9 px-4 rounded-lg border bg-background text-sm hover:bg-muted transition-colors">CSV</button>
          {onPdfExport && <button onClick={onPdfExport} className="h-9 px-4 rounded-lg bg-[#d4a853] text-white text-sm font-semibold hover:bg-[#c49843] transition-colors">PDF</button>}
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <h2 className="text-xl font-bold">{t3('Monatliche Umsatzübersicht', 'Monthly Revenue Report', 'تقرير الإيرادات الشهري')}</h2>
        <p className="text-muted-foreground">{monthNames[month]} {year}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden">
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('Bruttoerlöse', 'Gross Revenue', 'إجمالي الإيرادات')}</p>
          <p className="text-lg font-bold tabular-nums">€{totalGross.toFixed(2)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('Nettoerlöse', 'Net Revenue', 'صافي الإيرادات')}</p>
          <p className="text-lg font-bold tabular-nums">€{totalNet.toFixed(2)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('USt 19%', 'VAT 19%', 'ضريبة 19%')}</p>
          <p className="text-lg font-bold tabular-nums">€{totalTax.toFixed(2)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('Bestellungen', 'Orders', 'الطلبات')}</p>
          <p className="text-lg font-bold tabular-nums">{cur.orderCount ?? 0}</p>
        </div>
      </div>

      {/* ═══ DAILY BREAKDOWN — CSS Grid ═══ */}
      <h3 className="text-sm font-semibold text-muted-foreground">{t3('Tägliche Umsatzübersicht', 'Daily Revenue Breakdown', 'التفاصيل اليومية')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden">
        {/* Header */}
        <div className={`${gridCols5} bg-muted/50 border-b`}>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Datum', 'Date', 'التاريخ')}</div>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Anz.', 'Qty', 'عدد')}</div>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Brutto', 'Gross', 'إجمالي')}</div>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Netto', 'Net', 'صافي')}</div>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('USt', 'VAT', 'ضريبة')}</div>
        </div>
        {/* Rows */}
        {activeDays.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">{t3('Keine Daten', 'No data', 'لا توجد بيانات')}</div>
        ) : (
          <>
            {activeDays.map((d: any) => {
              const g = Number(d.gross); const n = Number(d.net); const vat = deriveDailyVatPerRow(d)
              return (
                <div key={d.date} className={`${gridCols5} border-b hover:bg-muted/30 transition-colors items-center`}>
                  <div className="px-4 py-3 text-sm tabular-nums text-center">{d.date.split('-').reverse().join('.')}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center">{d.orderCount}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center font-medium">{fmtNum(g)}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center">{fmtNum(n)}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center text-muted-foreground">{fmtNum(vat)}</div>
                </div>
              )
            })}
            {/* Total */}
            <div className={`${gridCols5} bg-muted/50 font-bold items-center`}>
              <div className="px-4 py-3 text-sm text-center">{t3('SUMME', 'TOTAL', 'المجموع')}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{cur.orderCount ?? 0}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{fmtNum(totalGross)}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{fmtNum(totalNet)}</div>
              <div className="px-4 py-3 text-sm tabular-nums text-center">{fmtNum(totalTax)}</div>
            </div>
          </>
        )}
      </div>

      {/* ═══ MONTHLY SUMMARY — CSS Grid 2 cols ═══ */}
      <h3 className="text-sm font-semibold text-muted-foreground">{t3('Monatszusammenfassung', 'Monthly Summary', 'ملخص الشهر')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className={`${gridCols2} bg-muted/50 border-b`}>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Position', 'Item', 'البند')}</div>
          <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-end">{t3('Betrag', 'Amount', 'المبلغ')}</div>
        </div>
        <div className={`${gridCols2} border-b hover:bg-muted/30 transition-colors`}>
          <div className="px-4 py-3 text-sm">{t3('Bruttoerlöse gesamt', 'Total Gross Revenue', 'إجمالي الإيرادات')}</div>
          <div className="px-4 py-3 text-sm text-end font-medium tabular-nums">{fmtNum(totalGross)}</div>
        </div>
        {refunds > 0 && (
          <div className={`${gridCols2} border-b hover:bg-muted/30 transition-colors`}>
            <div className="px-4 py-3 text-sm text-red-600">{t3('./. Retouren/Stornierungen', 'Less Returns/Cancellations', 'ناقص المرتجعات')}</div>
            <div className="px-4 py-3 text-sm text-end font-medium tabular-nums text-red-600">-{fmtNum(refunds)}</div>
          </div>
        )}
        <div className={`${gridCols2} border-b bg-muted/30`}>
          <div className="px-4 py-3 text-sm font-semibold">{t3('= Netto-Bruttoerlöse', '= Net Gross Revenue', '= صافي الإيرادات الإجمالية')}</div>
          <div className="px-4 py-3 text-sm text-end font-bold tabular-nums">{fmtNum(totalGross - refunds)}</div>
        </div>
        <div className={`${gridCols2} border-b hover:bg-muted/30 transition-colors`}>
          <div className="px-4 py-3 text-sm">{t3('Nettoerlöse (ohne USt)', 'Net Revenue (excl. VAT)', 'صافي الإيرادات (بدون ضريبة)')}</div>
          <div className="px-4 py-3 text-sm text-end tabular-nums">{fmtNum(totalNet)}</div>
        </div>
        <div className={`${gridCols2} border-b hover:bg-muted/30 transition-colors`}>
          <div className="px-4 py-3 text-sm">{t3('USt 19% (Ausgangs-USt)', 'VAT 19% (Output VAT)', 'ضريبة 19% (مخرجات)')}</div>
          <div className="px-4 py-3 text-sm text-end tabular-nums">{fmtNum(totalTax)}</div>
        </div>
        <div className={`${gridCols2} bg-[#1a1a2e] text-white`}>
          <div className="px-4 py-3 text-sm font-bold">{t3('USt-Zahllast (an Finanzamt)', 'VAT Payable (to Tax Office)', 'ضريبة مستحقة (لمكتب الضرائب)')}</div>
          <div className="px-4 py-3 text-sm text-end font-bold tabular-nums text-[#d4a853]">{fmtNum(totalTax)}</div>
        </div>
      </div>

      {/* Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">{t3('Vormonat', 'Previous Month', 'الشهر السابق')}</p>
          <p className="font-bold tabular-nums">€{Number(data?.previousMonth?.gross ?? 0).toFixed(2)}</p>
        </div>
        <div className="border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">{t3('Gleicher Monat Vorjahr', 'Same Month Last Year', 'نفس الشهر العام الماضي')}</p>
          <p className="font-bold tabular-nums">€{Number(data?.sameMonthLastYear?.gross ?? 0).toFixed(2)}</p>
        </div>
      </div>

      {/* ═══ CHANNEL BREAKDOWN — CSS Grid ═══ */}
      {data?.byChannel?.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground">{t3('Umsatz nach Kanal', 'Revenue by Channel', 'الإيرادات حسب القناة')}</h3>
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className={`${gridCols5} bg-muted/50 border-b`}>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground">{t3('Kanal', 'Channel', 'القناة')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Bestellungen', 'Orders', 'الطلبات')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Umsatz', 'Revenue', 'الإيرادات')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Ø Wert', 'Avg.', 'متوسط')}</div>
              <div className="px-4 py-3 text-sm font-semibold text-muted-foreground text-center">{t3('Anteil', 'Share', 'الحصة')}</div>
            </div>
            {[...data.byChannel].sort((a: any, b: any) => Number(b.gross) - Number(a.gross)).map((ch: any) => {
              const share = totalGross > 0 ? ((Number(ch.gross) / totalGross) * 100).toFixed(1) : '0.0'
              return (
                <div key={ch.channel} className={`${gridCols5} border-b hover:bg-muted/30 transition-colors items-center`}>
                  <div className="px-4 py-3 text-sm font-medium capitalize">{ch.channel}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center">{ch.count}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center font-medium">{fmtNum(Number(ch.gross))}</div>
                  <div className="px-4 py-3 text-sm tabular-nums text-center">{fmtNum(Number(ch.avgOrderValue ?? 0))}</div>
                  <div className="px-4 py-3 text-sm text-center">{share}%</div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
