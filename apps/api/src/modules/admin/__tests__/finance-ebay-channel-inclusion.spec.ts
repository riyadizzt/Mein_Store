/**
 * C15.8 regression — eBay channel inclusion in finance reports.
 *
 * Owner-reported bug: pre-C15.8 ONLINE_CHANNELS list excluded 'ebay' →
 * eBay orders were silently dropped from finance daily/monthly aggregates,
 * but eBay refunds were still counted (no channel filter on refund side).
 * Result: GoBD-violating phantom-refund effect on the Finanzamt PDF.
 *
 * 4 cases:
 *   1. eBay order included in monthly currentMonth.gross
 *   2. eBay order's tax included in adjustedTax math (refund-symmetric)
 *   3. eBay refund symmetry: refundsTotal includes eBay refunds, math
 *      stays consistent (no negative tax artifact)
 *   4. byChannel breakdown includes 'ebay' row when eBay sales exist
 *
 * Test pattern mirrors finance-tax-phantom-fix.spec.ts: mock prisma,
 * inject orders + refunds via in-memory matcher, assert service output.
 */

import { FinanceReportsService } from '../services/finance-reports.service'

interface SeedOrder {
  id: string
  status: string
  channel: string
  totalAmount: number
  taxAmount: number
  discountAmount: number
  shippingCost: number
  createdAt: Date
  deletedAt: Date | null
}

interface SeedRefund {
  amount: number
  channel: string
  createdAt: Date
  status?: 'PROCESSED' | 'PENDING' | 'FAILED' // C15.8 status-filter — defaults to PROCESSED for back-compat with existing seeds
}

function matchesOrderWhere(order: SeedOrder, where: any): boolean {
  if (!where) return true
  if (where.deletedAt === null && order.deletedAt !== null) return false
  if (where.status?.in && !where.status.in.includes(order.status)) return false
  if (where.channel?.in && !where.channel.in.includes(order.channel)) return false
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

  const aggregate = (where: any, _sum: any, _count: boolean | undefined) => {
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

  const groupBy = ({ by, where, _sum, _count }: any) => {
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
        for (const key of Object.keys(_sum)) row._sum[key] = items.reduce((s, o: any) => s + (o[key] ?? 0), 0)
      }
      if (_count) row._count = items.length
      return row
    })
  }

  const matchRefund = (r: SeedRefund, where: any) => {
    if (where?.createdAt?.gte && r.createdAt < where.createdAt.gte) return false
    if (where?.createdAt?.lte && r.createdAt > where.createdAt.lte) return false
    // C15.8 — refund.payment.order.channel filter
    const allowedChannels = where?.payment?.order?.channel?.in
    if (allowedChannels && !allowedChannels.includes(r.channel)) return false
    // C15.8 status-filter: support both single-value and { in: [...] } forms
    const status = r.status ?? 'PROCESSED'
    if (where?.status) {
      if (typeof where.status === 'string' && where.status !== status) return false
      if (where.status.in && !where.status.in.includes(status)) return false
    }
    return true
  }

  const refundFindMany = ({ where }: any) =>
    Promise.resolve(
      refunds
        .filter((r) => matchRefund(r, where))
        .map((r) => ({ amount: r.amount, payment: { order: { channel: r.channel } } })),
    )

  const mock: any = {
    order: {
      aggregate: jest.fn(({ where, _sum, _count }: any) => Promise.resolve(aggregate(where, _sum, _count))),
      groupBy: jest.fn((args: any) => Promise.resolve(groupBy(args))),
      count: jest.fn(({ where }: any) => Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})).length)),
      findMany: jest.fn(({ where }: any) => Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})))),
    },
    payment: { groupBy: jest.fn(() => Promise.resolve([])) },
    refund: {
      findMany: jest.fn(refundFindMany),
      aggregate: jest.fn(({ where }: any) => {
        const matching = refunds.filter((r) => matchRefund(r, where))
        return Promise.resolve({
          _sum: { amount: matching.length === 0 ? null : matching.reduce((s, r) => s + r.amount, 0) },
        })
      }),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    return: { findMany: jest.fn(() => Promise.resolve([])) },
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
    status: opts.status,
    channel: opts.channel ?? 'website',
    totalAmount: opts.total,
    // Brutto convention: tax extracted from gross at 19%
    taxAmount: Number((opts.total - opts.total / 1.19).toFixed(2)),
    discountAmount: 0,
    shippingCost: 0,
    createdAt: at,
    deletedAt: null,
  }
}

function utcMidday(): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  return d
}

