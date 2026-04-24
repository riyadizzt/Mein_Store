/**
 * EbayAccountDeletionService unit tests.
 *
 * Covers:
 *   - handleChallenge: sha256(code + token + url) hex digest
 *   - handleChallenge: BadRequest when challenge_code missing
 *   - handleChallenge: throws when env vars unset
 *   - handleNotification: 401 on missing / malformed signature header
 *   - handleNotification: idempotency (duplicate notificationId ack'd silently)
 *   - handleNotification: happy path persists + audits
 *   - scanAndRedactBuyerData: pre-C12 contract (always false today)
 *
 * Signature verification uses an injected fetchImpl that stubs eBay's
 * public-key endpoint with a key whose corresponding private key we
 * use to sign our test payload. That keeps the ECDSA verify path real
 * (createVerify.SHA1 is exercised end-to-end) without hitting eBay.
 */

import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { createHash } from 'node:crypto'
import { EbayAccountDeletionService } from '../ebay-account-deletion.service'

function makeService(overrides?: { prisma?: any; audit?: any }) {
  const prisma = overrides?.prisma ?? {
    ebayDeletionNotification: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'row1' }),
    },
  }
  const audit = overrides?.audit ?? { log: jest.fn().mockResolvedValue(undefined) }
  const service = new EbayAccountDeletionService(prisma as any, audit as any)
  return { service, prisma, audit }
}

describe('EbayAccountDeletionService.handleChallenge', () => {
  const ORIGINAL_ENV = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns correct sha256 hex digest for valid challenge_code', () => {
    process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN =
      'testtoken123456789012345678901234'
    process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL =
      'https://example.com/api/v1/ebay/account-deletion'
    const { service } = makeService()
    const code = 'abc123'
    const expected = createHash('sha256')
      .update(
        code +
          process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN +
          process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL,
      )
      .digest('hex')
    const result = service.handleChallenge(code)
    expect(result.challengeResponse).toBe(expected)
    expect(result.challengeResponse).toMatch(/^[a-f0-9]{64}$/)
  })

  it('throws BadRequestException when challenge_code is missing', () => {
    process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN = 'x'.repeat(40)
    process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL = 'https://example.com/cb'
    const { service } = makeService()
    expect(() => service.handleChallenge('')).toThrow(BadRequestException)
  })

  it('throws when env not configured', () => {
    delete process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN
    delete process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL
    const { service } = makeService()
    expect(() => service.handleChallenge('abc')).toThrow('EbayDeletionWebhookNotConfigured')
  })
})

