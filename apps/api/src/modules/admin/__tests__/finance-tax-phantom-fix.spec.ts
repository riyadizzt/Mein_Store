/**
 * Tax phantom bug fix — Issue: Owner observed in May 2026 monthly report
 * that a canceled+refunded order produced a phantom €3.99 VAT-owed line on
 * a period with €0.00 net revenue. GoBD compliance violation.
 *
 * Root cause (pre-fix): getMonthlyReport / getDailyReport returned
 * currentMonth.tax + currentMonth.net summed from Order.taxAmount across
 * orders incl. status='refunded'. Refunds were only deducted at gross
 * level (netRevenue = gross - refundsTotal), never at tax/net level.
 *
 * Post-fix: tax + net are refund-adjusted by extracting embedded VAT at
 * 19% from refundsTotal and subtracting from both, mirroring the
 * already-correct logic in getVatReport (lines 584-590).
 *
 * Test surface:
 *   Monthly:
 *     a. refund within-period reduces tax + net
 *     b. refund-only no-sale period → tax=0
 *     c. refund larger than sales → tax=0 (clamp via Math.max(0, …))
 *     d. zero refunds → unchanged (regression guard for healthy periods)
 *   Daily:
 *     same 4 cases
 *
 * Meta-verifiable: reverting either getMonthlyReport or getDailyReport
 * to the pre-fix code makes the corresponding test fail with the phantom
 * tax value (e.g. 3.99 instead of 0.00 in case b).
 */

import { FinanceReportsService } from '../services/finance-reports.service'

interface SeedOrder {
  id: string
  orderNumber: string
  status: string
  channel: string
  subtotal: number
  totalAmount: number
  taxAmount: number
  discountAmount: number
  shippingCost: number
  createdAt: Date
  deletedAt: Date | null
  firstViewedByAdminAt: Date | null
  userId: string | null
  guestEmail: string | null
}

interface SeedRefund {
  amount: number
  channel: string
  createdAt: Date
}

function matchesOrderWhere(order: SeedOrder, where: any): boolean {
  if (!where) return true
  if (where.deletedAt === null && order.deletedAt !== null) return false
  if (where.status !== undefined) {
    if (typeof where.status === 'string') {
      if (where.status !== order.status) return false
    } else {
      if (where.status.in && !where.status.in.includes(order.status)) return false
      if (where.status.notIn && where.status.notIn.includes(order.status)) return false
    }
  }
  if (where.channel !== undefined) {
    if (typeof where.channel === 'string') {
      if (where.channel !== order.channel) return false
    } else if (where.channel.in) {
      if (!where.channel.in.includes(order.channel)) return false
    }
  }
  if (where.createdAt) {
    if (where.createdAt.gte && order.createdAt < where.createdAt.gte) return false
    if (where.createdAt.lte && order.createdAt > where.createdAt.lte) return false
    if (where.createdAt.lt && order.createdAt >= where.createdAt.lt) return false
  }
  return true
}

function buildMockPrisma(seed: { orders?: SeedOrder[]; refunds?: SeedRefund[] }) {
  const orders = seed.orders ?? []
  const refunds = seed.refunds ?? []

  function aggregate(where: any, _sum: any, _count: boolean | undefined) {
    const matching = orders.filter((o) => matchesOrderWhere(o, where ?? {}))
    const sums: any = {}
    if (_sum) {
      for (const key of Object.keys(_sum)) {
        sums[key] =
          matching.length === 0
            ? null
            : matching.reduce((s, o: any) => s + (o[key] ?? 0), 0)
      }
    }
    const result: any = { _sum: sums }
    if (_count) result._count = matching.length
    return result
  }

  function groupBy({ by, where, _sum, _count }: any) {
    const matching = orders.filter((o) => matchesOrderWhere(o, where ?? {}))
    const groups = new Map<string, SeedOrder[]>()
    for (const o of matching) {
      const key = by.map((k: string) => (o as any)[k]).join('|')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(o)
    }
    return Array.from(groups.entries()).map(([k, items]) => {
      const parts = k.split('|')
      const row: any = {}
      by.forEach((field: string, i: number) => (row[field] = parts[i]))
      if (_sum) {
        row._sum = {}
        for (const key of Object.keys(_sum)) {
          row._sum[key] = items.reduce((s, o: any) => s + (o[key] ?? 0), 0)
        }
      }
      if (_count) row._count = items.length
      return row
    })
  }

  // Refund.findMany filters by createdAt range + status='PROCESSED'. Mock
  // returns the seeded refunds in the shape aggregateRefunds expects.
  function refundFindMany({ where }: any) {
    const result = refunds
      .filter((r) => {
        if (where?.createdAt?.gte && r.createdAt < where.createdAt.gte) return false
        if (where?.createdAt?.lte && r.createdAt > where.createdAt.lte) return false
        return true
      })
      .map((r) => ({
        amount: r.amount,
        payment: { order: { channel: r.channel } },
      }))
    return Promise.resolve(result)
  }

  function refundAggregate({ where }: any) {
    const matching = refunds.filter((r) => {
      if (where?.createdAt?.gte && r.createdAt < where.createdAt.gte) return false
      if (where?.createdAt?.lte && r.createdAt > where.createdAt.lte) return false
      return true
    })
    return Promise.resolve({
      _sum: { amount: matching.reduce((s, r) => s + r.amount, 0) },
      _count: matching.length,
    })
  }

  const mock: any = {
    order: {
      aggregate: jest.fn(({ where, _sum, _count }: any) =>
        Promise.resolve(aggregate(where, _sum, _count)),
      ),
      groupBy: jest.fn((args: any) => Promise.resolve(groupBy(args))),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})).length),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {}))),
      ),
    },
    payment: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    refund: {
      findMany: jest.fn(refundFindMany),
      aggregate: jest.fn(refundAggregate),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    return: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    $queryRaw: jest.fn(() => Promise.resolve([])),
  }
  return mock
}

