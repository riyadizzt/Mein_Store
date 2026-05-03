/**
 * C15.7 regression — AuditService.findAll + getActionTypes tier filter.
 *
 * Architectural contract: admin audit-log default view excludes
 * tier='ephemeral' rows because they represent high-volume system
 * telemetry (eBay LOPP webhooks etc.) with zero regulatory or business
 * value. Opt-in via excludeEphemeral=false.
 *
 * 4 cases:
 *   1. Default → where.tier = { not: 'ephemeral' } applied
 *   2. excludeEphemeral=false → where.tier NOT set (returns all rows)
 *   3. Pagination/count consistency under filter
 *   4. Combined action-filter + tier-filter both applied
 *
 * Plus 2 cases for getActionTypes:
 *   5. Default → action-types dropdown excludes ephemeral actions
 *   6. excludeEphemeral=false → all distinct actions returned
 */

import { AuditService } from '../services/audit.service'

function buildPrisma(): { service: AuditService; prisma: any; calls: { findManyArgs: any[]; countArgs: any[]; distinctArgs: any[] } } {
  const calls = { findManyArgs: [] as any[], countArgs: [] as any[], distinctArgs: [] as any[] }
  const prisma: any = {
    adminAuditLog: {
      findMany: jest.fn().mockImplementation((args: any) => {
        if (args.distinct) {
          calls.distinctArgs.push(args)
          return Promise.resolve([])
        }
        calls.findManyArgs.push(args)
        return Promise.resolve([])
      }),
      count: jest.fn().mockImplementation((args: any) => {
        calls.countArgs.push(args)
        return Promise.resolve(0)
      }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const service = new AuditService(prisma as any)
  return { service, prisma, calls }
}

describe('AuditService.findAll — C15.7 tier filter', () => {
  it('1. default (no excludeEphemeral) → where.tier excludes ephemeral', async () => {
    const { service, calls } = buildPrisma()

    await service.findAll({ page: 1, limit: 50 })

    expect(calls.findManyArgs).toHaveLength(1)
    expect(calls.countArgs).toHaveLength(1)

    const findManyWhere = calls.findManyArgs[0].where
    const countWhere = calls.countArgs[0].where

    expect(findManyWhere.tier).toEqual({ not: 'ephemeral' })
    expect(countWhere.tier).toEqual({ not: 'ephemeral' })
  })

  it('2. excludeEphemeral=false → no tier filter applied (backward compat)', async () => {
    const { service, calls } = buildPrisma()

    await service.findAll({ page: 1, limit: 50, excludeEphemeral: false })

    expect(calls.findManyArgs).toHaveLength(1)
    expect(calls.countArgs).toHaveLength(1)

    const findManyWhere = calls.findManyArgs[0].where
    const countWhere = calls.countArgs[0].where

    // tier key must NOT be present (allowing all rows including ephemeral)
    expect(findManyWhere.tier).toBeUndefined()
    expect(countWhere.tier).toBeUndefined()
  })

  it('3. pagination + count use the SAME where (consistency under tier filter)', async () => {
    const { service, calls } = buildPrisma()

    await service.findAll({ page: 2, limit: 25 })

    expect(calls.findManyArgs).toHaveLength(1)
    expect(calls.countArgs).toHaveLength(1)

    // findMany and count MUST share where-clause shape (same tier filter)
    expect(calls.findManyArgs[0].where).toEqual(calls.countArgs[0].where)
    expect(calls.findManyArgs[0].skip).toBe(25) // (page-1) * limit
    expect(calls.findManyArgs[0].take).toBe(25)
  })

  it('4. combined action + tier filter → both applied with AND semantics', async () => {
    const { service, calls } = buildPrisma()

    await service.findAll({ page: 1, limit: 50, action: 'EBAY_ACCOUNT_DELETION_RECEIVED' })

    const where = calls.findManyArgs[0].where
    expect(where.tier).toEqual({ not: 'ephemeral' })
    expect(where.action).toEqual({ contains: 'EBAY_ACCOUNT_DELETION_RECEIVED', mode: 'insensitive' })
    // Sanity: the natural result of this combination is empty (Owner-repro
    // for the "user selects ephemeral action while toggle hides it" UX gap).
  })
})

describe('AuditService.getActionTypes — C15.7 tier filter', () => {
  it('5. default (no opts) → distinct query excludes ephemeral actions', async () => {
    const { service, calls } = buildPrisma()

    await service.getActionTypes()

    expect(calls.distinctArgs).toHaveLength(1)
    expect(calls.distinctArgs[0].where).toEqual({ tier: { not: 'ephemeral' } })
    expect(calls.distinctArgs[0].distinct).toEqual(['action'])
  })

  it('6. excludeEphemeral=false → distinct query returns ALL actions', async () => {
    const { service, calls } = buildPrisma()

    await service.getActionTypes({ excludeEphemeral: false })

    expect(calls.distinctArgs).toHaveLength(1)
    // No tier filter — all actions including ephemeral ones
    expect(calls.distinctArgs[0].where).toEqual({})
  })
})
