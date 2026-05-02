/**
 * C15.6 Tests — BulkUpdateStrategy.
 *
 * Coverage (3 tests):
 *  - Success path (HTTP 200)
 *  - Error path with errorId optional chaining (ENHANCEMENT 2)
 *  - Edge case: missing/empty ebayErrors response
 */

import { BulkUpdateStrategy } from '../bulk-update-strategy'
import { EbayApiClient, EbayApiError } from '../../ebay-api.client'
import { StockUpdateContext } from '../ebay-stock-update-strategy.interface'

jest.mock('../../ebay-api.client', () => {
  const actual = jest.requireActual('../../ebay-api.client')
  return {
    ...actual,
    EbayApiClient: jest.fn(),
  }
})
jest.mock('../../ebay-env', () => ({ resolveEbayEnv: () => 'sandbox' }))

const ctx: StockUpdateContext = {
  listing: { id: 'lst-1', variantId: 'v-1', externalListingId: 'ebay-listing-1' },
  sku: 'MAL-TEST-1',
  offerId: 'offer-1',
  effectiveQuantity: 7,
  bearerToken: 'fake-token',
}

describe('BulkUpdateStrategy', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns ok=true on HTTP 200 success', async () => {
    const requestMock = jest.fn().mockResolvedValueOnce({ responses: [] })
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new BulkUpdateStrategy()
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.errorMessage).toBeNull()
    expect(result.errorId).toBeNull()
    expect(result.rateLimited).toBe(false)
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/sell/inventory/v1/bulk_update_price_quantity',
      expect.objectContaining({
        body: { requests: [{ offerId: 'offer-1', availableQuantity: 7 }] },
      }),
    )
  })

  it('extracts errorId via optional chaining (ENHANCEMENT 2)', async () => {
    const requestMock = jest.fn().mockRejectedValueOnce(
      new EbayApiError('System error', 500, false, [
        { errorId: 25001, domain: 'API_INVENTORY', category: 'SYSTEM', message: 'System error' },
      ]),
    )
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new BulkUpdateStrategy()
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(false)
    expect(result.httpStatus).toBe(500)
    expect(result.errorId).toBe(25001)
    expect(result.errorMessage).toContain('eBay 500')
    expect(result.rateLimited).toBe(false)
  })

  it('handles missing ebayErrors array (defensive optional chaining)', async () => {
    const requestMock = jest.fn().mockRejectedValueOnce(
      new EbayApiError('Generic 500', 500, false, []), // empty array
    )
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new BulkUpdateStrategy()
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(false)
    expect(result.errorId).toBeNull() // optional chain returns null safely
  })

  it('returns rateLimited=true on 429', async () => {
    const requestMock = jest.fn().mockRejectedValueOnce(
      new EbayApiError('Rate limited', 429, true, []),
    )
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new BulkUpdateStrategy()
    const result = await strategy.execute(ctx)

    expect(result.rateLimited).toBe(true)
    expect(result.httpStatus).toBe(429)
    expect(result.ok).toBe(false)
  })
})