function mkOrder(opts: {
  id: string
  status: string
  total: number
  channel?: string
  at?: Date
}): SeedOrder {
  const at = opts.at ?? new Date()
  return {
    id: opts.id,
    orderNumber: `ORD-${opts.id}`,
    status: opts.status,
    channel: opts.channel ?? 'website',
    subtotal: opts.total,
    totalAmount: opts.total,
    // Brutto convention: tax extracted from gross at 19%
    taxAmount: Number((opts.total - opts.total / 1.19).toFixed(2)),
    discountAmount: 0,
    shippingCost: 0,
    createdAt: at,
    deletedAt: null,
    firstViewedByAdminAt: null,
    userId: null,
    guestEmail: `${opts.id}@test.invalid`,
  }
}

function utcMidday(): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  return d
}

// ────────────────────────────────────────────────────────────────────────
// MONTHLY REPORT — 4 cases
// ────────────────────────────────────────────────────────────────────────

describe('FinanceReportsService.getMonthlyReport — tax phantom fix', () => {
  it('a. refund within-period reduces tax + net (NOT only gross)', async () => {
    // €100 sale → 84.03 net + 15.97 VAT. Refund €40 (gross).
    // Expected: tax 15.97 - 6.39 (=40-40/1.19) = 9.58
    //           net 84.03 - 33.61 (=40/1.19) = 50.42
    //           netRevenue = 100 - 40 = 60
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 100, at })],
      refunds: [{ amount: 40, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('100.00')
    expect(report.currentMonth.tax).toBe('9.58')
    expect(report.currentMonth.net).toBe('50.42')
    expect(report.currentMonth.taxTotal).toBe('9.58')
    expect(report.netRevenue).toBe('60.00')
    expect(report.refundsTotal).toBe('40.00')

    // Math invariant: net + tax == netRevenue (±1 cent)
    const sumCheck = Number(report.currentMonth.net) + Number(report.currentMonth.tax)
    expect(Math.abs(sumCheck - Number(report.netRevenue))).toBeLessThanOrEqual(0.01)
  })

  it('b. refund-only no-sale period → tax=0 (the Owner-reported scenario exactly)', async () => {
    // Owner's repro: sale was confirmed earlier (status now 'refunded'),
    // refund row created in the same period. Both surface in the period:
    //   gross = 24.99 (order kept in COUNTABLE incl. 'refunded')
    //   refundsTotal = 24.99
    //   netRevenue = 0.00 (correct already pre-fix)
    //   tax = 3.99 (PHANTOM pre-fix) → must be 0.00 post-fix
    //   net = 21.00 (PHANTOM pre-fix) → must be 0.00 post-fix
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'refunded', total: 24.99, at })],
      refunds: [{ amount: 24.99, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('24.99')
    expect(report.currentMonth.tax).toBe('0.00') // ← phantom 3.99 eliminated
    expect(report.currentMonth.net).toBe('0.00') // ← phantom 21.00 eliminated
    expect(report.currentMonth.taxTotal).toBe('0.00')
    expect(report.netRevenue).toBe('0.00')
    expect(report.refundsTotal).toBe('24.99')
  })

  it('c. refund larger than sales → tax=0 (Math.max clamp prevents negative VAT)', async () => {
    // Edge: prior-month sale of €200 refunded this month + tiny new sale.
    // Refund (€200 gross, embedded VAT €31.93) > current month VAT (€7.98).
    // Pre-clamp: 7.98 - 31.93 = -23.95 (would be a tax-credit; out of scope).
    // Post-clamp: 0.00 (safe — accountant handles credits in separate ledger).
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 50, at })], // tax 7.98
      refunds: [{ amount: 200, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.tax).toBe('0.00') // clamped, not negative
    expect(report.currentMonth.net).toBe('0.00') // clamped
    expect(report.currentMonth.taxTotal).toBe('0.00')
    // netRevenue may legitimately go negative — gross-level math is unchanged
    expect(Number(report.netRevenue)).toBeLessThan(0)
  })

  it('d. zero refunds → tax + net unchanged from raw aggregation (regression guard)', async () => {
    // Healthy period — no refunds. Tax + net must equal raw order sums.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [
        mkOrder({ id: 'a', status: 'delivered', total: 100, at }),
        mkOrder({ id: 'b', status: 'shipped', total: 200, at }),
      ],
      refunds: [],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    // gross 300, tax = 300 - 300/1.19 = 47.90 (-ish, depends on rounding)
    // Brutto convention: per-order tax sums = 15.97 (for 100) + 31.93 (for 200) = 47.90
    expect(report.currentMonth.gross).toBe('300.00')
    expect(report.currentMonth.tax).toBe('47.90')
    expect(report.currentMonth.net).toBe('252.10')
    expect(report.currentMonth.taxTotal).toBe('47.90')
    expect(report.refundsTotal).toBe('0.00')
    expect(report.netRevenue).toBe('300.00')
  })
})

