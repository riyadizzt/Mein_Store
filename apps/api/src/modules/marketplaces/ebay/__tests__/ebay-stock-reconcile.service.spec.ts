/**
 * EbayStockReconcileService (C15) unit tests.
 *
 * Pins down:
 *   - runReconcileTick delegates to push-service.runReconcileTick
 *     with the documented MAX_LISTINGS_PER_TICK cap.
 *   - Idle tick (0 pushed/0 failed/no rate-limit) → NO audit-row
 *     (avoids audit-spam on quiet ticks).
 *   - Push-only tick → audit-row with action CHANNEL_STOCK_RECONCILE_TICK.
 *   - Failure-only tick → audit-row written.
 *   - Rate-limited tick → audit-row written.
 *   - Audit failure is swallowed (logger.warn, never propagated).
 *   - Returns the push-service result verbatim for cron-class consumption.
 */

import 'reflect-metadata'
import { EbayStockReconcileService } from '../ebay-stock-reconcile.service'
import type { PushBatchResult } from '../ebay-stock-push.service'

function makeResult(overrides: Partial<PushBatchResult> = {}): PushBatchResult {
  return {
    scanned: 0,
    pushed: 0,
    skipped: 0,
    failed: 0,
    rateLimited: false,
    items: [],
    ...overrides,
  }
}

function makeService(pushResult: PushBatchResult, opts: { auditThrows?: boolean } = {}) {
  const pushService = {
    runReconcileTick: jest.fn().mockResolvedValue(pushResult),
  } as any
  const audit = {
    log: opts.auditThrows
      ? jest.fn().mockRejectedValue(new Error('audit DB down'))
      : jest.fn().mockResolvedValue(undefined),
  } as any
  const service = new EbayStockReconcileService(pushService, audit)
  return { service, pushService, audit }
}

describe('EbayStockReconcileService.runReconcileTick', () => {
  it('delegates to push-service with cap (default 500)', async () => {
    const { service, pushService } = makeService(makeResult())

    await service.runReconcileTick()

    expect(pushService.runReconcileTick).toHaveBeenCalledTimes(1)
    expect(pushService.runReconcileTick).toHaveBeenCalledWith(500)
  })

  it('idle tick (0 activity) → NO audit row written (anti-spam)', async () => {
    const { service, audit } = makeService(makeResult({ scanned: 17, skipped: 17 }))

    await service.runReconcileTick()

    expect(audit.log).not.toHaveBeenCalled()
  })

  it('push-only tick → audit row CHANNEL_STOCK_RECONCILE_TICK', async () => {
    const { service, audit } = makeService(makeResult({ scanned: 5, pushed: 3, skipped: 2 }))

    await service.runReconcileTick()

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CHANNEL_STOCK_RECONCILE_TICK',
        entityType: 'channel_listing',
        entityId: 'batch',
      }),
    )
    const changes = (audit.log as jest.Mock).mock.calls[0][0].changes
    expect(changes.after.scanned).toBe(5)
    expect(changes.after.pushed).toBe(3)
    expect(changes.after.skipped).toBe(2)
    expect(changes.after.failed).toBe(0)
    expect(changes.after.rateLimited).toBe(false)
    expect(changes.after.durationMs).toEqual(expect.any(Number))
  })

  it('failure-only tick → audit row still written', async () => {
    const { service, audit } = makeService(makeResult({ scanned: 5, failed: 5 }))

    await service.runReconcileTick()

    expect(audit.log).toHaveBeenCalledTimes(1)
  })

  it('rate-limited tick → audit row written even with 0 push/0 fail', async () => {
    const { service, audit } = makeService(makeResult({ scanned: 25, rateLimited: true }))

    await service.runReconcileTick()

    expect(audit.log).toHaveBeenCalledTimes(1)
    expect((audit.log as jest.Mock).mock.calls[0][0].changes.after.rateLimited).toBe(true)
  })

  it('returns push-service result verbatim for cron consumption', async () => {
    const expected = makeResult({ scanned: 7, pushed: 4, skipped: 2, failed: 1 })
    const { service } = makeService(expected)

    const got = await service.runReconcileTick()

    expect(got).toBe(expected)
  })

  it('audit log failure is swallowed — does NOT propagate', async () => {
    const { service } = makeService(
      makeResult({ scanned: 1, pushed: 1 }),
      { auditThrows: true },
    )

    await expect(service.runReconcileTick()).resolves.toBeDefined()
  })
})
