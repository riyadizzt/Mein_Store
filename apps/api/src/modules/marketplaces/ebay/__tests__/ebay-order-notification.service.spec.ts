/**
 * EbayOrderNotificationService unit tests.
 *
 * Covers (mirrors EbayAccountDeletionService.spec patterns where the
 * signature-verifier is byte-equal duplicated; intentional per
 * Hard-Rule "do not extract"):
 *   - 401 on missing / malformed / incomplete X-EBAY-SIGNATURE
 *   - kid-cache hit on second call (no second fetch)
 *   - getPublicKey 4xx → 401, 5xx → 401
 *   - parseEnvelope: 400 on invalid JSON / shape / missing notification fields
 *   - Missing orderId in notification.data → 400
 *   - publishDate too old → still proceeds (logged, idempotency-gate handles)
 *   - getOrder() failure bubbles up unchanged (controller answers 5xx)
 *   - Happy path: fetches order, builds MarketplaceImportEvent, delegates
 *     to MarketplaceImportService, returns its outcome
 *   - rawEventId propagated as notificationId
 *   - source='webhook' on the event
 *
 * Real ECDSA test crypto: a P-256 keypair is generated once per
 * describe-block and the matching public-key PEM is returned by the
 * stubbed getPublicKey lookup.
 */

import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { EbayOrderNotificationService } from '../ebay-order-notification.service'

// We mock EbayApiClient at the module level — keeps fetchOrderFromEbay
// fully under test control without requiring env-vars to resolve.
jest.mock('../ebay-api.client', () => {
  const actual = jest.requireActual('../ebay-api.client')
  return {
    ...actual,
    EbayApiClient: jest.fn().mockImplementation(() => ({
      request: jest.fn(),
    })),
  }
})

// Mock resolveEbayEnv so the test never trips the env-var validator
jest.mock('../ebay-env', () => {
  const actual = jest.requireActual('../ebay-env')
  return {
    ...actual,
    resolveEbayEnv: jest.fn(() => ({
      mode: 'sandbox',
      apiBaseUrl: 'https://api.sandbox.ebay.com',
      oauthAuthorizationUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
      oauthTokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
      marketplaceId: 'EBAY_DE',
      redirectAcceptedCallbackPath: '/api/v1/admin/marketplaces/ebay/oauth-callback',
      appId: 'TEST',
      devId: 'TEST',
      certId: 'TEST',
      ruName: 'TEST',
    })),
    resolveEbayMode: jest.fn(() => 'sandbox'),
  }
})

import { EbayApiClient } from '../ebay-api.client'

function makeService(overrides?: {
  auth?: any
  importService?: any
  // C15.1: prisma + audit added for the new webhook-idempotency
  // pre-check path. Defaults: findUnique returns null (no duplicate)
  // → existing tests proceed unchanged through the new branch.
  prisma?: any
  audit?: any
}) {
  const auth = overrides?.auth ?? {
    getApplicationAccessToken: jest.fn().mockResolvedValue('test-app-token'),
    getAccessTokenOrRefresh: jest.fn().mockResolvedValue('test-bearer'),
  }
  const importService = overrides?.importService ?? {
    processMarketplaceOrderEvent: jest
      .fn()
      .mockResolvedValue({
        status: 'imported',
        importId: 'imp-1',
        orderId: 'ord-1',
        orderNumber: 'ORD-MP-1',
      }),
  }
  const prisma = overrides?.prisma ?? {
    marketplaceOrderImport: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  }
  const audit = overrides?.audit ?? { log: jest.fn().mockResolvedValue(undefined) }
  const service = new EbayOrderNotificationService(
    auth as any,
    importService as any,
    prisma as any,
    audit as any,
  )
  service.__clearPublicKeyCacheForTests()
  // Reset the mocked client request impl per test
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: jest.fn().mockResolvedValue({ orderId: 'EX-1', /* full payload */ }),
  }))
  return { service, auth, importService, prisma, audit }
}

// ──────────────────────────────────────────────────────────────
// Signature verification — early rejects (no crypto needed)
// ──────────────────────────────────────────────────────────────

