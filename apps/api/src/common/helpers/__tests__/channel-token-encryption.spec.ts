/**
 * Envelope-encryption helper tests (C2).
 *
 * The helper is isolated in Phase 1 — no production code imports it yet.
 * These tests are therefore the ONLY guarantee that the algorithm works
 * correctly when eBay wires it up in Phase 2. Coverage targets:
 *
 *   - master-key loading: env present / missing / wrong length / bad base64
 *   - round-trip: encrypt → decrypt returns original plaintext
 *   - envelope format integrity (7 fields, v1 prefix, base64url safe)
 *   - tamper detection: changing any field makes decrypt throw
 *   - wrong-key rejection
 *   - unicode + long payloads + empty string
 *   - module-level cache behavior (idempotent, resettable for tests)
 *   - isEncryptedEnvelope classifier
 */

import { randomBytes } from 'node:crypto'
import {
  loadMasterKey,
  encryptWithKek,
  decryptWithKek,
  encryptChannelToken,
  decryptChannelToken,
  isEncryptedEnvelope,
  constantTimeEqual,
  ChannelTokenMasterKeyError,
  __resetMasterKeyCache,
} from '../channel-token-encryption'

// Test-only key generated fresh per test run. NEVER hard-coded — even
// a "test-only" committed key trains muscle memory for the wrong
// pattern.
function genTestKeyBase64(): string {
  return randomBytes(32).toString('base64')
}

describe('loadMasterKey — fail-fast validation', () => {
  it('accepts a valid 32-byte base64 key', () => {
    const k = genTestKeyBase64()
    const buf = loadMasterKey(k)
    expect(buf.length).toBe(32)
  })

  it('trims whitespace before validating', () => {
    const k = genTestKeyBase64()
    const buf = loadMasterKey(`  ${k}\n`)
    expect(buf.length).toBe(32)
  })

  it('throws when env is undefined', () => {
    expect(() => loadMasterKey(undefined)).toThrow(ChannelTokenMasterKeyError)
  })

  it('throws when env is empty string', () => {
    expect(() => loadMasterKey('')).toThrow(ChannelTokenMasterKeyError)
  })

  it('throws when env is only whitespace', () => {
    expect(() => loadMasterKey('   \n\t')).toThrow(ChannelTokenMasterKeyError)
  })

  it('throws when key decodes to fewer than 32 bytes', () => {
    // 16 random bytes base64-encoded
    const short = randomBytes(16).toString('base64')
    expect(() => loadMasterKey(short)).toThrow(ChannelTokenMasterKeyError)
    try { loadMasterKey(short) } catch (e: any) {
      expect(e.message3.de).toMatch(/32 bytes/i)
      expect(e.message3.en).toMatch(/32 bytes/i)
      expect(e.message3.ar).toMatch(/openssl/) // setup hint visible
    }
  })

  it('throws when key decodes to more than 32 bytes', () => {
    const long = randomBytes(64).toString('base64')
    expect(() => loadMasterKey(long)).toThrow(ChannelTokenMasterKeyError)
  })

  it('throws when input contains characters that silently decode-lossy', () => {
    // "!!!not-base64!!!" — Buffer.from is lossy, re-encode length differs
    expect(() => loadMasterKey('!!!not-base64!!!')).toThrow(ChannelTokenMasterKeyError)
  })

  it('error carries a 3-language message object', () => {
    try {
      loadMasterKey(undefined)
      fail('expected throw')
    } catch (e: any) {
      expect(e.message3).toBeDefined()
      expect(e.message3.de).toBeTruthy()
      expect(e.message3.en).toBeTruthy()
      expect(e.message3.ar).toBeTruthy()
      expect(e.code).toBe('CHANNEL_TOKEN_MASTER_KEY_INVALID')
    }
  })
})

describe('encrypt / decrypt round-trip', () => {
  it('round-trips a short ASCII token', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('ebay-access-token-abc123', kek)
    expect(decryptWithKek(env, kek)).toBe('ebay-access-token-abc123')
  })

  it('round-trips unicode payloads', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const payload = 'تأكيد 🔐 mañana — Schlüsselbund'
    const env = encryptWithKek(payload, kek)
    expect(decryptWithKek(env, kek)).toBe(payload)
  })

  it('round-trips an empty string', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('', kek)
    expect(decryptWithKek(env, kek)).toBe('')
  })

  it('round-trips a 10 KB payload (stress)', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const big = 'x'.repeat(10_000)
    const env = encryptWithKek(big, kek)
    expect(decryptWithKek(env, kek)).toBe(big)
  })

  it('produces a different envelope on every call for the same input (IV randomness)', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const a = encryptWithKek('same-plaintext', kek)
    const b = encryptWithKek('same-plaintext', kek)
    expect(a).not.toBe(b)
  })
})

