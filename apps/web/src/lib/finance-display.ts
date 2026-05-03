/**
 * Finance display helpers — single source of truth for derived monthly /
 * daily report values used by the admin finance UI.
 *
 * Architectural contract (introduced for the tax-phantom bug fix):
 *   - The BACKEND is the single authority for every tax figure.
 *   - currentMonth.tax / currentMonth.net / todaySales.tax / todaySales.net
 *     are REFUND-ADJUSTED by the backend (FinanceReportsService.getMonthlyReport
 *     and .getDailyReport mirror the getVatReport logic at lines 584-590).
 *   - currentMonth.gross / todaySales.gross stay RAW (period gross sales).
 *   - The frontend MUST consume backend-provided fields directly.
 *   - Local derivation `gross - net = tax` is FORBIDDEN — it only holds
 *     pre-refund and silently breaks once refunds are applied.
 *
 * Shape exported by this module is intentionally minimal (Owner decision
 * Option A): only the values the monthly tab + CSV export need, plus a
 * per-day VAT helper. Comparisons (previousMonth / sameMonthLastYear) use
 * gross-only and don't go through this helper.
 *
 * Pure-TS — zero imports. This file is cross-imported by apps/api Jest
 * for the contract test (see finance-frontend-contract.spec.ts). Adding
 * any React / Next / DOM dependency here breaks the contract test.
 */

/** Numeric coercion that tolerates string-encoded decimals from JSON. */
function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

/**
 * Backend response shape consumed by the monthly tab. Modelled loosely
 * (`unknown`) at the boundary to match how the frontend receives JSON,
 * then narrowed via `toNum` for safety.
 */
export interface MonthlyReportLike {
  currentMonth?: {
    gross?: string | number
    net?: string | number
    tax?: string | number
    taxTotal?: string | number
    orderCount?: number
  }
  refundsTotal?: string | number
}

export interface MonthlyDisplayValues {
  /** Raw period gross — "Bruttoerlöse" / "إجمالي الإيرادات". Never refund-adjusted. */
  totalGross: number
  /** Refund-adjusted net-ex-tax — "Nettoerlöse (ohne USt)" / "صافي الإيرادات (بدون ضريبة)". */
  totalNet: number
  /** Refund-adjusted output VAT — "USt 19%" / "ضريبة 19% (مخرجات)" + "ضريبة مستحقة (لمكتب الضرائب)". */
  totalTax: number
  /** Total refunds in period — "ناقص المرتجعات". */
  refunds: number
  /** gross − refunds (gross-level net-after-refunds) — "= صافي الإيرادات الإجمالية". */
  netGrossAfterRefunds: number
}

/**
 * Derive the 5 display values used by the monthly tab from the backend
 * response. Reads currentMonth.tax directly (refund-adjusted by backend).
 * Does NOT compute `gross - net` to derive tax — that pattern is the
 * known bug this contract eliminates.
 */
export function deriveMonthlyDisplayValues(data: MonthlyReportLike | null | undefined): MonthlyDisplayValues {
  const cur = data?.currentMonth ?? {}
  const totalGross = toNum(cur.gross)
  const totalNet = toNum(cur.net)
  // Prefer `tax`; fall back to `taxTotal` alias if present (kept by backend
  // for backward-compat with older API contract versions).
  const totalTax = cur.tax !== undefined ? toNum(cur.tax) : toNum(cur.taxTotal)
  const refunds = toNum(data?.refundsTotal)
  const netGrossAfterRefunds = totalGross - refunds
  return { totalGross, totalNet, totalTax, refunds, netGrossAfterRefunds }
}

/**
 * Backend daily-breakdown row shape — one entry per calendar day in the
 * monthly report's `dailyBreakdown` array.
 */
export interface DailyBreakdownRowLike {
  gross?: string | number
  net?: string | number
  tax?: string | number
}

/**
 * Per-day VAT helper for the daily breakdown table. Reads `tax` directly
 * (raw per-day VAT — backend documents that per-day rows are NOT refund-
 * adjusted because refund timing is independent of order-creation day;
 * refund adjustment is period-only on `currentMonth.tax`).
 *
 * The forbidden pattern `g - n` would also produce raw per-day VAT (math
 * matches for un-adjusted rows), but using `d.tax` makes the contract
 * uniform: frontend always reads, never derives.
 */
export function deriveDailyVatPerRow(d: DailyBreakdownRowLike | null | undefined): number {
  return toNum(d?.tax)
}
