/**
 * Financial consistency regression test — structural guarantee against
 * Launch-Blocker-family bugs where Dashboard and FinanceReports drift apart.
 *
 * Background:
 *   Three launch blockers discovered in the pre-launch finance audit were
 *   all the same bug shape: two code paths that must agree numerically,
 *   with no mechanism enforcing agreement.
 *     #1 Refund vs. Credit-Note atomicity
 *     #2 Dashboard vs. Finance UTC drift
 *     #3 Dashboard vs. Finance status-filter drift (`notIn:['cancelled']`
 *        vs. COUNTABLE_STATUSES)
 *
 * What this test does:
 *   Runs BOTH services against the SAME in-memory seed data, then asserts
 *   identical financial KPIs for the same period. Any future code change
 *   that makes the two services count orders differently fails this test
 *   before merge.
 *
 * Why mock-based and not live-DB E2E:
 *   This test runs in the default `pnpm test` suite so it guards PR merges.
 *   A live DB E2E would be opt-in and miss drift during review. The mock
 *   implements the Prisma query semantics the two services actually use
 *   (aggregate, groupBy, count, findMany with WHERE-clause matching),
 *   scoped just enough to exercise the financial KPIs.
 *
 * What is NOT covered here (covered by other tests):
 *   - Raw-SQL queries (topProducts, revenueLast7DaysRaw, lowStock,
 *     bestsellers, VAT lines, customer report) — those return empty from
 *     the mock. Numerical equality on those is covered by the live-DB
 *     Phase-2 refund-matrix E2E (different concern) and can be added here
 *     later by pattern-matching the SQL string.
 *   - Refund aggregation. The mock returns zero refunds; both services
 *     still agree (both get 0) which is sufficient for structural parity.
 */

import { DashboardService } from '../services/dashboard.service'
import { FinanceReportsService } from '../services/finance-reports.service'

// ── Seed-data types and mock Prisma ─────────────────────────────

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

/**
 * Minimal Prisma-WHERE matcher covering the subset both services actually
 * use on the orders table. Extend only if a new test exposes a gap —
 * keep this deliberately small to stay reviewable.
 */
function matchesOrderWhere(order: SeedOrder, where: any): boolean {
  if (!where) return true
  if (where.deletedAt === null && order.deletedAt !== null) return false
  if (where.deletedAt !== undefined && where.deletedAt !== null) {
    // unsupported, tests don't hit this
  }
  if (where.firstViewedByAdminAt === null && order.firstViewedByAdminAt !== null) return false
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

function buildMockPrisma(seed: { orders: SeedOrder[] }) {
  const orders = seed.orders

  function aggregate(where: any, _sum: any, _count: boolean | undefined) {
    const matching = orders.filter((o) => matchesOrderWhere(o, where ?? {}))
    const sums: any = {}
    if (_sum) {
      for (const key of Object.keys(_sum)) {
        // Match Prisma behaviour: null when no rows, otherwise numeric sum.
        sums[key] = matching.length === 0
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

  const mock: any = {
    order: {
      aggregate: jest.fn(({ where, _sum, _count }: any) =>
        Promise.resolve(aggregate(where, _sum, _count)),
      ),
      groupBy: jest.fn((args: any) => Promise.resolve(groupBy(args))),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})).length),
      ),
      findMany: jest.fn(({ where, orderBy, take }: any) => {
        let matching = orders.filter((o) => matchesOrderWhere(o, where ?? {}))
        if (orderBy?.createdAt === 'desc') {
          matching = [...matching].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        }
        if (take) matching = matching.slice(0, take)
        return Promise.resolve(matching)
      }),
    },
    payment: {
      // Out of scope for this test (would need join on orders). Both
      // services get empty → they agree by construction.
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    refund: {
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
      // No refunds seeded in these tests, so both services see 0.
      // Parity is still held — the comparison we care about is revenue
      // from orders, not refund aggregation.
      aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })),
    },
    return: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    abandonedCart: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    adminAuditLog: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    searchLog: {
      count: jest.fn(() => Promise.resolve(0)),
    },
    shopSetting: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    // Raw-SQL queries both services use. Returning empty makes the two
    // services agree numerically on the raw-SQL-derived fields (topProducts,
    // 7-day chart, etc.) — a weaker but still meaningful guarantee than
    // simulating SQL. Future work can replace this with pattern-matching.
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn((fn: any) => {
      if (typeof fn === 'function') return fn(mock)
      return Promise.all(fn)
    }),
  }
  return mock
}

// ── Seed helpers ────────────────────────────────────────────────