describe('envelope format integrity', () => {
  it('has exactly 7 colon-separated fields', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('x', kek)
    expect(env.split(':').length).toBe(7)
  })

  it('starts with "v1:"', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('x', kek)
    expect(env.startsWith('v1:')).toBe(true)
  })

  it('contains only URL-safe characters (no +, /, =)', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('x', kek)
    expect(env).not.toMatch(/[+/=]/)
  })
})

describe('tamper detection — every field is authenticated', () => {
  const fields: Array<{ name: string; idx: number }> = [
    { name: 'encryptedDek', idx: 1 },
    { name: 'dekIv', idx: 2 },
    { name: 'dekTag', idx: 3 },
    { name: 'iv', idx: 4 },
    { name: 'tag', idx: 5 },
    { name: 'ciphertext', idx: 6 },
  ]
  for (const { name, idx } of fields) {
    it(`rejects tampering with ${name}`, () => {
      const kek = loadMasterKey(genTestKeyBase64())
      const env = encryptWithKek('payload', kek)
      const parts = env.split(':')
      // Flip one character in the target field — changes one byte
      // after base64url decode.
      const ch = parts[idx][0]
      const flipped = (ch === 'A' ? 'B' : 'A') + parts[idx].slice(1)
      parts[idx] = flipped
      const tampered = parts.join(':')
      expect(() => decryptWithKek(tampered, kek)).toThrow()
    })
  }

  it('rejects the wrong KEK', () => {
    const kek1 = loadMasterKey(genTestKeyBase64())
    const kek2 = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('payload', kek1)
    expect(() => decryptWithKek(env, kek2)).toThrow()
  })

  it('rejects malformed envelope (wrong field count)', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    expect(() => decryptWithKek('v1:only-one-field', kek)).toThrow(/7 fields/i)
  })

  it('rejects unsupported format version', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('x', kek).replace(/^v1:/, 'v9:')
    expect(() => decryptWithKek(env, kek)).toThrow(/version/i)
  })
})

describe('module-level singleton behavior', () => {
  const ORIGINAL = process.env.CHANNEL_TOKEN_MASTER_KEY

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHANNEL_TOKEN_MASTER_KEY
    else process.env.CHANNEL_TOKEN_MASTER_KEY = ORIGINAL
    __resetMasterKeyCache()
  })

  it('uses env var CHANNEL_TOKEN_MASTER_KEY for the singleton accessor', () => {
    const k = genTestKeyBase64()
    process.env.CHANNEL_TOKEN_MASTER_KEY = k
    __resetMasterKeyCache()
    const env = encryptChannelToken('token-xyz')
    expect(decryptChannelToken(env)).toBe('token-xyz')
  })

  it('caches the KEK — changing env after first call has no effect until reset', () => {
    const k1 = genTestKeyBase64()
    process.env.CHANNEL_TOKEN_MASTER_KEY = k1
    __resetMasterKeyCache()
    const env = encryptChannelToken('a')
    // Swap env to a different key WITHOUT resetting cache
    process.env.CHANNEL_TOKEN_MASTER_KEY = genTestKeyBase64()
    // Should STILL decrypt with original cached key
    expect(decryptChannelToken(env)).toBe('a')
  })

  it('throws fail-fast when env missing and reset was called', () => {
    delete process.env.CHANNEL_TOKEN_MASTER_KEY
    __resetMasterKeyCache()
    expect(() => encryptChannelToken('x')).toThrow(ChannelTokenMasterKeyError)
  })
})

describe('isEncryptedEnvelope classifier', () => {
  it('returns true for a real v1 envelope', () => {
    const kek = loadMasterKey(genTestKeyBase64())
    const env = encryptWithKek('hello', kek)
    expect(isEncryptedEnvelope(env)).toBe(true)
  })

  it('returns false for plaintext tokens (migration safety)', () => {
    expect(isEncryptedEnvelope('legacy-raw-oauth-token')).toBe(false)
    expect(isEncryptedEnvelope('eyJhbGciOiJIUzI1NiJ9.foo.bar')).toBe(false)
  })

  it('returns false for null / undefined / empty', () => {
    expect(isEncryptedEnvelope(null)).toBe(false)
    expect(isEncryptedEnvelope(undefined)).toBe(false)
    expect(isEncryptedEnvelope('')).toBe(false)
  })

  it('returns false for an envelope with wrong field count', () => {
    expect(isEncryptedEnvelope('v1:foo:bar')).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal buffers', () => {
    const a = Buffer.from('hello world')
    const b = Buffer.from('hello world')
    expect(constantTimeEqual(a, b)).toBe(true)
  })

  it('returns false for different buffers', () => {
    const a = Buffer.from('hello world')
    const b = Buffer.from('hello_world')
    expect(constantTimeEqual(a, b)).toBe(false)
  })

  it('returns false without throwing when lengths differ', () => {
    // timingSafeEqual throws on length mismatch — our wrapper must not.
    const a = Buffer.from('abc')
    const b = Buffer.from('abcd')
    expect(constantTimeEqual(a, b)).toBe(false)
  })
})
