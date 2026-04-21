/**
 * Envelope-encryption helper for channel OAuth tokens (eBay / TikTok / future).
 *
 * Design
 * ──────
 *   - Master key ("KEK") lives in the process env var CHANNEL_TOKEN_MASTER_KEY.
 *     It must be a base64-encoded 32-byte (256-bit) secret.
 *   - Each ciphertext carries its own random 32-byte Data-Encryption-Key
 *     (DEK). The DEK is used to AES-256-GCM encrypt the plaintext; the DEK
 *     itself is AES-256-GCM encrypted under the KEK, and both encrypted
 *     blobs + IVs + auth-tags are packed into a single string.
 *   - Output format:  `v1:{encryptedDek}:{dekIv}:{dekTag}:{iv}:{tag}:{ciphertext}`
 *     all fields base64url-encoded. Versioned so we can evolve the format
 *     later without breaking stored rows.
 *   - Fail-fast: loading the helper without a valid KEK throws immediately.
 *     This is intentional — silently falling back to a random key would
 *     make all previously-encrypted rows unrecoverable after a process
 *     restart.
 *
 * Phase 1 scope
 * ─────────────
 *   This helper is not wired into any production code path yet. It is
 *   exercised exclusively by its unit tests. eBay (Phase 2) will be the
 *   first real caller.
 *
 * Rotation
 * ────────
 *   Not implemented in Phase 1. Forward plan: accept a second env var
 *   CHANNEL_TOKEN_MASTER_KEY_PREV, try current → prev on decrypt, admin
 *   cron re-encrypts rows with current. That extension is additive —
 *   the v1 format will still decrypt unchanged.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

const FORMAT_VERSION = 'v1'
const KEY_BYTES = 32           // AES-256
const IV_BYTES = 12            // GCM standard — 96 bits
const TAG_BYTES = 16           // GCM tag
const FIELD_SEPARATOR = ':'

/**
 * Raised at import/initialise time when the master key is missing or
 * malformed. Carries a 3-language message plus a setup hint so the
 * runbook link is always visible in prod logs.
 */
export class ChannelTokenMasterKeyError extends Error {
  readonly code = 'CHANNEL_TOKEN_MASTER_KEY_INVALID'
  readonly message3: { de: string; en: string; ar: string }
  constructor(reason: string) {
    const message3 = {
      de:
        `CHANNEL_TOKEN_MASTER_KEY ${reason}. ` +
        `Erzeuge einen neuen Schlüssel mit "openssl rand -base64 32" und setze ihn ` +
        `in apps/api/.env (lokal) bzw. in der Railway-Umgebung (Produktion). ` +
        `Details: docs/admin-runbook/master-key-management.md`,
      en:
        `CHANNEL_TOKEN_MASTER_KEY ${reason}. ` +
        `Generate a fresh key with "openssl rand -base64 32" and set it in ` +
        `apps/api/.env (local) or the Railway environment (production). ` +
        `See docs/admin-runbook/master-key-management.md`,
      ar:
        `CHANNEL_TOKEN_MASTER_KEY ${reason}. ` +
        `أنشئ مفتاحاً جديداً باستخدام "openssl rand -base64 32" ثم ضعه في ` +
        `apps/api/.env (محلياً) أو في متغيرات بيئة Railway (الإنتاج). ` +
        `راجع docs/admin-runbook/master-key-management.md`,
    }
    super(message3.de)
    this.message3 = message3
  }
}

/**
 * Decode + validate the master key from an env string. Exported purely
 * for tests — production code should use the module-level singleton.
 */
export function loadMasterKey(envValue: string | undefined): Buffer {
  if (envValue === undefined || envValue === null || envValue === '') {
    throw new ChannelTokenMasterKeyError('is not set')
  }
  // Tolerate an accidental "CHANNEL_TOKEN_MASTER_KEY=..." copy-paste.
  const cleaned = envValue.trim()
  if (cleaned.length === 0) {
    throw new ChannelTokenMasterKeyError('is empty after trim')
  }
  let raw: Buffer
  try {
    raw = Buffer.from(cleaned, 'base64')
  } catch {
    throw new ChannelTokenMasterKeyError('is not valid base64')
  }
  // Buffer.from with invalid base64 doesn't throw; it silently drops
  // unparsable bytes. Detect that by re-encoding and comparing lengths.
  const reEncoded = raw.toString('base64')
  // base64 of the decoded bytes must re-encode to something that has
  // the SAME LENGTH as the cleaned input (ignoring trailing newlines).
  // Different strict check: length mismatch means we silently dropped.
  if (reEncoded.replace(/=+$/, '').length !== cleaned.replace(/=+$/, '').length) {
    throw new ChannelTokenMasterKeyError('is not valid base64 (decode lossy)')
  }
  if (raw.length !== KEY_BYTES) {
    throw new ChannelTokenMasterKeyError(
      `must decode to exactly ${KEY_BYTES} bytes (got ${raw.length})`,
    )
  }
  return raw
}