describe('FinanceReportsService — C15.8 eBay channel inclusion', () => {
  it('1. eBay order is included in monthly currentMonth.gross', async () => {
    // Pre-C15.8: eBay excluded by ONLINE_CHANNELS → gross would have been 100.
    // Post-C15.8: gross includes eBay → 150.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [
        mkOrder({ id: 'a', status: 'delivered', total: 100, channel: 'website', at }),
        mkOrder({ id: 'b', status: 'delivered', total: 50, channel: 'ebay', at }),
      ],
      refunds: [],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('150.00')
    expect(report.currentMonth.orderCount).toBe(2)
  })

  it('2. eBay tax is included in currentMonth.tax (refund-adjusted math)', async () => {
    // €119 eBay order → 100 net + 19 VAT. No refund → tax stays 19.
    // Pre-C15.8 would have shown tax=0 (eBay excluded entirely).
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 119, channel: 'ebay', at })],
      refunds: [],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('119.00')
    expect(report.currentMonth.tax).toBe('19.00')
  })

  it('3. eBay refund symmetry: refundsTotal + tax-adjustment work consistently', async () => {
    // €100 eBay order canceled+refunded. Same shape as the Owner-repro
    // for tax-fix-v2 (Mai 2026) but on the eBay channel — must produce
    // the same 0.00 outcome instead of phantom tax.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'refunded', total: 100, channel: 'ebay', at })],
      refunds: [{ amount: 100, channel: 'ebay', createdAt: at }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('100.00')
    expect(report.refundsTotal).toBe('100.00')
    expect(report.netRevenue).toBe('0.00')
    // C15.8 + tax-fix-v2 working together: eBay tax is now in the gross
    // AND the eBay refund VAT is symmetrically deducted → 0.
    expect(report.currentMonth.tax).toBe('0.00')
    expect(report.currentMonth.net).toBe('0.00')
  })

  it('4. byChannel breakdown includes ebay row when eBay sales exist', async () => {
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [
        mkOrder({ id: 'a', status: 'delivered', total: 100, channel: 'website', at }),
        mkOrder({ id: 'b', status: 'delivered', total: 200, channel: 'ebay', at }),
        mkOrder({ id: 'c', status: 'delivered', total: 50, channel: 'ebay', at }),
      ],
      refunds: [],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    const ebayRow = report.byChannel.find((c: any) => c.channel === 'ebay')
    expect(ebayRow).toBeDefined()
    expect(Number(ebayRow!.gross)).toBe(250) // 200 + 50
    expect(ebayRow!.count).toBe(2)

    const websiteRow = report.byChannel.find((c: any) => c.channel === 'website')
    expect(websiteRow).toBeDefined()
    expect(Number(websiteRow!.gross)).toBe(100)
  })

  it('5. C15.8 refund symmetry: POS refunds excluded (defense-in-depth)', async () => {
    // POS is NOT in ONLINE_CHANNELS. Even if a hypothetical POS refund
    // landed in the table, aggregateRefunds must filter it out for
    // symmetric exclusion with sales side.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'delivered', total: 100, channel: 'website', at })],
      refunds: [
        { amount: 50, channel: 'website', createdAt: at },
        { amount: 99, channel: 'pos', createdAt: at }, // must be excluded
      ],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    // Only the website refund should count
    expect(report.refundsTotal).toBe('50.00')
    expect(report.refundCount).toBe(1)
  })

  // ────────────────────────────────────────────────────────────────────
  // C15.8 status-filter (Phase D fix) — refund counted on issuance, not
  // on bank-transfer completion. Async-channels (eBay, Vorkasse) start
  // as PENDING and transition to PROCESSED via poll-cron / admin-action.
  // Both states must count toward refundsTotal to eliminate phantom-
  // revenue windows during the transition lag. FAILED excluded — no
  // money actually moved.
  // ────────────────────────────────────────────────────────────────────

  it('6. PENDING refund counted in totals (Phase D Owner-repro)', async () => {
    // Owner-repro shape: eBay order canceled, Refund row created with
    // status='PENDING' because EbayPaymentProvider returns 'pending'
    // (poll-cron later transitions to PROCESSED). The pending refund
    // MUST count toward refundsTotal — otherwise gross is included but
    // refund is excluded → phantom revenue + phantom tax.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'refunded', total: 100, channel: 'ebay', at })],
      refunds: [{ amount: 100, channel: 'ebay', createdAt: at, status: 'PENDING' }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('100.00')
    expect(report.refundsTotal).toBe('100.00')
    expect(report.netRevenue).toBe('0.00')
    // Critical: tax + net both refund-adjusted to 0 — no phantom.
    expect(report.currentMonth.tax).toBe('0.00')
    expect(report.currentMonth.net).toBe('0.00')
  })

  it('7. FAILED refund excluded from totals (no money actually moved)', async () => {
    // FAILED refunds represent provider-rejected refund attempts. No
    // money transfer occurred → must NOT count toward refundsTotal.
    // Order's gross is still counted normally (admin will re-issue or
    // resolve manually).
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [mkOrder({ id: 'a', status: 'refunded', total: 100, channel: 'ebay', at })],
      refunds: [{ amount: 100, channel: 'ebay', createdAt: at, status: 'FAILED' }],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('100.00')
    // FAILED refund excluded → refundsTotal stays 0
    expect(report.refundsTotal).toBe('0.00')
    expect(report.refundCount).toBe(0)
    // Order is still counted, refund didn't materialize → tax stays.
    // Tax of €100 gross @19% = €100 - €100/1.19 = €15.97
    expect(report.currentMonth.tax).toBe('15.97')
  })

  it('8. PENDING + PROCESSED both counted, no double-count', async () => {
    // Two refunds in the same period: one async-PENDING, one sync-
    // PROCESSED. Both must count, summed correctly.
    const at = utcMidday()
    const prisma = buildMockPrisma({
      orders: [
        mkOrder({ id: 'a', status: 'refunded', total: 100, channel: 'website', at }),
        mkOrder({ id: 'b', status: 'refunded', total: 50, channel: 'ebay', at }),
      ],
      refunds: [
        { amount: 100, channel: 'website', createdAt: at, status: 'PROCESSED' },
        { amount: 50, channel: 'ebay', createdAt: at, status: 'PENDING' },
      ],
    })
    const finance = new FinanceReportsService(prisma as any)
    const now = new Date()
    const report = await finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1)

    expect(report.currentMonth.gross).toBe('150.00')
    // Both refunds counted exactly once: 100 + 50 = 150
    expect(report.refundsTotal).toBe('150.00')
    expect(report.refundCount).toBe(2)
    expect(report.netRevenue).toBe('0.00')
    expect(report.currentMonth.tax).toBe('0.00')
  })
})
