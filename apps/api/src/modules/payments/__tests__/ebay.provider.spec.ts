/**
 * EbayPaymentProvider (C13.3) unit tests.
 *
 * Pins down:
 *   - createPaymentIntent throws (eBay-orders are pre-paid)
 *   - verifyWebhookSignature throws (refunds are poll-based)
 *   - refund happy path: 2xx → returns 'pending' + extracted refundId
 *   - refund 4xx → returns 'failed' with empty providerRefundId (graceful)
 *   - refund 5xx → throws (lets payments.service handle retry)
 *   - Defensive multi-path refundId extraction (4 known shapes)
 *   - 2xx but NO refundId at any path → returns 'pending' with empty
 *     providerRefundId + warn-log (poll-cron 48h-fallback safety-net)
 *   - Reason-code mapping (5 reasons → 3 eBay reasons)
 */

import { EbayPaymentProvider } from '../providers/ebay.provider'
import { EbayApiError } from '../../marketplaces/ebay/ebay-api.client'

// Mock EbayApiClient at module level — full request() control.
jest.mock('../../marketplaces/ebay/ebay-api.client', () => {
  const actual = jest.requireActual('../../marketplaces/ebay/ebay-api.client')
  return {
    ...actual,
    EbayApiClient: jest.fn(),
  }
})

// Mock resolveEbayEnv so tests don't trip env-validator
jest.mock('../../marketplaces/ebay/ebay-env', () => {
  const actual = jest.requireActual('../../marketplaces/ebay/ebay-env')
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
  }
})

import { EbayApiClient } from '../../marketplaces/ebay/ebay-api.client'

function setApiResponse(response: any): jest.Mock {
  const requestMock = jest.fn().mockResolvedValue(response)
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: requestMock,
  }))
  return requestMock
}

function setApiError(error: Error): jest.Mock {
  const requestMock = jest.fn().mockRejectedValue(error)
  ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({
    request: requestMock,
  }))
  return requestMock
}

function makeProvider() {
  const auth = {
    getAccessTokenOrRefresh: jest.fn().mockResolvedValue('test-bearer'),
  } as any
  return new EbayPaymentProvider(auth)
}

// ──────────────────────────────────────────────────────────────
// Contract violations (no-op methods)
// ──────────────────────────────────────────────────────────────

describe('EbayPaymentProvider — contract violations', () => {
  it('createPaymentIntent throws (eBay-orders are pre-paid)', async () => {
    const provider = makeProvider()
    await expect(
      provider.createPaymentIntent({
        orderId: 'o1',
        amount: 100,
        currency: 'EUR',
        method: 'ebay_managed_payments',
        customerName: 'Test',
      }),
    ).rejects.toThrow(/not supported/)
  })

  it('verifyWebhookSignature throws (refunds are poll-based, not webhook)', () => {
    const provider = makeProvider()
    expect(() =>
      provider.verifyWebhookSignature(Buffer.alloc(0), 'sig'),
    ).toThrow(/does not handle webhooks/)
  })

  it('providerName matches the Payment.provider enum value', () => {
    const provider = makeProvider()
    expect(provider.providerName).toBe('EBAY_MANAGED_PAYMENTS')
  })
})

// ──────────────────────────────────────────────────────────────
// refund() happy paths with defensive-multi-path extraction
// ──────────────────────────────────────────────────────────────

describe('EbayPaymentProvider.refund — defensive multi-path refundId', () => {
  it('extracts refundId from response.refundId (path 1)', async () => {
    const provider = makeProvider()
    setApiResponse({ refundId: 'ebay-r-1' })
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-1',
      amount: 2999,
      reason: 'wrong_size',
      idempotencyKey: 'k1',
    })
    expect(result).toEqual({
      providerRefundId: 'ebay-r-1',
      status: 'pending',
      amount: 2999,
    })
  })

  it('extracts refundId from response.refunds[0].refundId (path 2)', async () => {
    const provider = makeProvider()
    setApiResponse({ refunds: [{ refundId: 'ebay-r-2', refundStatus: 'INITIATED' }] })
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-2', amount: 1500, reason: 'damaged',
    })
    expect(result.providerRefundId).toBe('ebay-r-2')
    expect(result.status).toBe('pending')
  })

  it('extracts refundId from response.refund.refundId (path 3)', async () => {
    const provider = makeProvider()
    setApiResponse({ refund: { refundId: 'ebay-r-3' } })
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-3', amount: 1000, reason: 'other',
    })
    expect(result.providerRefundId).toBe('ebay-r-3')
  })

  it('extracts refundId from response.id (path 4 — final fallback)', async () => {
    const provider = makeProvider()
    setApiResponse({ id: 'ebay-r-4' })
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-4', amount: 500, reason: 'changed_mind',
    })
    expect(result.providerRefundId).toBe('ebay-r-4')
  })

  it('2xx with NO refundId at any path → returns pending with empty providerRefundId', async () => {
    const provider = makeProvider()
    setApiResponse({ unrelated: 'shape' })
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-5', amount: 100, reason: 'other',
    })
    expect(result.providerRefundId).toBe('')
    expect(result.status).toBe('pending')
    // 48h-fallback admin-notification will surface this for manual-confirm
  })
})