function mkOrder(opts: {
  id: string
  status: string
  total: number
  channel?: string
  at?: Date
  subtotal?: number
}): SeedOrder {
  const at = opts.at ?? new Date()
  const subtotal = opts.subtotal ?? opts.total
  return {
    id: opts.id,
    orderNumber: `ORD-${opts.id}`,
    status: opts.status,
    channel: opts.channel ?? 'website',
    subtotal,
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

function utcMidday(offsetDays = 0): Date {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  if (offsetDays !== 0) d.setUTCDate(d.getUTCDate() + offsetDays)
  return d
}

// ── Tests ───────────────────────────────────────────────────────

describe('Financial consistency — Dashboard vs FinanceReports', () => {
  // This suite is the structural guard added in Fix 4. If it ever goes red
  // after a PR that touches either service, it means the two surfaces
  // started disagreeing numerically for the same period — that is exactly
  // the launch-blocker bug family. Investigate before merging.

  it('mixed statuses + channels (incl. eBay): revenue today matches between dashboard and finance', async () => {
    // Seed: 11 orders today, 7 countable + 4 non-countable. Finance and
    // dashboard must both compute the countable sum (480) and exclude
    // the non-countable (140).
    // C15.8 — added eBay seed (id='k', €25). Pre-C15.8 the dashboard would
    // have over-counted (no channel filter, included eBay) while finance
    // excluded eBay → drift. Post-C15.8 both include eBay symmetrically.
    const at = utcMidday()
    const seed: SeedOrder[] = [
      // COUNTABLE (sum = 100+50+75+80+90+60+25 = 480, incl. eBay 25)
      mkOrder({ id: 'a', status: 'confirmed',  total: 100, channel: 'website',   at }),
      mkOrder({ id: 'b', status: 'processing', total: 50,  channel: 'website',   at }),
      mkOrder({ id: 'c', status: 'shipped',    total: 75,  channel: 'facebook',  at }),
      mkOrder({ id: 'd', status: 'delivered',  total: 80,  channel: 'instagram', at }),
      mkOrder({ id: 'e', status: 'returned',   total: 90,  channel: 'website',   at }),
      mkOrder({ id: 'f', status: 'refunded',   total: 60,  channel: 'website',   at }),
      mkOrder({ id: 'k', status: 'delivered',  total: 25,  channel: 'ebay',      at }), // C15.8
      // NON-COUNTABLE (must be excluded from revenue, old dashboard
      // bug would have included pending + pending_payment + disputed)
      mkOrder({ id: 'g', status: 'pending',         total: 30, channel: 'website', at }),
      mkOrder({ id: 'h', status: 'pending_payment', total: 40, channel: 'website', at }),
      mkOrder({ id: 'i', status: 'cancelled',       total: 50, channel: 'website', at }),
      mkOrder({ id: 'j', status: 'disputed',        total: 20, channel: 'website', at }),
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    // Both services: gross revenue = sum of countable incl. eBay = €480.00
    expect(dash.today.revenueGross).toBe('480.00')
    expect(fin.todaySales.gross).toBe('480.00')
    expect(dash.today.revenueGross).toBe(fin.todaySales.gross)

    // Count parity: both count only the 7 countable orders
    expect(dash.today.orderCount).toBe(7)
    expect(fin.todaySales.orderCount).toBe(7)
  })

  it('this month revenue matches between dashboard.thisMonth and finance.currentMonth (incl. eBay)', async () => {
    // All seed orders are within this calendar month. Mix of statuses + channels.
    // C15.8 — added eBay seed. Both dashboard and finance MUST include it.
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'confirmed',  total: 200, at }),
      mkOrder({ id: 'b', status: 'shipped',    total: 300, at }),
      mkOrder({ id: 'c', status: 'delivered',  total: 400, at }),
      mkOrder({ id: 'd', status: 'refunded',   total: 100, at }),
      mkOrder({ id: 'g', status: 'delivered',  total: 50,  channel: 'ebay', at }), // C15.8
      // non-countable — must be excluded by both
      mkOrder({ id: 'e', status: 'cancelled',       total: 500, at }),
      mkOrder({ id: 'f', status: 'pending_payment', total: 250, at }),
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const now = new Date()
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getMonthlyReport(now.getUTCFullYear(), now.getUTCMonth() + 1),
    ])

    // Countable sum = 200+300+400+100+50 = 1050 (incl. eBay)
    expect(dash.thisMonth.revenue).toBe('1050.00')
    expect(fin.currentMonth.gross).toBe('1050.00')
    expect(dash.thisMonth.revenue).toBe(fin.currentMonth.gross)
  })

  it('by-channel breakdown: per-channel sums match between dashboard and finance', async () => {
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'confirmed',  total: 100, channel: 'website',   at }),
      mkOrder({ id: 'b', status: 'shipped',    total: 200, channel: 'website',   at }),
      mkOrder({ id: 'c', status: 'delivered',  total: 150, channel: 'facebook',  at }),
      mkOrder({ id: 'd', status: 'delivered',  total: 50,  channel: 'instagram', at }),
      // non-countable, must not leak into any channel's total
      mkOrder({ id: 'e', status: 'pending',    total: 999, channel: 'website',   at }),
      mkOrder({ id: 'f', status: 'cancelled',  total: 777, channel: 'facebook',  at }),
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    // Normalize both to a channel→gross map for easy comparison
    const dashByChannel = new Map<string, string>()
    for (const row of dash.todayByChannel ?? []) dashByChannel.set(row.channel, row.revenue)

    const finByChannel = new Map<string, string>()
    for (const row of fin.byChannel ?? []) finByChannel.set(row.channel, row.gross)

    expect(dashByChannel.get('website')).toBe('300.00')   // 100 + 200
    expect(finByChannel.get('website')).toBe('300.00')

    expect(dashByChannel.get('facebook')).toBe('150.00')
    expect(finByChannel.get('facebook')).toBe('150.00')

    expect(dashByChannel.get('instagram')).toBe('50.00')
    expect(finByChannel.get('instagram')).toBe('50.00')

    // No leak: non-countable channels/totals absent from both
    const dashWebsiteAsNum = Number(dashByChannel.get('website'))
    const finWebsiteAsNum = Number(finByChannel.get('website'))
    expect(dashWebsiteAsNum + finWebsiteAsNum).toBeLessThan(999 * 2)
  })

  it('empty period: both services return 0 revenue', async () => {
    const prisma = buildMockPrisma({ orders: [] })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = new Date().toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    expect(dash.today.revenueGross).toBe('0.00')
    expect(fin.todaySales.gross).toBe('0.00')
    expect(dash.thisMonth.revenue).toBe('0.00')
  })

  it('only non-countable orders: both services return 0 revenue', async () => {
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'pending',         total: 100, at }),
      mkOrder({ id: 'b', status: 'pending_payment', total: 200, at }),
      mkOrder({ id: 'c', status: 'cancelled',       total: 300, at }),
      mkOrder({ id: 'd', status: 'disputed',        total: 400, at }),
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    expect(dash.today.revenueGross).toBe('0.00')
    expect(fin.todaySales.gross).toBe('0.00')
    expect(dash.today.orderCount).toBe(0)
    expect(fin.todaySales.orderCount).toBe(0)
  })

  it('soft-deleted orders: excluded from both services', async () => {
    // An order with deletedAt set must not count toward revenue in either
    // service. Catches a regression where a future dev forgets the
    // `deletedAt: null` filter in either place.
    const at = utcMidday()
    const softDeleted = mkOrder({ id: 'soft', status: 'delivered', total: 1000, at })
    softDeleted.deletedAt = new Date(at.getTime() - 3600_000)  // deleted 1h ago

    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'delivered', total: 50, at }),
      softDeleted,
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    // Only the live order counts (€50), soft-deleted is excluded
    expect(dash.today.revenueGross).toBe('50.00')
    expect(fin.todaySales.gross).toBe('50.00')
    expect(dash.today.orderCount).toBe(1)
    expect(fin.todaySales.orderCount).toBe(1)
  })

  it('mixed countable/non-countable numerical equality (randomised shapes)', async () => {
    // Lightly randomised: different totals per status, guarantees the test
    // catches hardcoded-constant regressions rather than dataset-specific
    // fluke agreement.
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: '1', status: 'confirmed',  total: 23.45, channel: 'website', at }),
      mkOrder({ id: '2', status: 'processing', total: 119.99, channel: 'tiktok', at }),
      mkOrder({ id: '3', status: 'shipped',    total: 7.00, channel: 'website', at }),
      mkOrder({ id: '4', status: 'delivered',  total: 442.10, channel: 'instagram', at }),
      mkOrder({ id: '5', status: 'returned',   total: 15.55, channel: 'website', at }),
      mkOrder({ id: '6', status: 'refunded',   total: 88.88, channel: 'facebook', at }),
      // non-countable
      mkOrder({ id: '7', status: 'pending',    total: 9999, channel: 'website', at }),
      mkOrder({ id: '8', status: 'cancelled',  total: 5555, channel: 'website', at }),
    ]
    const prisma = buildMockPrisma({ orders: seed })
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    // Both must match exactly (string equality on .toFixed(2))
    expect(dash.today.revenueGross).toBe(fin.todaySales.gross)
    expect(dash.today.orderCount).toBe(fin.todaySales.orderCount)

    // Non-countable totals NOT included — prove by hand the expected sum
    const expectedCountable = 23.45 + 119.99 + 7.00 + 442.10 + 15.55 + 88.88
    expect(Number(dash.today.revenueGross)).toBeCloseTo(expectedCountable, 2)
  })
})