describe('EbayOrderNotificationService.handleNotification — signature header rejects', () => {
  it('rejects 401 when X-EBAY-SIGNATURE is missing', async () => {
    const { service } = makeService()
    await expect(
      service.handleNotification(Buffer.from('{}'), undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects 401 when signature header is not valid base64 JSON', async () => {
    const { service } = makeService()
    await expect(
      service.handleNotification(Buffer.from('{}'), '!!!not-base64!!!'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects 401 when signature JSON is missing kid', async () => {
    const { service } = makeService()
    const header = Buffer.from(
      JSON.stringify({ alg: 'ECDSA', signature: 'sig' }),
    ).toString('base64')
    await expect(
      service.handleNotification(Buffer.from('{}'), header),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects 401 when signature JSON is missing signature field', async () => {
    const { service } = makeService()
    const header = Buffer.from(
      JSON.stringify({ alg: 'ECDSA', kid: 'k1' }),
    ).toString('base64')
    await expect(
      service.handleNotification(Buffer.from('{}'), header),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

// ──────────────────────────────────────────────────────────────
// Real-crypto ECDSA flow + envelope parsing + delegation
// ──────────────────────────────────────────────────────────────

describe('EbayOrderNotificationService.handleNotification — ECDSA + delegation', () => {
  // P-256 keypair shared across this block. Public key is what the
  // stubbed getPublicKey returns; we sign the body with the matching
  // private key so createVerify('SHA1') passes end-to-end.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const KID = 'order-test-kid'

  function signBody(body: Buffer): string {
    const signer = createSign('SHA1')
    signer.update(body)
    signer.end()
    const signature = signer.sign(privateKey).toString('base64')
    const header = { alg: 'ECDSA', kid: KID, signature, digest: 'SHA1' }
    return Buffer.from(JSON.stringify(header)).toString('base64')
  }

  function stubPublicKeyFetch(opts?: { status?: number; body?: any }): any {
    const status = opts?.status ?? 200
    const body = opts?.body ?? { key: publicKeyPem, algorithm: 'ECDSA' }
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  }

  // Build a fresh notification envelope. publishDate fresh by default.
  function buildPayload(overrides?: { orderId?: string; publishDate?: string; notificationId?: string }) {
    return {
      metadata: { topic: 'ITEM_SOLD', schemaVersion: '1.0', deprecated: false },
      notification: {
        notificationId: overrides?.notificationId ?? 'notif-order-1',
        eventDate: new Date().toISOString(),
        publishDate: overrides?.publishDate ?? new Date().toISOString(),
        publishAttemptCount: 1,
        data: {
          orderId: overrides?.orderId ?? 'EX-100',
          username: 'someuser',
          userId: 'someuserid',
        },
      },
    }
  }

  // ── envelope shape rejects (still need a passing signature)

  it('rejects 400 when envelope JSON is invalid', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const body = Buffer.from('not json{')
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects 400 when envelope is missing notification block', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const bad = { metadata: { topic: 'ITEM_SOLD' } }
    const body = Buffer.from(JSON.stringify(bad))
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects 400 when notification is missing notificationId', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const bad = {
      metadata: { topic: 'ITEM_SOLD' },
      notification: {
        eventDate: '2026-04-28T00:00:00Z',
        publishDate: '2026-04-28T00:00:00Z',
        data: { orderId: 'X' },
      },
    }
    const body = Buffer.from(JSON.stringify(bad))
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects 400 when notification.data has no orderId/legacyOrderId', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const noOrder = buildPayload()
    delete (noOrder.notification.data as any).orderId
    const body = Buffer.from(JSON.stringify(noOrder))
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('accepts legacyOrderId as fallback when orderId is missing', async () => {
    const { service, importService } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const payload = buildPayload()
    ;(payload.notification.data as any).orderId = undefined
    ;(payload.notification.data as any).legacyOrderId = 'LEG-99'
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    await service.handleNotification(body, header)
    const event = (importService.processMarketplaceOrderEvent as jest.Mock).mock.calls[0][0]
    expect(event.externalOrderId).toBe('LEG-99')
  })

  // ── public-key fetch failures

  it('rejects 401 when getPublicKey returns 4xx', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch({ status: 404 }))
    const body = Buffer.from(JSON.stringify(buildPayload()))
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('rejects 401 when getPublicKey returns 5xx', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch({ status: 502 }))
    const body = Buffer.from(JSON.stringify(buildPayload()))
    const header = signBody(body)
    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  // ── happy path delegates to MarketplaceImportService

  it('happy path: signs, parses, fetches order, delegates', async () => {
    const { service, importService } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    // Stub EbayApiClient.request to return an order payload
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
      request: jest.fn().mockResolvedValue({
        orderId: 'EX-100',
        buyer: { username: 'someuser' },
        lineItems: [],
      }),
    }))

    const payload = buildPayload({ orderId: 'EX-100' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    const result = await service.handleNotification(body, header)

    expect(importService.processMarketplaceOrderEvent).toHaveBeenCalledTimes(1)
    const event = (importService.processMarketplaceOrderEvent as jest.Mock).mock.calls[0][0]
    expect(event).toMatchObject({
      marketplace: 'EBAY',
      externalOrderId: 'EX-100',
      rawEventId: 'notif-order-1',
      source: 'webhook',
    })
    expect(event.rawEventPayload).toMatchObject({ orderId: 'EX-100' })
    expect(result).toEqual({
      status: 'imported',
      importId: 'imp-1',
      orderId: 'ord-1',
      orderNumber: 'ORD-MP-1',
    })
  })

  it('caches public key by kid: second call does not refetch', async () => {
    const { service } = makeService()
    const fetchStub = stubPublicKeyFetch()
    service.__setFetchForTests(fetchStub)

    const payload = buildPayload({ orderId: 'EX-101' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    await service.handleNotification(body, header)
    await service.handleNotification(body, header)

    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  // ── publishDate window: stale still proceeds (idempotency-gate handles)

  it('proceeds (warn-log) when publishDate is older than 5 minutes', async () => {
    const { service, importService } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    // 10 min in the past
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const payload = buildPayload({ publishDate: stale })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    const result = await service.handleNotification(body, header)
    expect(importService.processMarketplaceOrderEvent).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  // ── getOrder() bubbles errors up

  it('bubbles getOrder() errors up the call stack', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
      request: jest.fn().mockRejectedValue(new Error('500 Internal Server Error from eBay')),
    }))

    const payload = buildPayload({ orderId: 'EX-fail' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    await expect(service.handleNotification(body, header)).rejects.toThrow(
      /500 Internal Server Error/,
    )
  })

  // ─────────────────────────────────────────────────────────────
  // C15.1 — Webhook idempotency pre-check
  // ─────────────────────────────────────────────────────────────

  it('C15.1 duplicate webhook: pre-check finds existing → returns null + ephemeral audit + NO getOrder()', async () => {
    const existing = {
      id: 'imp-prev-1',
      externalOrderId: 'EX-100',
      status: 'IMPORTED',
      orderId: 'ord-prev-1',
    }
    const findUnique = jest.fn().mockResolvedValue(existing)
    const auditLog = jest.fn().mockResolvedValue(undefined)
    const requestMock = jest.fn() // should NOT be called
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
      request: requestMock,
    }))

    const { service, importService } = makeService({
      prisma: {
        marketplaceOrderImport: { findUnique },
      },
      audit: { log: auditLog },
    })
    service.__setFetchForTests(stubPublicKeyFetch())

    const payload = buildPayload({ notificationId: 'dup-notif-1', orderId: 'EX-100' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    const result = await service.handleNotification(body, header)

    expect(result).toBeNull()
    // Idempotency lookup happened with the unique-constraint name
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          marketplace_raw_event_unique: { marketplace: 'EBAY', rawEventId: 'dup-notif-1' },
        }),
      }),
    )
    // getOrder() was NOT called (saved an eBay-API rate-limit slot)
    expect(requestMock).not.toHaveBeenCalled()
    // Glue service was NOT delegated to
    expect(importService.processMarketplaceOrderEvent).not.toHaveBeenCalled()
    // Ephemeral audit-row written for the duplicate
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EBAY_WEBHOOK_DUPLICATE',
        tier: 'ephemeral',
        entityType: 'marketplace_order_import',
        entityId: 'imp-prev-1',
      }),
    )
  })

  it('C15.1 fresh notification: pre-check finds nothing → normal flow proceeds', async () => {
    const findUnique = jest.fn().mockResolvedValue(null)
    const { service, importService } = makeService({
      prisma: { marketplaceOrderImport: { findUnique } },
    })
    service.__setFetchForTests(stubPublicKeyFetch())
    // Override AFTER makeService — its constructor resets the
    // EbayApiClient mock implementation.
    const requestMock = jest.fn().mockResolvedValue({ orderId: 'EX-200' })
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
      request: requestMock,
    }))

    const payload = buildPayload({ notificationId: 'fresh-notif-1', orderId: 'EX-200' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    const result = await service.handleNotification(body, header)

    expect(findUnique).toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledTimes(1) // getOrder ran
    expect(importService.processMarketplaceOrderEvent).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  it('C15.1 pre-check DB-error → falls through to normal flow (defense-in-depth)', async () => {
    const findUnique = jest.fn().mockRejectedValue(new Error('DB unreachable'))
    const { service, importService } = makeService({
      prisma: { marketplaceOrderImport: { findUnique } },
    })
    service.__setFetchForTests(stubPublicKeyFetch())
    const requestMock = jest.fn().mockResolvedValue({ orderId: 'EX-300' })
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
      request: requestMock,
    }))

    const payload = buildPayload({ notificationId: 'maybe-dup', orderId: 'EX-300' })
    const body = Buffer.from(JSON.stringify(payload))
    const header = signBody(body)

    // Should not throw — normal flow runs, downstream (marketplace,
    // externalOrderId) unique-check is the second-line defense.
    const result = await service.handleNotification(body, header)

    expect(findUnique).toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(importService.processMarketplaceOrderEvent).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })
})
