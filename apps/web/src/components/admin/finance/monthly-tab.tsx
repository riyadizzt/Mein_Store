'use client'

type T3 = (de: string, en: string, ar: string) => string

function fmt(v: number | string | undefined | null): string {
  const n = Number(v ?? 0)
  return `€${n.toFixed(2)}`
}

function pct(current: number, prev: number): { up: boolean; label: string } | null {
  if (!prev) return null
  const diff = ((current - prev) / prev) * 100
  return { up: diff >= 0, label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%` }
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
          <p className="text-lg font-bold tabular-nums">{fmt(totalGross)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('Nettoerlöse', 'Net Revenue', 'صافي الإيرادات')}</p>
          <p className="text-lg font-bold tabular-nums">{fmt(totalNet)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('USt 19%', 'VAT 19%', 'ضريبة 19%')}</p>
          <p className="text-lg font-bold tabular-nums">{fmt(totalTax)}</p>
        </div>
        <div className="bg-[#1a1a2e] p-4 text-white">
          <p className="text-xs text-white/50 mb-1">{t3('Bestellungen', 'Orders', 'الطلبات')}</p>
          <p className="text-lg font-bold tabular-nums">{cur.orderCount ?? 0}</p>
        </div>
      </div>

      {/* ═══════ DAILY TABLE — exact copy of /admin/orders table structure ═══════ */}
      <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">{t3('Tägliche Umsatzübersicht', 'Daily Revenue Breakdown', 'التفاصيل اليومية')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 text-sm font-semibold">{t3('Datum', 'Date', 'التاريخ')}</th>
                <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Anz.', 'Qty', 'عدد')}</th>
                <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Brutto (EUR)', 'Gross (EUR)', 'إجمالي')}</th>
                <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Netto (EUR)', 'Net (EUR)', 'صافي')}</th>
                <th className="text-end px-4 py-3 text-sm font-semibold">{t3('USt (EUR)', 'VAT (EUR)', 'ضريبة')}</th>
              </tr>
            </thead>
            <tbody>
              {activeDays.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t3('Keine Daten', 'No data', 'لا توجد بيانات')}</td></tr>
              ) : activeDays.map((d: any) => {
                const g = Number(d.gross); const n = Number(d.net); const vat = g - n
                return (
                  <tr key={d.date} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{d.date.split('-').reverse().join('.')}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{d.orderCount}</td>
                    <td className="px-4 py-3 text-end tabular-nums font-medium">{g.toFixed(2).replace('.', ',')} €</td>
                    <td className="px-4 py-3 text-end tabular-nums">{n.toFixed(2).replace('.', ',')} €</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{vat.toFixed(2).replace('.', ',')} €</td>
                  </tr>
                )
              })}
              {/* Total row inside tbody — no tfoot (same as Orders table) */}
              <tr className="border-b bg-muted/50 font-bold">
                <td className="px-4 py-3">{t3('SUMME', 'TOTAL', 'المجموع')}</td>
                <td className="px-4 py-3 text-end tabular-nums">{cur.orderCount ?? 0}</td>
                <td className="px-4 py-3 text-end tabular-nums">{totalGross.toFixed(2).replace('.', ',')} €</td>
                <td className="px-4 py-3 text-end tabular-nums">{totalNet.toFixed(2).replace('.', ',')} €</td>
                <td className="px-4 py-3 text-end tabular-nums">{totalTax.toFixed(2).replace('.', ',')} €</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════ SUMMARY TABLE — exact copy of /admin/orders table structure ═══════ */}
      <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">{t3('Monatszusammenfassung', 'Monthly Summary', 'ملخص الشهر')}</h3>
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <colgroup>
              <col style={{ width: '60%' }} />
              <col style={{ width: '40%' }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 text-sm font-semibold">{t3('Position', 'Item', 'البند')}</th>
                <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Betrag', 'Amount', 'المبلغ')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">{t3('Bruttoerlöse gesamt', 'Total Gross Revenue', 'إجمالي الإيرادات')}</td>
                <td className="px-4 py-3 text-end font-medium tabular-nums">{totalGross.toFixed(2).replace('.', ',')} €</td>
              </tr>
              {refunds > 0 && (
                <tr className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-red-600">{t3('./. Retouren/Stornierungen', 'Less Returns/Cancellations', 'ناقص المرتجعات')}</td>
                  <td className="px-4 py-3 text-end font-medium tabular-nums text-red-600">-{refunds.toFixed(2).replace('.', ',')} €</td>
                </tr>
              )}
              <tr className="border-b bg-muted/30">
                <td className="px-4 py-3 font-semibold">{t3('= Netto-Bruttoerlöse', '= Net Gross Revenue', '= صافي الإيرادات الإجمالية')}</td>
                <td className="px-4 py-3 text-end font-bold tabular-nums">{(totalGross - refunds).toFixed(2).replace('.', ',')} €</td>
              </tr>
              <tr className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">{t3('Nettoerlöse (ohne USt)', 'Net Revenue (excl. VAT)', 'صافي الإيرادات (بدون ضريبة)')}</td>
                <td className="px-4 py-3 text-end tabular-nums">{totalNet.toFixed(2).replace('.', ',')} €</td>
              </tr>
              <tr className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">{t3('USt 19% (Ausgangs-USt)', 'VAT 19% (Output VAT)', 'ضريبة 19% (مخرجات)')}</td>
                <td className="px-4 py-3 text-end tabular-nums">{totalTax.toFixed(2).replace('.', ',')} €</td>
              </tr>
              <tr className="bg-[#1a1a2e] text-white">
                <td className="px-4 py-3 font-bold">{t3('USt-Zahllast (an Finanzamt)', 'VAT Payable (to Tax Office)', 'ضريبة مستحقة (لمكتب الضرائب)')}</td>
                <td className="px-4 py-3 text-end font-bold tabular-nums text-[#d4a853]">{totalTax.toFixed(2).replace('.', ',')} €</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">{t3('Vormonat', 'Previous Month', 'الشهر السابق')}</p>
          <p className="font-bold tabular-nums">{fmt(data?.previousMonth?.gross)}</p>
          {pct(totalGross, Number(data?.previousMonth?.gross ?? 0)) && (
            <span className={`text-xs font-medium ${pct(totalGross, Number(data?.previousMonth?.gross ?? 0))!.up ? 'text-green-500' : 'text-red-500'}`}>
              {pct(totalGross, Number(data?.previousMonth?.gross ?? 0))!.label}
            </span>
          )}
        </div>
        <div className="border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">{t3('Gleicher Monat Vorjahr', 'Same Month Last Year', 'نفس الشهر العام الماضي')}</p>
          <p className="font-bold tabular-nums">{fmt(data?.sameMonthLastYear?.gross)}</p>
        </div>
      </div>

      {/* ═══════ CHANNEL TABLE — exact copy of /admin/orders table structure ═══════ */}
      {data?.byChannel?.length > 0 && (
        <>
          <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">{t3('Umsatz nach Kanal', 'Revenue by Channel', 'الإيرادات حسب القناة')}</h3>
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '23%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-start px-4 py-3 text-sm font-semibold">{t3('Kanal', 'Channel', 'القناة')}</th>
                    <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Bestellungen', 'Orders', 'الطلبات')}</th>
                    <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Umsatz (EUR)', 'Revenue (EUR)', 'الإيرادات')}</th>
                    <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Ø Bestellwert', 'Avg. Order', 'متوسط الطلب')}</th>
                    <th className="text-end px-4 py-3 text-sm font-semibold">{t3('Anteil', 'Share', 'الحصة')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.byChannel].sort((a: any, b: any) => Number(b.gross) - Number(a.gross)).map((ch: any) => {
                    const share = totalGross > 0 ? ((Number(ch.gross) / totalGross) * 100).toFixed(1) : '0.0'
                    return (
                      <tr key={ch.channel} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-sm font-semibold capitalize">{ch.channel}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{ch.count}</td>
                        <td className="px-4 py-3 text-end tabular-nums font-medium">{Number(ch.gross).toFixed(2).replace('.', ',')} €</td>
                        <td className="px-4 py-3 text-end tabular-nums">{Number(ch.avgOrderValue ?? 0).toFixed(2).replace('.', ',')} €</td>
                        <td className="px-4 py-3 text-end">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-[#d4a853] rounded-full" style={{ width: `${share}%` }} />
                            </div>
                            <span className="text-xs tabular-nums">{share}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
