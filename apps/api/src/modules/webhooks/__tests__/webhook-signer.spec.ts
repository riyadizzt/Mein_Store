import {
  computeSignature,
  formatSignatureHeader,
  verifySignature,
  generateWebhookSecret,
  buildDeliveryHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
} from '../webhook-signer'

describe('webhook-signer', () => {
  const secret = 'test-secret-32bytes-000000000000'
  const timestamp = '1713357600000'
  const body = '{"id":"evt_123","type":"order.created","data":{"object":{"orderId":"ord_1"}}}'

  describe('computeSignature', () => {
    it('produces a 64-char hex digest', () => {
      const sig = computeSignature(secret, timestamp, body)
      expect(sig).toMatch(/^[a-f0-9]{64}$/)
    })

    it('is deterministic — same inputs yield same digest', () => {
      const a = computeSignature(secret, timestamp, body)
      const b = computeSignature(secret, timestamp, body)
      expect(a).toBe(b)
    })

    it('differs when body changes by one byte', () => {
      const a = computeSignature(secret, timestamp, body)
      const b = computeSignature(secret, timestamp, body + ' ')
      expect(a).not.toBe(b)
    })

    it('differs when timestamp changes (replay protection)', () => {
      const a = computeSignature(secret, timestamp, body)
      const b = computeSignature(secret, String(Number(timestamp) + 1), body)
      expect(a).not.toBe(b)
    })

    it('differs when secret changes', () => {
      const a = computeSignature(secret, timestamp, body)
      const b = computeSignature(secret + 'X', timestamp, body)
      expect(a).not.toBe(b)
    })

    it('throws on empty secret', () => {
      expect(() => computeSignature('', timestamp, body)).toThrow(/secret/)
    })
  })

  describe('formatSignatureHeader', () => {
    it('prefixes with sha256=', () => {
      expect(formatSignatureHeader('abc123')).toBe('sha256=abc123')
    })
  })

  describe('verifySignature', () => {
    it('round-trips a self-signed payload', () => {
      const sig = formatSignatureHeader(computeSignature(secret, timestamp, body))
      const ok = verifySignature({
        secret,
        timestamp,
        rawBody: body,
        signatureHeaderValue: sig,
      })
      expect(ok).toBe(true)
    })

    it('rejects wrong secret', () => {
      const sig = formatSignatureHeader(computeSignature(secret, timestamp, body))
      const ok = verifySignature({
        secret: 'wrong-secret',
        timestamp,
        rawBody: body,
        signatureHeaderValue: sig,
      })
      expect(ok).toBe(false)
    })

    it('rejects tampered body', () => {
      const sig = formatSignatureHeader(computeSignature(secret, timestamp, body))
      const ok = verifySignature({
        secret,
        timestamp,
        rawBody: body + 'X',
        signatureHeaderValue: sig,
      })
      expect(ok).toBe(false)
    })

    it('rejects old timestamp even with valid payload content', () => {
      const sig = formatSignatureHeader(computeSignature(secret, timestamp, body))
      const ok = verifySignature({
        secret,
        timestamp: String(Number(timestamp) + 1),
        rawBody: body,
        signatureHeaderValue: sig,
      })
      expect(ok).toBe(false)
    })

    it('rejects header missing sha256= prefix', () => {
      const hex = computeSignature(secret, timestamp, body)
      const ok = verifySignature({
        secret,
        timestamp,
        rawBody: body,
        signatureHeaderValue: hex, // raw hex, no prefix
      })
      expect(ok).toBe(false)
    })

    it('rejects empty signature header', () => {
      expect(
        verifySignature({ secret, timestamp, rawBody: body, signatureHeaderValue: '' }),
      ).toBe(false)
    })

    it('rejects malformed hex', () => {
      expect(
        verifySignature({
          secret,
          timestamp,
          rawBody: body,
          signatureHeaderValue: 'sha256=not-hex-at-all',
        }),
      ).toBe(false)
    })
  })

  describe('generateWebhookSecret', () => {
    it('returns a 64-char hex string', () => {
      const s = generateWebhookSecret()
      expect(s).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces unique secrets', () => {
      const a = generateWebhookSecret()
      const b = generateWebhookSecret()
      expect(a).not.toBe(b)
    })
  })

  describe('buildDeliveryHeaders', () => {
    it('returns the 6 required headers', () => {
      const h = buildDeliveryHeaders({
        secret,
        eventId: 'evt-abc',
        eventType: 'order.created',
        rawBody: body,
        timestamp,
      })
      expect(h['Content-Type']).toBe('application/json; charset=utf-8')
      expect(h[SIGNATURE_HEADER]).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect(h[TIMESTAMP_HEADER]).toBe(timestamp)
      expect(h[EVENT_ID_HEADER]).toBe('evt-abc')
      expect(h[EVENT_TYPE_HEADER]).toBe('order.created')
      expect(h['User-Agent']).toContain('MalakWebhooks')
    })

    it('signature round-trips through verifySignature', () => {
      const h = buildDeliveryHeaders({
        secret,
        eventId: 'evt-1',
        eventType: 'order.created',
        rawBody: body,
        timestamp,
      })
      const ok = verifySignature({
        secret,
        timestamp,
        rawBody: body,
        signatureHeaderValue: h[SIGNATURE_HEADER]!,
      })
      expect(ok).toBe(true)
    })
  })
})
