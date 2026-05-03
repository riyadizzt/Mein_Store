/**
 * C15.7 regression — DashboardService.getOverview recent-activity widget
 * MUST exclude tier='ephemeral' rows always (no toggle on dashboard).
 *
 * Architectural contract: dashboard recent-activity is the "executive
 * summary" view of human-driven admin actions, not telemetry. Without
 * this filter, ~106 ebay-deletion-notifications/h would dominate the
 * timeline and bury real admin events.
 *
 * Test verifies the prisma.adminAuditLog.findMany call within
 * dashboard.getOverview() includes `where: { tier: { not: 'ephemeral' } }`.
 */

import { DashboardService } from '../services/dashboard.service'

describe('DashboardService.getOverview — C15.7 recent-activity tier filter', () => {
  it('recent-activity query excludes tier=ephemeral (no toggle on dashboard)', async () => {
    const auditFindManyCalls: any[] = []
    const prisma: any = {
      // Audit-log call we care about — capture args
      adminAuditLog: {
        findMany: jest.fn().mockImplementation((args: any) => {
          auditFindManyCalls.push(args)
          return Promise.resolve([])
        }),
      },
      // Stubs for everything else dashboard.getOverview reads
      order: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      payment: { groupBy: jest.fn().mockResolvedValue([]) },
      refund: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
      return: { findMany: jest.fn().mockResolvedValue([]) },
      abandonedCart: { findMany: jest.fn().mockResolvedValue([]) },
      searchLog: { count: jest.fn().mockResolvedValue(0) },
      shopSetting: { findMany: jest.fn().mockResolvedValue([]) },
      product: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      inventory: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      user: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }

    const dashboard = new DashboardService(prisma as any)
    await dashboard.getOverview()

    // Of all adminAuditLog.findMany calls, the recent-activity one is
    // identified by orderBy:{createdAt:'desc'} + take:10. Must include
    // the tier filter.
    const recentCall = auditFindManyCalls.find(
      (c) => c?.orderBy?.createdAt === 'desc' && c?.take === 10,
    )
    expect(recentCall).toBeDefined()
    expect(recentCall.where).toEqual({ tier: { not: 'ephemeral' } })
  })
})