/**
 * Base64url: URL/filename-safe, no padding. Chosen because the stored
 * ciphertext ends up in a DB TEXT column that may later be logged — the
 * classical `+/=` characters in plain base64 produce ugly log entries
 * and break query-string sharing during debugging.
 */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/**
 * Core encrypt: takes plaintext + already-decoded KEK, returns v1 string.
 * Exported for direct test use. Production callers should use the
 * module-level `encryptChannelToken` which loads the KEK from env.
 */
export function encryptWithKek(plaintext: string, kek: Buffer): string {
  if (kek.length !== KEY_BYTES) throw new Error('KEK must be 32 bytes')

  // 1. Generate fresh DEK
  const dek = randomBytes(KEY_BYTES)

  // 2. Encrypt plaintext under DEK
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // 3. Encrypt DEK under KEK
  const dekIv = randomBytes(IV_BYTES)
  const kekCipher = createCipheriv('aes-256-gcm', kek, dekIv)
  const encryptedDek = Buffer.concat([kekCipher.update(dek), kekCipher.final()])
  const dekTag = kekCipher.getAuthTag()

  // 4. Pack
  return [
    FORMAT_VERSION,
    b64url(encryptedDek),
    b64url(dekIv),
    b64url(dekTag),
    b64url(iv),
    b64url(tag),
    b64url(ciphertext),
  ].join(FIELD_SEPARATOR)
}

/**
 * Core decrypt. Throws if the envelope is malformed or the tag fails
 * to verify (tampering or wrong KEK).
 */
export function decryptWithKek(envelope: string, kek: Buffer): string {
  if (kek.length !== KEY_BYTES) throw new Error('KEK must be 32 bytes')

  const parts = envelope.split(FIELD_SEPARATOR)
  if (parts.length !== 7) {
    throw new Error(`Invalid envelope format (expected 7 fields, got ${parts.length})`)
  }
  const [version, encDekB64, dekIvB64, dekTagB64, ivB64, tagB64, ctB64] = parts
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported envelope version "${version}" (expected "${FORMAT_VERSION}")`)
  }

  const encryptedDek = b64urlDecode(encDekB64)
  const dekIv = b64urlDecode(dekIvB64)
  const dekTag = b64urlDecode(dekTagB64)
  const iv = b64urlDecode(ivB64)
  const tag = b64urlDecode(tagB64)
  const ciphertext = b64urlDecode(ctB64)

  if (dekIv.length !== IV_BYTES || iv.length !== IV_BYTES) {
    throw new Error('Invalid IV length in envelope')
  }
  if (dekTag.length !== TAG_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invalid auth tag length in envelope')
  }

  // 1. Decrypt DEK
  const kekDecipher = createDecipheriv('aes-256-gcm', kek, dekIv)
  kekDecipher.setAuthTag(dekTag)
  const dek = Buffer.concat([kekDecipher.update(encryptedDek), kekDecipher.final()])
  if (dek.length !== KEY_BYTES) {
    throw new Error('Decrypted DEK has wrong length')
  }

  // 2. Decrypt payload
  const decipher = createDecipheriv('aes-256-gcm', dek, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Module-level singleton — loaded ONCE on first call, fail-fast if env
 * is missing. Cached so a subsequent env change requires a process
 * restart (intentional — prevents silent key rotation).
 */
let cachedKek: Buffer | null = null
function getKek(): Buffer {
  if (cachedKek) return cachedKek
  cachedKek = loadMasterKey(process.env.CHANNEL_TOKEN_MASTER_KEY)
  return cachedKek
}

/**
 * Test-only: reset the cached KEK so tests can set/unset the env var.
 * NOT exported from the barrel — imported directly in spec files.
 */
export function __resetMasterKeyCache(): void {
  cachedKek = null
}

/**
 * Production API — what real callers use.
 */
export function encryptChannelToken(plaintext: string): string {
  return encryptWithKek(plaintext, getKek())
}
export function decryptChannelToken(envelope: string): string {
  return decryptWithKek(envelope, getKek())
}

/**
 * Cheap helper: is a string formatted as a v1 envelope? Used by
 * migration code in Phase 2 to distinguish plaintext-vs-encrypted tokens
 * when upgrading legacy rows.
 */
export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const parts = value.split(FIELD_SEPARATOR)
  return parts.length === 7 && parts[0] === FORMAT_VERSION
}

/**
 * Constant-time equality check (defensive helper for future rotation
 * code — not used yet). Exported for eventual rotation validation.
 */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