describe('EbayAccountDeletionService.handleNotification — signature verification', () => {
  it('rejects with 401 when X-EBAY-SIGNATURE header is missing', async () => {
    const { service } = makeService()
    await expect(service.handleNotification(Buffer.from('{}'), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('rejects with 401 when signature header is not valid base64 JSON', async () => {
    const { service } = makeService()
    await expect(
      service.handleNotification(Buffer.from('{}'), '!!!not-base64!!!'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects with 401 when signature JSON is missing required fields', async () => {
    const { service } = makeService()
    const header = Buffer.from(JSON.stringify({ alg: 'ECDSA' })).toString('base64')
    await expect(service.handleNotification(Buffer.from('{}'), header)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})

describe('EbayAccountDeletionService.handleNotification — full flow (ECDSA real crypto)', () => {
  // Generate an EC keypair once per test suite. Then sign the test body
  // with the private key, and stub eBay's getPublicKey to return the
  // matching public key — so createVerify.SHA1 runs end-to-end against
  // a real (test-only) signature.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const KID = 'test-key-id'

  function signBody(body: Buffer): string {
    const signer = createSign('SHA1')
    signer.update(body)
    signer.end()
    const signature = signer.sign(privateKey).toString('base64')
    const header = { alg: 'ECDSA', kid: KID, signature, digest: 'SHA1' }
    return Buffer.from(JSON.stringify(header)).toString('base64')
  }

  function stubPublicKeyFetch(): any {
    return jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: publicKeyPem, algorithm: 'ECDSA' }),
    })
  }

  const validPayload = {
    metadata: {
      topic: 'MARKETPLACE_ACCOUNT_DELETION',
      schemaVersion: '1.0',
      deprecated: false,
    },
    notification: {
      notificationId: 'notif-123',
      eventDate: '2026-04-24T10:00:00Z',
      publishDate: '2026-04-24T10:00:01Z',
      publishAttemptCount: 1,
      data: {
        username: 'testuser',
        userId: 'user-abc',
        eiasToken: 'eias-xyz',
      },
    },
  }

  it('idempotent: existing notificationId returns without re-processing', async () => {
    const prisma = {
      ebayDeletionNotification: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'existing', notificationId: 'notif-123' }),
        create: jest.fn(),
      },
    }
    const audit = { log: jest.fn() }
    const { service } = makeService({ prisma, audit })
    service.__setFetchForTests(stubPublicKeyFetch())
    const body = Buffer.from(JSON.stringify(validPayload))
    const header = signBody(body)

    await service.handleNotification(body, header)

    expect(prisma.ebayDeletionNotification.findUnique).toHaveBeenCalledWith({
      where: { notificationId: 'notif-123' },
    })
    expect(prisma.ebayDeletionNotification.create).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('persists notification row + writes RECEIVED audit on valid first-time notification', async () => {
    const prisma = {
      ebayDeletionNotification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'new-row' }),
      },
    }
    const audit = { log: jest.fn().mockResolvedValue(undefined) }
    const { service } = makeService({ prisma, audit })
    service.__setFetchForTests(stubPublicKeyFetch())
    const body = Buffer.from(JSON.stringify(validPayload))
    const header = signBody(body)

    await service.handleNotification(body, header)

    expect(prisma.ebayDeletionNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationId: 'notif-123',
        ebayUserId: 'user-abc',
        ebayUsername: 'testuser',
        eiasToken: 'eias-xyz',
        publishAttemptCount: 1,
        dataFoundInDb: false, // pre-C12 scan returns false
      }),
    })
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EBAY_ACCOUNT_DELETION_RECEIVED',
        entityType: 'ebay_deletion_notification',
        entityId: 'notif-123',
        changes: {
          after: expect.objectContaining({
            ebayUserId: 'user-abc',
            dataFoundInDb: false,
          }),
        },
      }),
    )
    // EBAY_USER_DATA_DELETED NOT emitted because dataFoundInDb=false
    expect(audit.log).toHaveBeenCalledTimes(1)
  })

  it('rejects with BadRequestException when payload is missing notificationId', async () => {
    const { service } = makeService()
    service.__setFetchForTests(stubPublicKeyFetch())
    const badPayload = { metadata: {}, notification: { data: { userId: 'x' } } }
    const body = Buffer.from(JSON.stringify(badPayload))
    const header = signBody(body)

    await expect(service.handleNotification(body, header)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('scanAndRedactBuyerData returns false today (pre-C12 regression anchor)', async () => {
    // Regression guard: today the scan is a no-op. When C12 (eBay order
    // import) lands, this test MUST be updated to reflect the new scan
    // logic — the deliberate failure here forces that update.
    const prisma = {
      ebayDeletionNotification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r' }),
      },
    }
    const audit = { log: jest.fn().mockResolvedValue(undefined) }
    const { service } = makeService({ prisma, audit })
    service.__setFetchForTests(stubPublicKeyFetch())
    const body = Buffer.from(JSON.stringify(validPayload))
    const header = signBody(body)

    await service.handleNotification(body, header)

    const createCall = prisma.ebayDeletionNotification.create.mock.calls[0][0]
    expect(createCall.data.dataFoundInDb).toBe(false)
    // The DELETED audit row only fires when dataFound=true. Pre-C12:
    // never fires. Any change here means C12 arrived — update test.
    const deletedCalls = audit.log.mock.calls.filter(
      (c: any[]) => c[0]?.action === 'EBAY_USER_DATA_DELETED',
    )
    expect(deletedCalls).toHaveLength(0)
  })
})
