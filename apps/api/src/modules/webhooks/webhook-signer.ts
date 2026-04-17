/**
 * Webhook signing + verification.
 *
 * Signature scheme (compatible with GitHub/Stripe style):
 *   X-Malak-Timestamp: <unix-ms>
 *   X-Malak-Signature: sha256=<hex>
 *   X-Malak-Event-Id:  <uuid>   (for idempotency)
 *
 * The signed string is: `<timestamp>.<raw-body>`.
 * This binds the signature to a specific moment so n8n can reject replays
 * outside a tolerance window (recommended: ± 5 minutes).
 *
 * Pure functions — no side effects, no DI. Easy to unit-test.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

export const SIGNATURE_HEADER = 'X-Malak-Signature'
export const TIMESTAMP_HEADER = 'X-Malak-Timestamp'
export const EVENT_ID_HEADER = 'X-Malak-Event-Id'
export const EVENT_TYPE_HEADER = 'X-Malak-Event-Type'

/** Build the signed string in the canonical form: `<timestamp>.<body>` */
function signedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

/**
 * Compute HMAC-SHA256 over `<timestamp>.<rawBody>` with the subscription secret.
 * Returns the hex digest WITHOUT the `sha256=` prefix — the caller prefixes it.
 */
export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  if (!secret || typeof secret !== 'string') {
    throw new Error('webhook-signer: secret must be a non-empty string')
  }
  return createHmac('sha256', secret).update(signedPayload(timestamp, rawBody), 'utf8').digest('hex')
}

/** Full header value ready to set as X-Malak-Signature. */
export function formatSignatureHeader(hexDigest: string): string {
  return `sha256=${hexDigest}`
}

/**
 * Verify an inbound signature against a rawBody + timestamp.
 * Returns true iff the digest matches. Uses constant-time comparison.
 *
 * This function exists so the admin "test webhook" feature (or e2e tests)
 * can round-trip verify their own signatures.
 */
export function verifySignature(params: {
  secret: string
  timestamp: string
  rawBody: string
  signatureHeaderValue: string // "sha256=<hex>"
}): boolean {
  const { secret, timestamp, rawBody, signatureHeaderValue } = params
  if (!signatureHeaderValue || !signatureHeaderValue.startsWith('sha256=')) return false
  const providedHex = signatureHeaderValue.slice('sha256='.length)
  const expectedHex = computeSignature(secret, timestamp, rawBody)
  if (providedHex.length !== expectedHex.length) return false
  try {
    return timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expectedHex, 'hex'))
  } catch {
    return false
  }
}

/** Generate a cryptographically strong shared secret (32 bytes hex = 64 chars). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Build the full header set for one outbound delivery.
 * The caller supplies the raw JSON body string (must be byte-identical to what
 * will be sent on the wire — n8n will re-compute the HMAC on exactly those bytes).
 */
export function buildDeliveryHeaders(params: {
  secret: string
  eventId: string
  eventType: string
  rawBody: string
  timestamp?: string // override for deterministic tests
}): Record<string, string> {
  const ts = params.timestamp ?? String(Date.now())
  const sig = computeSignature(params.secret, ts, params.rawBody)
  return {
    'Content-Type': 'application/json; charset=utf-8',
    [SIGNATURE_HEADER]: formatSignatureHeader(sig),
    [TIMESTAMP_HEADER]: ts,
    [EVENT_ID_HEADER]: params.eventId,
    [EVENT_TYPE_HEADER]: params.eventType,
    'User-Agent': 'MalakWebhooks/1.0',
  }
}
