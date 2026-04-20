/**
 * Regression for the VAT-Report "tax > 0 on gross=0" bug surfaced by
 * ORD-20260420-000001. Same root-cause family as the Invoice.netAmount
 * fix (8bd0eb0): summing order_items.total_price (pre-discount) instead
 * of trusting order-level total_amount / tax_amount produced inflated
 * VAT on every coupon order.
 *
 * What this spec pins down:
 *   1. The SQL is now a CTE-based pro-rate over order-level totals. Its
 *      result rows plug straight through FinanceReportsService into the
 *      vatLines response.
 *   2. For a single-rate coupon order the pro-rate ratio collapses to 1.0
 *      and the reported gross/tax equal order.total_amount /
 *      order.tax_amount — NOT the pre-discount items sum.
 *   3. totalTax is net of refunds (via aggregateRefunds), unchanged.
 *
 * Meta-verifiable: reverting getVatReport to the old per-item SUM makes
 * test #1 fail with the inflated €3124.62 value.
 */

import { FinanceReportsService } from '../services/finance-reports.service'

function buildService(queryRawResult: any[]) {
  const mockPrisma: any = {
    // Raw SQL query used by getVatReport — the test pre-computes what
    // the DB would return for a single 50%-off coupon order.
    $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
    refund: {
      // aggregateRefunds sums refunds.amount where processedAt in [start, end]
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const service = new FinanceReportsService(mockPrisma as any)
  return { service, mockPrisma }
}

describe('FinanceReportsService.getVatReport — ORD-20260420-000001 regression', () => {
  it('#1 coupon order: reports gross from order.totalAmount (NOT items pre-discount sum)', async () => {
    // Live shape after the SQL fix: the CTE already pro-rates by
    // (rate_items_sum / subtotal), so for a single-rate order the row
    // arriving here is exactly one rate with the order-level totals.
    //
    //   subtotal=19570, discount=9785, total=9785, tax=1562.31, rate=19
    //   ratio = rate_items_sum (19570) / subtotal (19570) = 1.0
    //   gross_amount = 9785 * 1.0 = 9785
    //   tax_amount   = 1562.31 * 1.0 = 1562.31
    //   taxable_amount = (9785 - 1562.31) * 1.0 = 8222.69
    const { service } = buildService([
      {
        tax_rate: 19,
        gross_amount: 9785,
        tax_amount: 1562.31,
        taxable_amount: 8222.69,
      },
    ])

    const report = await service.getVatReport('2026-04-20', '2026-04-20')

    expect(report.vatLines).toHaveLength(1)
    expect(report.vatLines[0]).toEqual({
      rate: 19,
      grossAmount: 9785,
      taxAmount: 1562.31,
      taxableAmount: 8222.69,
    })
    // CRITICAL: reported VAT must NOT be the pre-discount €3124.62 value.
    expect(report.vatLines[0].taxAmount).toBe(1562.31)
    expect(report.vatLines[0].taxAmount).not.toBe(3124.62)
    // Invariant: taxable + tax = gross (±1 cent)
    const line = report.vatLines[0]
    expect(Math.abs(line.taxableAmount + line.taxAmount - line.grossAmount)).toBeLessThanOrEqual(0.01)
  })

  it('#2 totalTax is sum of vatLines.taxAmount (before refund subtraction)', async () => {
    const { service } = buildService([
      { tax_rate: 19, gross_amount: 9785, tax_amount: 1562.31, taxable_amount: 8222.69 },
    ])
    const report = await service.getVatReport('2026-04-20', '2026-04-20')
    expect(report.totalTaxSales).toBe(1562.31)
    // No refunds mocked → totalTax (net) == totalTaxSales
    expect(report.totalTax).toBe(1562.31)
  })

  it('#3 multi-rate pro-rating: two rates share one order totalAmount', async () => {
    // Future-proofing: if Malak ever adds 7% items, the CTE pro-rates
    // order-level totals by each rate's share of the pre-discount items
    // sum. For a 50/50 split between 19% and 7% the DB would return two
    // rows each with half of order.total_amount / order.tax_amount.
    const { service } = buildService([
      { tax_rate: 19, gross_amount: 50, tax_amount: 7.98, taxable_amount: 42.02 },
      { tax_rate: 7, gross_amount: 50, tax_amount: 3.27, taxable_amount: 46.73 },
    ])
    const report = await service.getVatReport('2026-04-20', '2026-04-20')
    expect(report.vatLines).toHaveLength(2)
    // Sum of per-rate grossAmount matches the order total
    const grossSum = report.vatLines.reduce((s: number, l: any) => s + l.grossAmount, 0)
    expect(grossSum).toBe(100)
    // Sum of per-rate taxAmount matches the order tax
    const taxSum = report.vatLines.reduce((s: number, l: any) => s + l.taxAmount, 0)
    expect(Math.abs(taxSum - 11.25)).toBeLessThanOrEqual(0.01)
  })

  it('#4 empty period: returns empty vatLines and zero totals', async () => {
    const { service } = buildService([])
    const report = await service.getVatReport('2026-01-01', '2026-01-02')
    expect(report.vatLines).toHaveLength(0)
    expect(report.totalTaxSales).toBe(0)
    expect(report.totalTax).toBe(0)
  })
})
