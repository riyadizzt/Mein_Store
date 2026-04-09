'use client'

type T3 = (de: string, en: string, ar: string) => string

function fmtNum(v: number): string {
  return v.toFixed(2).replace('.', ',') + ' €'
}

export function MonthlyTabV2({ data, isLoading, year, setYear, month, setMonth, t3, onCsvExport }: {
  data: any; isLoading: boolean; year: number; setYear: (v: number) => void
  month: number; setMonth: (v: number) => void; t3: T3; onCsvExport: () => void
}) {
  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>

  const cur = data?.currentMonth ?? {}
  const daily: any[] = data?.dailyBreakdown ?? []
  const activeDays = daily.filter((d: any) => d.orderCount > 0)
  const totalGross = Number(cur.gross ?? 0)
  const totalNet = Number(cur.net ?? 0)
  const totalTax = totalGross - totalNet
  const refunds = Number(data?.refundsTotal ?? 0)
  const monthNames = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

  // Shared cell classes
  const thCls = 'px-4 py-3 text-sm font-semibold text-muted-foreground whitespace-nowrap'
  const tdCls = 'px-4 py-3 text-sm tabular-nums whitespace-nowrap'

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
        <button onClick={onCsvExport} className="h-9 px-4 rounded-lg border bg-background text-sm hover:bg-muted transition-colors">CSV</button>
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

      {/* ═══ DAILY TABLE ═══ */}
      <h3 className="text-sm font-semibold text-muted-foreground">{t3('Tägliche Umsatzübersicht', 'Daily Revenue Breakdown', 'التفاصيل اليومية')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className={`text-center ${thCls}`}>{t3('Datum', 'Date', 'التاريخ')}</th>
              <th className={`text-center ${thCls}`}>{t3('Anz.', 'Qty', 'عدد')}</th>
              <th className={`text-center ${thCls}`}>{t3('Brutto', 'Gross', 'إجمالي')}</th>
              <th className={`text-center ${thCls}`}>{t3('Netto', 'Net', 'صافي')}</th>
              <th className={`text-center ${thCls}`}>{t3('USt', 'VAT', 'ضريبة')}</th>
            </tr>
          </thead>
          <tbody>
            {activeDays.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t3('Keine Daten', 'No data', 'لا توجد بيانات')}</td></tr>
            ) : (
              <>
                {activeDays.map((d: any) => {
                  const g = Number(d.gross); const n = Number(d.net); const vat = g - n
                  return (
                    <tr key={d.date} className="border-b hover:bg-muted/30 transition-colors">
                      <td className={`text-center ${tdCls}`}>{d.date.split('-').reverse().join('.')}</td>
                      <td className={`text-center ${tdCls}`}>{d.orderCount}</td>
                      <td className={`text-center ${tdCls} font-medium`}>{fmtNum(g)}</td>
                      <td className={`text-center ${tdCls}`}>{fmtNum(n)}</td>
                      <td className={`text-center ${tdCls} text-muted-foreground`}>{fmtNum(vat)}</td>
                    </tr>
                  )
                })}
                <tr className="bg-muted/50 font-bold">
                  <td className={`text-center ${tdCls}`}>{t3('SUMME', 'TOTAL', 'المجموع')}</td>
                  <td className={`text-center ${tdCls}`}>{cur.orderCount ?? 0}</td>
                  <td className={`text-center ${tdCls}`}>{fmtNum(totalGross)}</td>
                  <td className={`text-center ${tdCls}`}>{fmtNum(totalNet)}</td>
                  <td className={`text-center ${tdCls}`}>{fmtNum(totalTax)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ MONTHLY SUMMARY ═══ */}
      <h3 className="text-sm font-semibold text-muted-foreground">{t3('Monatszusammenfassung', 'Monthly Summary', 'ملخص الشهر')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className={`text-start ${thCls}`}>{t3('Position', 'Item', 'البند')}</th>
              <th className={`text-end ${thCls}`}>{t3('Betrag', 'Amount', 'المبلغ')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b hover:bg-muted/30"><td className="px-4 py-3">{t3('Bruttoerlöse gesamt', 'Total Gross Revenue', 'إجمالي الإيرادات')}</td><td className="px-4 py-3 text-end font-medium tabular-nums">{fmtNum(totalGross)}</td></tr>
            {refunds > 0 && <tr className="border-b hover:bg-muted/30"><td className="px-4 py-3 text-red-600">{t3('./. Retouren', 'Less Returns', 'ناقص المرتجعات')}</td><td className="px-4 py-3 text-end font-medium tabular-nums text-red-600">-{fmtNum(refunds)}</td></tr>}
            <tr className="border-b bg-muted/30"><td className="px-4 py-3 font-semibold">{t3('= Netto-Bruttoerlöse', '= Net Gross Revenue', '= صافي الإيرادات الإجمالية')}</td><td className="px-4 py-3 text-end font-bold tabular-nums">{fmtNum(totalGross - refunds)}</td></tr>
            <tr className="border-b hover:bg-muted/30"><td className="px-4 py-3">{t3('Nettoerlöse (ohne USt)', 'Net Revenue (excl. VAT)', 'صافي الإيرادات (بدون ضريبة)')}</td><td className="px-4 py-3 text-end tabular-nums">{fmtNum(totalNet)}</td></tr>
            <tr className="border-b hover:bg-muted/30"><td className="px-4 py-3">{t3('USt 19%', 'VAT 19%', 'ضريبة 19% (مخرجات)')}</td><td className="px-4 py-3 text-end tabular-nums">{fmtNum(totalTax)}</td></tr>
            <tr className="bg-[#1a1a2e] text-white"><td className="px-4 py-3 font-bold">{t3('USt-Zahllast', 'VAT Payable', 'ضريبة مستحقة')}</td><td className="px-4 py-3 text-end font-bold tabular-nums text-[#d4a853]">{fmtNum(totalTax)}</td></tr>
          </tbody>
        </table>
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

      {/* ═══ CHANNEL TABLE ═══ */}
      {data?.byChannel?.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground">{t3('Umsatz nach Kanal', 'Revenue by Channel', 'الإيرادات حسب القناة')}</h3>
          <div className="bg-background border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className={`text-start ${thCls}`}>{t3('Kanal', 'Channel', 'القناة')}</th>
                  <th className={`text-center ${thCls}`}>{t3('Bestellungen', 'Orders', 'الطلبات')}</th>
                  <th className={`text-center ${thCls}`}>{t3('Umsatz', 'Revenue', 'الإيرادات')}</th>
                  <th className={`text-center ${thCls}`}>{t3('Ø Wert', 'Avg.', 'متوسط')}</th>
                  <th className={`text-center ${thCls}`}>{t3('Anteil', 'Share', 'الحصة')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byChannel].sort((a: any, b: any) => Number(b.gross) - Number(a.gross)).map((ch: any) => {
                  const share = totalGross > 0 ? ((Number(ch.gross) / totalGross) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={ch.channel} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium capitalize">{ch.channel}</td>
                      <td className={`text-center ${tdCls}`}>{ch.count}</td>
                      <td className={`text-center ${tdCls} font-medium`}>{fmtNum(Number(ch.gross))}</td>
                      <td className={`text-center ${tdCls}`}>{fmtNum(Number(ch.avgOrderValue ?? 0))}</td>
                      <td className={`text-center ${tdCls}`}>{share}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
