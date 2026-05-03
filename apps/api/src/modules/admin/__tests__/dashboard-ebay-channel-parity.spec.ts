/**
 * C17 regression — DashboardService and FinanceReportsService MUST agree
 * on revenue totals when seed contains mixed website + eBay orders.
 *
 * Pre-C17 the dashboard had NO channel filter (would over-count eBay)
 * while finance-reports excluded eBay (under-counted). The two surfaces
 * disagreed on totals for the same period — exactly the consistency-
 * drift bug shape that financial-consistency.spec.ts was designed to
 * catch but missed because its seeds had no eBay orders.
 *
 * This spec adds explicit eBay-channel parity coverage. Reverting the
 * dashboard or finance ONLINE_CHANNELS change makes this test fail.
 */

import { DashboardService } from '../services/dashboard.service'
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

function matchesOrderWhere(order: SeedOrder, where: any): boolean {
  if (!where) return true
  if (where.deletedAt === null && order.deletedAt !== null) return false
  if (where.firstViewedByAdminAt === null && order.firstViewedByAdminAt !== null) return false
  if (where.status?.in && !where.status.in.includes(order.status)) return false
  if (where.channel?.in && !where.channel.in.includes(order.channel)) return false
  if (where.createdAt) {
    if (where.createdAt.gte && order.createdAt < where.createdAt.gte) return false
    if (where.createdAt.lte && order.createdAt > where.createdAt.lte) return false
    if (where.createdAt.lt && order.createdAt >= where.createdAt.lt) return false
  }
  return true
}

function buildMockPrisma(orders: SeedOrder[]) {
  const aggregate = (where: any, _sum: any, _count: boolean | undefined) => {
    const matching = orders.filter((o) => matchesOrderWhere(o, where ?? {}))
    const sums: any = {}
    if (_sum) {
      for (const key of Object.keys(_sum)) {
        sums[key] = matching.length === 0 ? null : matching.reduce((s, o: any) => s + (o[key] ?? 0), 0)
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
  const mock: any = {
    order: {
      aggregate: jest.fn(({ where, _sum, _count }: any) => Promise.resolve(aggregate(where, _sum, _count))),
      groupBy: jest.fn((args: any) => Promise.resolve(groupBy(args))),
      count: jest.fn(({ where }: any) => Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})).length)),
      findMany: jest.fn(({ where }: any) => Promise.resolve(orders.filter((o) => matchesOrderWhere(o, where ?? {})))),
    },
    payment: { groupBy: jest.fn(() => Promise.resolve([])) },
    refund: { findMany: jest.fn(() => Promise.resolve([])), aggregate: jest.fn(() => Promise.resolve({ _sum: { amount: null } })), findFirst: jest.fn(() => Promise.resolve(null)) },
    return: { findMany: jest.fn(() => Promise.resolve([])) },
    abandonedCart: { findMany: jest.fn(() => Promise.resolve([])) },
    adminAuditLog: { findMany: jest.fn(() => Promise.resolve([])) },
    searchLog: { count: jest.fn(() => Promise.resolve(0)) },
    shopSetting: { findMany: jest.fn(() => Promise.resolve([])) },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn((fn: any) => (typeof fn === 'function' ? fn(mock) : Promise.all(fn))),
  }
  return mock
}

function mkOrder(opts: { id: string; status: string; total: number; channel?: string; at?: Date }): SeedOrder {
  const at = opts.at ?? new Date()
  return {
    id: opts.id,
    orderNumber: `ORD-${opts.id}`,
    status: opts.status,
    channel: opts.channel ?? 'website',
    subtotal: opts.total,
    totalAmount: opts.total,
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

describe('Financial consistency — Dashboard vs Finance with eBay channel (C17)', () => {
  it('eBay seed: dashboard.today.revenueGross === finance.todaySales.gross', async () => {
    // Mixed seeds: 1 website (€100) + 1 eBay (€50). Both services MUST
    // include both — total €150. Pre-C17, dashboard would have shown
    // €150 (no channel filter) but finance only €100 (eBay excluded).
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'delivered', total: 100, channel: 'website', at }),
      mkOrder({ id: 'b', status: 'delivered', total: 50, channel: 'ebay', at }),
    ]
    const prisma = buildMockPrisma(seed)
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    expect(dash.today.revenueGross).toBe('150.00')
    expect(fin.todaySales.gross).toBe('150.00')
    expect(dash.today.revenueGross).toBe(fin.todaySales.gross)
    expect(dash.today.orderCount).toBe(2)
    expect(fin.todaySales.orderCount).toBe(2)
  })

  it('POS-only seed: BOTH services exclude POS (defensive symmetry)', async () => {
    // POS is excluded from ONLINE_CHANNELS. Dashboard pre-C17 had no
    // channel filter and would have included POS. Post-C17 both exclude.
    const at = utcMidday()
    const seed: SeedOrder[] = [
      mkOrder({ id: 'a', status: 'delivered', total: 100, channel: 'website', at }),
      mkOrder({ id: 'b', status: 'delivered', total: 999, channel: 'pos', at }), // must NOT count
    ]
    const prisma = buildMockPrisma(seed)
    const dashboard = new DashboardService(prisma as any)
    const finance = new FinanceReportsService(prisma as any)

    const todayStr = at.toISOString().slice(0, 10)
    const [dash, fin] = await Promise.all([
      dashboard.getOverview(),
      finance.getDailyReport(todayStr),
    ])

    expect(dash.today.revenueGross).toBe('100.00')
    expect(fin.todaySales.gross).toBe('100.00')
    expect(dash.today.orderCount).toBe(1)
    expect(fin.todaySales.orderCount).toBe(1)
  })
})