// ──────────────────────────────────────────────────────────────
// refund() error paths
// ──────────────────────────────────────────────────────────────

describe('EbayPaymentProvider.refund — error handling', () => {
  it('4xx eBay error → returns failed (lets payments.service mark FAILED)', async () => {
    const provider = makeProvider()
    setApiError(new EbayApiError('Order not refundable', 400, false, [], ''))
    const result = await provider.refund({
      providerPaymentId: 'EBAY-ORD-X', amount: 100, reason: 'other',
    })
    expect(result.status).toBe('failed')
    expect(result.providerRefundId).toBe('')
  })

  it('5xx eBay error → re-throws (payments.service retries)', async () => {
    const provider = makeProvider()
    setApiError(new EbayApiError('Internal Server Error', 503, true, [], ''))
    await expect(
      provider.refund({
        providerPaymentId: 'EBAY-ORD-Y', amount: 100, reason: 'other',
      }),
    ).rejects.toBeInstanceOf(EbayApiError)
  })

  it('Network error (non-EbayApiError) → re-throws', async () => {
    const provider = makeProvider()
    setApiError(new Error('connection reset'))
    await expect(
      provider.refund({
        providerPaymentId: 'EBAY-ORD-Z', amount: 100, reason: 'other',
      }),
    ).rejects.toThrow(/connection reset/)
  })
})

// ──────────────────────────────────────────────────────────────
// Reason-code mapping
// ──────────────────────────────────────────────────────────────

describe('EbayPaymentProvider.refund — reason-code mapping', () => {
  it.each([
    ['wrong_size', 'BUYER_RETURN'],
    ['damaged', 'ITEM_NOT_AS_DESCRIBED'],
    ['quality_issue', 'ITEM_NOT_AS_DESCRIBED'],
    ['right_of_withdrawal', 'BUYER_RETURN'],
    ['changed_mind', 'BUYER_RETURN'],
    ['other', 'OTHER'],
    ['unknown_value', 'OTHER'],
    [undefined, 'OTHER'],
  ])('reason=%p → eBay reasonForRefund=%p', async (reason, expected) => {
    const provider = makeProvider()
    const requestMock = setApiResponse({ refundId: 'r' })
    await provider.refund({
      providerPaymentId: 'O', amount: 100, reason: reason as any,
    })
    const sentBody = requestMock.mock.calls[0][2]?.body
    expect(sentBody.reasonForRefund).toBe(expected)
  })
})

// ──────────────────────────────────────────────────────────────
// Body shape sanity-check
// ──────────────────────────────────────────────────────────────

describe('EbayPaymentProvider.refund — request body shape', () => {
  it('sends refundAmount in cents-converted EUR string format', async () => {
    const provider = makeProvider()
    const requestMock = setApiResponse({ refundId: 'r' })
    await provider.refund({
      providerPaymentId: 'O', amount: 2999, reason: 'other',
    })
    const sentBody = requestMock.mock.calls[0][2]?.body
    expect(sentBody.refundAmount).toEqual({ value: '29.99', currency: 'EUR' })
  })

  it('encodes orderId in URL path', async () => {
    const provider = makeProvider()
    const requestMock = setApiResponse({ refundId: 'r' })
    await provider.refund({
      providerPaymentId: '12-12345/67890', amount: 100, reason: 'other',
    })
    const sentPath = requestMock.mock.calls[0][1] as string
    // encoded slash
    expect(sentPath).toContain('12-12345%2F67890')
    expect(sentPath).toContain('/issue_refund')
  })
})