// ────────────────────────────────────────────────────────────────────────
// DAILY REPORT — same 4 cases
// ────────────────────────────────────────────────────────────────────────

describe('FinanceReportsService.getDailyReport — tax phantom fix', () => {
  it('a. refund within-day reduces tax + net (NOT only gross)', async () => {
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 100, at })],
      refunds: [{ amount: 40, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const todayStr = at.toISOString().slice(0, 10)
    const report = await finance.getDailyReport(todayStr)

    expect(report.todaySales.gross).toBe('100.00')
    expect(report.todaySales.tax).toBe('9.58')
    expect(report.todaySales.net).toBe('50.42')
    expect(report.netRevenue).toBe('60.00')
    expect(report.refunds.total).toBe('40.00')
  })

  it('b. refund-only no-sale day → tax=0 (Owner-reported scenario, daily scope)', async () => {
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'refunded', total: 24.99, at })],
      refunds: [{ amount: 24.99, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const todayStr = at.toISOString().slice(0, 10)
    const report = await finance.getDailyReport(todayStr)

    expect(report.todaySales.gross).toBe('24.99')
    expect(report.todaySales.tax).toBe('0.00') // ← phantom 3.99 eliminated
    expect(report.todaySales.net).toBe('0.00') // ← phantom 21.00 eliminated
    expect(report.netRevenue).toBe('0.00')
    expect(report.refunds.total).toBe('24.99')
  })

  it('c. refund larger than sales → tax=0 (clamp)', async () => {
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 50, at })],
      refunds: [{ amount: 200, channel: 'website', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const todayStr = at.toISOString().slice(0, 10)
    const report = await finance.getDailyReport(todayStr)

    expect(report.todaySales.tax).toBe('0.00')
    expect(report.todaySales.net).toBe('0.00')
    expect(Number(report.netRevenue)).toBeLessThan(0)
  })

  it('d. zero refunds → tax + net unchanged (regression guard)', async () => {
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [
        mkOrder({ id: 'a', status: 'delivered', total: 100, at }),
        mkOrder({ id: 'b', status: 'shipped', total: 200, at }),
      ],
      refunds: [],
    })
    const finance = new FinanceReportsService(prisma as any)
    const todayStr = at.toISOString().slice(0, 10)
    const report = await finance.getDailyReport(todayStr)

    expect(report.todaySales.gross).toBe('300.00')
    expect(report.todaySales.tax).toBe('47.90')
    expect(report.todaySales.net).toBe('252.10')
    expect(report.refunds.total).toBe('0.00')
    expect(report.netRevenue).toBe('300.00')
  })
})
