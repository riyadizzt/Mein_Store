/**
 * eBay Marketplace Account Deletion webhook service.
 *
 * Handles both eBay's verification challenge (GET) and actual account
 * deletion notifications (POST) per the Marketplace Account Deletion
 * spec:
 *   https://developer.ebay.com/marketplace-account-deletion
 *
 * Two flows:
 *   GET  — eBay sends ?challenge_code=<random>; we reply with
 *          {"challengeResponse": sha256(code + token + url).hexdigest()}
 *          where `token` and `url` come from env (set in the eBay
 *          Developer Portal to the same values).
 *   POST — eBay sends a signed JSON body; we verify the X-EBAY-SIGNATURE
 *          header via ECDSA + eBay's getPublicKey endpoint, then
 *          persist the notification (idempotent by notificationId) and
 *          scan our DB for any eBay-buyer-linked rows.
 *
 * Pre-C12 audit confirmed zero eBay-buyer data in DB, so the scan is a
 * no-op returning false today. When C12 (eBay order import) lands, the
 * scan gets real redaction logic — see scanAndRedactBuyerData() below.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { createHash, createVerify } from 'node:crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../admin/services/audit.service'

// `RequestInfo` isn't in the api tsconfig's `lib` set; use a minimal
// shape that covers both string URLs and URL objects — enough for our
// single getPublicKey call site.
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

interface NotificationPayload {
  metadata: { topic: string; schemaVersion: string; deprecated?: boolean }
  notification: {
    notificationId: string
    eventDate: string
    publishDate: string
    publishAttemptCount: number
    data: { username: string; userId: string; eiasToken: string }
  }
}

const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour (eBay recommendation)
const PUBLIC_KEY_REQUEST_TIMEOUT_MS = 5000

// Module-level cache: one kid → PEM mapping shared across all service
// instances (test-safe because tests inject a distinct fetchImpl).
const publicKeyCache = new Map<string, { pem: string; expiresAt: number }>()

@Injectable()
export class EbayAccountDeletionService {
  private readonly logger = new Logger(EbayAccountDeletionService.name)

  // Fetch override for test injection — mirrors EbayApiClient.fetchImpl
  // pattern. Production code keeps the default global fetch.
  private fetchImpl: FetchLike = (input, init) => fetch(input as any, init)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Test-only: inject a stub fetch for the getPublicKey lookup. */
  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchImpl = f ?? ((input, init) => fetch(input as any, init))
  }

  /**
   * GET challenge handler. Returns the hex SHA-256 digest of
   *   challengeCode + verificationToken + endpointUrl
   * concatenated in exactly that order.
   *
   * The endpoint URL env-var MUST match byte-for-byte what's registered
   * in the eBay Developer Portal — different scheme, trailing slash,
   * etc. break the verification.
   */
  handleChallenge(challengeCode: string): { challengeResponse: string } {
    if (!challengeCode) {
      throw new BadRequestException('challenge_code required')
    }
    const token = process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN
    const endpoint = process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL
    if (!token || !endpoint) {
      this.logger.error('eBay deletion webhook env not configured')
      throw new Error('EbayDeletionWebhookNotConfigured')
    }
    const hash = createHash('sha256')
      .update(challengeCode + token + endpoint)
      .digest('hex')
    return { challengeResponse: hash }
  }

  /**
   * POST notification handler. Verifies signature, enforces idempotency,
   * scans+redacts buyer-linked data (no-op pre-C12), writes audit entries.
   * Throws UnauthorizedException on signature failures, BadRequestException
   * on malformed payloads. Returns void; the controller emits 200 OK.
   */
  async handleNotification(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<void> {
    // 1. Signature verification (throws 401 on any failure)
    await this.verifyEbaySignature(rawBody, signatureHeader)

    // 2. Parse payload
    let parsed: NotificationPayload
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as NotificationPayload
    } catch {
      throw new BadRequestException('invalid JSON')
    }
    const n = parsed.notification
    if (!n?.notificationId || !n?.data?.userId) {
      throw new BadRequestException('invalid payload shape')
    }

    // 3. Idempotency: legitimate eBay retries hit us with the same
    // notificationId. Silent 200 without re-processing.
    const existing = await this.prisma.ebayDeletionNotification.findUnique({
      where: { notificationId: n.notificationId },
    })
    if (existing) {
      this.logger.log(
        `Duplicate notification ${n.notificationId} — already processed, ack 200`,
      )
      return
    }

    // 4. Data scan: pre-C12 stub. When eBay order import ships, this
    // becomes the real redaction logic — see scanAndRedactBuyerData.
    const dataFound = await this.scanAndRedactBuyerData(n.data)

    // 5. Persist + audit (two rows: always-received, conditional-deleted)
    await this.prisma.ebayDeletionNotification.create({
      data: {
        notificationId: n.notificationId,
        ebayUserId: n.data.userId,
        ebayUsername: n.data.username,
        eiasToken: n.data.eiasToken,
        eventDate: new Date(n.eventDate),
        publishDate: new Date(n.publishDate),
        publishAttemptCount: n.publishAttemptCount ?? 1,
        dataFoundInDb: dataFound,
      },
    })

    await this.audit
      .log({
        adminId: 'system',
        action: 'EBAY_ACCOUNT_DELETION_RECEIVED',
        entityType: 'ebay_deletion_notification',
        entityId: n.notificationId,
        changes: {
          after: {
            ebayUserId: n.data.userId,
            ebayUsername: n.data.username,
            dataFoundInDb: dataFound,
          },
        },
      })
      .catch(() => {
        /* audit must never block the ack */
      })

    if (dataFound) {
      await this.audit
        .log({
          adminId: 'system',
          action: 'EBAY_USER_DATA_DELETED',
          entityType: 'ebay_deletion_notification',
          entityId: n.notificationId,
          changes: { after: { ebayUserId: n.data.userId } },
        })
        .catch(() => {})
    }

    this.logger.log(
      `Processed eBay deletion userId=${n.data.userId} notificationId=${n.notificationId} dataFoundInDb=${dataFound}`,
    )
  }

  /**
   * Verifies X-EBAY-SIGNATURE header via ECDSA + eBay's public key.
   *
   * Header format (base64-encoded JSON):
   *   { "alg": "ECDSA", "kid": "...", "signature": "...", "digest": "SHA1" }
   *
   * Process:
   *   1. Base64-decode header → parse JSON
   *   2. Fetch publicKey for kid (cached 1h)
   *   3. Verify ECDSA-SHA1 over raw POST body
   */
  async verifyEbaySignature(
    rawBody: Buffer,
    header: string | undefined,
  ): Promise<void> {
    if (!header) {
      throw new UnauthorizedException('missing X-EBAY-SIGNATURE')
    }
    let parsed: { alg?: string; kid?: string; signature?: string; digest?: string }
    try {
      parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    } catch {
      throw new UnauthorizedException('malformed X-EBAY-SIGNATURE')
    }
    if (!parsed.kid || !parsed.signature) {
      throw new UnauthorizedException('incomplete X-EBAY-SIGNATURE')
    }

    const publicKeyPem = await this.resolveEbayPublicKey(parsed.kid)
    const verifier = createVerify('SHA1')
    verifier.update(rawBody)
    verifier.end()
    const sigBuf = Buffer.from(parsed.signature, 'base64')
    const valid = verifier.verify(publicKeyPem, sigBuf)
    if (!valid) {
      throw new UnauthorizedException('signature verification failed')
    }
  }

  private async resolveEbayPublicKey(kid: string): Promise<string> {
    const cached = publicKeyCache.get(kid)
    if (cached && cached.expiresAt > Date.now()) return cached.pem

    // EBAY_MODE drives the base URL — same env var the rest of the eBay
    // code uses (resolveEbayEnv). No new config surface needed.
    const isProduction = process.env.EBAY_MODE === 'production'
    const base = isProduction ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'

    const res = await this.fetchImpl(
      `${base}/commerce/notification/v1/public_key/${kid}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(PUBLIC_KEY_REQUEST_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      throw new UnauthorizedException(`getPublicKey failed: ${res.status}`)
    }
    const body = (await res.json()) as { key: string; algorithm?: string }
    const pem = this.base64ToPem(body.key)
    publicKeyCache.set(kid, {
      pem,
      expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL_MS,
    })
    return pem
  }

  /**
   * eBay returns either a bare base64 SPKI blob OR a full PEM block.
   * Normalize to PEM either way so createVerify.verify() accepts it.
   */
  private base64ToPem(keyBase64: string): string {
    if (keyBase64.includes('-----BEGIN')) return keyBase64
    const wrapped = keyBase64.match(/.{1,64}/g)?.join('\n') ?? keyBase64
    return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----\n`
  }

  /**
   * Pre-C12: no-op returning false. Our DB holds ZERO eBay-buyer data
   * because we haven't imported any eBay orders yet. Audit 2026-04-24
   * confirmed this — see the EbayDeletionNotification model comment.
   *
   * Post-C12 (eBay Order Import) scan pattern will be:
   *   - MarketplaceOrderImport WHERE marketplace='EBAY' AND
   *       metadata->>'externalBuyerRef' IN (userId, username, eiasToken)
   *     → redact metadata.buyer fields (keep row for GoBD)
   *   - Order WHERE channel='ebay' with buyer-linked snapshot fields
   *     → apply anonymizeUser()-style scrub
   *   - return true iff any row redacted
   */
  private async scanAndRedactBuyerData(data: {
    userId: string
    username: string
    eiasToken: string
  }): Promise<boolean> {
    void data
    return false
  }
}
