/**
 * EbayStockReconcileCron (C15) unit tests.
 *
 * Pins down (mirror of C14 cron spec pattern):
 *   - tick() delegates to runReconcileTick()
 *   - Cron tick method is on the prototype (SafeCron decorator
 *     wraps but keeps method accessible).
 *   - Service exception bubbles to SafeCron's crash-event emitter
 *     (the wrapper does NOT swallow — re-throws after emit).
 */

import 'reflect-metadata'
import { EbayStockReconcileCron } from '../ebay-stock-reconcile.cron'

function makeCron(tickImpl?: jest.Mock) {
  const reconcileService = {
    runReconcileTick:
      tickImpl ??
      jest.fn().mockResolvedValue({
        scanned: 0, pushed: 0, skipped: 0, failed: 0, rateLimited: false, items: [],
      }),
  } as any
  return { cron: new EbayStockReconcileCron(reconcileService), reconcileService }
}

describe('EbayStockReconcileCron', () => {
  it('tick() delegates to runReconcileTick', async () => {
    const tick = jest.fn().mockResolvedValue({
      scanned: 7, pushed: 3, skipped: 4, failed: 0, rateLimited: false, items: [],
    })
    const { cron, reconcileService } = makeCron(tick)

    await cron.tick()

    expect(reconcileService.runReconcileTick).toHaveBeenCalledTimes(1)
  })

  it('cron tick method exists on the class prototype', () => {
    // The @SafeCron decorator wraps the original method but keeps
    // it accessible on the prototype. Same assertion-shape as
    // EbayShippingPushCron spec.
    expect(typeof EbayStockReconcileCron.prototype.tick).toBe('function')
  })

  it('service throw bubbles up — SafeCron handles crash-event emission', async () => {
    const tick = jest.fn().mockRejectedValue(new Error('reconcile crash'))
    const { cron } = makeCron(tick)

    await expect(cron.tick()).rejects.toThrow(/reconcile crash/)
  })
})
