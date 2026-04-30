/**
 * EbayOrderNotificationController (C15.2 hotfix) unit tests.
 *
 * Pins down:
 *   1. Raw-envelope first-run-logging — first 10 hits emit body.
 *   2. After 10 hits, raw body is no longer logged (log-bloat guard).
 *   3. Service throws BadRequestException with the orderId-missing
 *      marker → controller swallows + returns 204 + admin-notifies.
 *   4. UnauthorizedException (signature fail) STILL bubbles — must
 *      remain a 401 so eBay can fix it on its side.
 *   5. Generic 4xx (BadRequestException with different message)
 *      STILL bubbles.
 *   6. ORDER_ID_MISSING_MARKER is the literal string the service
 *      throws — regression guard against silent drift between the
 *      service-side message and the controller-side catch.
 */

import 'reflect-metadata'
import { BadRequestException, UnauthorizedException, Logger } from '@nestjs/common'
import {
  EbayOrderNotificationController,
  ORDER_ID_MISSING_MARKER,
  __resetEbayWebhookLogCounterForTests,
} from '../ebay-order-notification.controller'

function makeReq(rawBody: string | Buffer = Buffer.from('{}')): any {
  return { rawBody: typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody }
}

function makeController(opts?: {
  serviceImpl?: jest.Mock
}) {
  const handleNotification =
    opts?.serviceImpl ?? jest.fn().mockResolvedValue({ status: 'imported', importId: 'imp-1' })
  const service = { handleNotification } as any
  const notifyAdapter = {
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as any
  const ctrl = new EbayOrderNotificationController(service, notifyAdapter)
  return { ctrl, service, notifyAdapter, handleNotification }
}

describe('EbayOrderNotificationController (C15.2)', () => {
  beforeEach(() => {
    __resetEbayWebhookLogCounterForTests()
  })

  // ─────────────────────────────────────────────────────────────
  // Marker invariant
  // ─────────────────────────────────────────────────────────────

  it('ORDER_ID_MISSING_MARKER is the literal string used by the service', () => {
    // Pinning the marker here ensures the controller's catch and the
    // service's throw stay in lock-step. If anyone refactors the
    // service to a different wording, this test fires loud + the
    // graceful-degradation branch silently breaks otherwise.
    expect(ORDER_ID_MISSING_MARKER).toBe('notification.data.orderId missing')
  })

  // ─────────────────────────────────────────────────────────────
  // First-Run-Logging
  // ─────────────────────────────────────────────────────────────

  it('logs raw envelope for first hit', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { ctrl } = makeController()

    const body = '{"metadata":{"topic":"ITEM_SOLD"},"notification":{"foo":"bar"}}'
    await ctrl.notification(makeReq(body) as any, 'sig')

    const rawCall = logSpy.mock.calls.find((c) =>
      String(c[0]).includes('[ebay-order-webhook] raw envelope'),
    )
    expect(rawCall).toBeDefined()
    expect(String(rawCall![0])).toContain('"topic":"ITEM_SOLD"')
    logSpy.mockRestore()
  })

  it('stops logging raw envelope after 10 hits (log-bloat guard)', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { ctrl } = makeController()
    const body = '{"x":1}'

    // 11 invocations
    for (let i = 0; i < 11; i++) {
      await ctrl.notification(makeReq(body) as any, 'sig')
    }
    const rawCalls = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('[ebay-order-webhook] raw envelope'),
    )
    expect(rawCalls).toHaveLength(10)
    logSpy.mockRestore()
  })

  it('emits "diagnostic logging disabled" marker EXACTLY ONCE on the 10th hit', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { ctrl } = makeController()
    const body = '{"x":1}'

    // 12 invocations — diagnostic marker should fire on call #10 only
    for (let i = 0; i < 12; i++) {
      await ctrl.notification(makeReq(body) as any, 'sig')
    }
    const markerCalls = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('raw-body diagnostic logging disabled'),
    )
    expect(markerCalls).toHaveLength(1)
    expect(String(markerCalls[0][0])).toContain('limit reached')
    expect(String(markerCalls[0][0])).toContain('10 envelopes')
    expect(String(markerCalls[0][0])).toContain('C15.4')
    logSpy.mockRestore()
  })

  it('marker is NOT emitted before the 10th hit', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { ctrl } = makeController()
    const body = '{"x":1}'

    // 9 invocations — marker should NOT fire yet
    for (let i = 0; i < 9; i++) {
      await ctrl.notification(makeReq(body) as any, 'sig')
    }
    const markerCalls = logSpy.mock.calls.filter((c) =>
      String(c[0]).includes('raw-body diagnostic logging disabled'),
    )
    expect(markerCalls).toHaveLength(0)
    logSpy.mockRestore()
  })

  it('truncates raw envelope to 3000 chars', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { ctrl } = makeController()

    const huge = 'x'.repeat(5000)
    await ctrl.notification(makeReq(huge) as any, 'sig')

    const rawCall = logSpy.mock.calls.find((c) =>
      String(c[0]).includes('[ebay-order-webhook] raw envelope'),
    )
    // Header text "[ebay-order-webhook] raw envelope #1/10: " ≈ 42 chars
    // + at most 3000 of x's → total < 3100
    expect(String(rawCall![0]).length).toBeLessThan(3100)
    logSpy.mockRestore()
  })

  // ─────────────────────────────────────────────────────────────
  // Graceful degradation — orderId-missing path
  // ─────────────────────────────────────────────────────────────

  it('orderId-missing → returns 204 (no throw) + admin-notify + no eBay retry-storm', async () => {
    const handleNotification = jest
      .fn()
      .mockRejectedValue(new BadRequestException(ORDER_ID_MISSING_MARKER))
    const { ctrl, notifyAdapter } = makeController({ serviceImpl: handleNotification })

    // Should NOT throw
    await expect(ctrl.notification(makeReq() as any, 'sig')).resolves.toBeUndefined()

    expect(notifyAdapter.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ebay_webhook_payload_unknown_schema',
        data: expect.objectContaining({
          error: expect.stringContaining(ORDER_ID_MISSING_MARKER),
        }),
      }),
    )
  })

  it('orderId-missing path: admin-notify failure does NOT propagate', async () => {
    const handleNotification = jest
      .fn()
      .mockRejectedValue(new BadRequestException(ORDER_ID_MISSING_MARKER))
    const { ctrl, notifyAdapter } = makeController({ serviceImpl: handleNotification })
    ;(notifyAdapter.notifyAdmins as jest.Mock).mockRejectedValueOnce(new Error('notif DB down'))

    // Even when notify throws, controller still returns gracefully
    await expect(ctrl.notification(makeReq() as any, 'sig')).resolves.toBeUndefined()
  })

  // ─────────────────────────────────────────────────────────────
  // Other errors STILL bubble (graceful-degradation is surgical)
  // ─────────────────────────────────────────────────────────────

  it('signature failure (401) STILL bubbles — eBay must fix', async () => {
    const handleNotification = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('signature verification failed'))
    const { ctrl, notifyAdapter } = makeController({ serviceImpl: handleNotification })

    await expect(ctrl.notification(makeReq() as any, 'sig')).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(notifyAdapter.notifyAdmins).not.toHaveBeenCalled()
  })

  it('generic 400 (different message) STILL bubbles', async () => {
    const handleNotification = jest
      .fn()
      .mockRejectedValue(new BadRequestException('invalid envelope shape'))
    const { ctrl, notifyAdapter } = makeController({ serviceImpl: handleNotification })

    await expect(ctrl.notification(makeReq() as any, 'sig')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(notifyAdapter.notifyAdmins).not.toHaveBeenCalled()
  })

  it('5xx-ish errors (network / EbayApiError) STILL bubble for eBay retry', async () => {
    const handleNotification = jest
      .fn()
      .mockRejectedValue(new Error('network timeout'))
    const { ctrl, notifyAdapter } = makeController({ serviceImpl: handleNotification })

    await expect(ctrl.notification(makeReq() as any, 'sig')).rejects.toThrow(/network timeout/)
    expect(notifyAdapter.notifyAdmins).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────
  // Missing rawBody — pre-existing 400, unchanged
  // ─────────────────────────────────────────────────────────────

  it('missing rawBody → 400 (unchanged behaviour)', async () => {
    const { ctrl } = makeController()
    const reqNoBody = { rawBody: undefined }
    await expect(ctrl.notification(reqNoBody as any, 'sig')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
