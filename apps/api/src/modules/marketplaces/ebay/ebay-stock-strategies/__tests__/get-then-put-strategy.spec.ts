/**
 * C15.6 Tests — GetThenPutStrategy.
 *
 * Coverage (5 tests):
 *  - Success path (GET → PUT → verify-GET)
 *  - ENHANCEMENT 1: Defensive null-check vor Spread-Pattern
 *  - ENHANCEMENT 3: verify-GET 5s timeout
 *  - ENHANCEMENT 4: verify-failure tracking via HealthService
 *  - Spread-pattern preservation (post-snapshot has full data)
 */

import { GetThenPutStrategy } from '../get-then-put-strategy'
import { EbayApiClient } from '../../ebay-api.client'
import { EbaySnapshotVerifier } from '../../ebay-snapshot-verifier'
import { EbayEndpointHealthService } from '../../ebay-endpoint-health.service'
import { StockUpdateContext } from '../ebay-stock-update-strategy.interface'

jest.mock('../../ebay-api.client', () => {
  const actual = jest.requireActual('../../ebay-api.client')
  return { ...actual, EbayApiClient: jest.fn() }
})
jest.mock('../../ebay-env', () => ({ resolveEbayEnv: () => 'sandbox' }))

const ctx: StockUpdateContext = {
  listing: { id: 'lst-1', variantId: 'v-1', externalListingId: 'ebay-listing-1' },
  sku: 'MAL-TEST-1',
  offerId: 'offer-1',
  effectiveQuantity: 7,
  bearerToken: 'fake-token',
}

const FULL_INVENTORY_ITEM = {
  sku: 'MAL-TEST-1',
  locale: 'de_DE',
  groupIds: ['MAL_group-1'],
  product: { title: 'X', description: 'Y', aspects: {}, imageUrls: [], brand: 'B', mpn: 'M', ean: ['none'] },
  condition: 'NEW',
  packageWeightAndSize: { weight: { value: 500, unit: 'GRAM' }, shippingIrregular: false },
  availability: { shipToLocationAvailability: { quantity: 5 } },
}

function buildVerifier(): EbaySnapshotVerifier {
  return new EbaySnapshotVerifier()
}

function buildHealthMock(): jest.Mocked<EbayEndpointHealthService> {
  return {
    recordVerifyFailure: jest.fn().mockResolvedValue({ count: 1, alertTriggered: false }),
  } as any
}

describe('GetThenPutStrategy', () => {
  beforeEach(() => jest.clearAllMocks())

  it('success path: GET → PUT → verify-GET → ok=true', async () => {
    const post = JSON.parse(JSON.stringify(FULL_INVENTORY_ITEM))
    post.availability.shipToLocationAvailability.quantity = 7

    const requestMock = jest
      .fn()
      .mockResolvedValueOnce(FULL_INVENTORY_ITEM) // GET pre
      .mockResolvedValueOnce({}) // PUT
      .mockResolvedValueOnce(post) // GET post
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new GetThenPutStrategy(buildVerifier(), buildHealthMock())
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(true)
    expect(result.errorMessage).toBeNull()
    expect(result.dataLossDetected).toBeFalsy()
    // Issue #6 root-fix: full chain success → eBay-side state proven in sync.
    expect(result.verifiedSuccess).toBe(true)

    // PUT-call hat full body (spread-pattern preservation)
    const putCall = requestMock.mock.calls[1]
    expect(putCall[0]).toBe('PUT')
    const putBody = (putCall[2] as any).body
    expect(putBody.product.title).toBe('X') // preserved
    expect(putBody.groupIds).toEqual(['MAL_group-1']) // preserved
    expect(putBody.availability.shipToLocationAvailability.quantity).toBe(7) // updated
  })

  it('ENHANCEMENT 1: returns INVALID_STATE when pre-snapshot lacks availability', async () => {
    const incompletePreSnapshot = { sku: 'X' /* no availability */ }
    const requestMock = jest.fn().mockResolvedValueOnce(incompletePreSnapshot)
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new GetThenPutStrategy(buildVerifier(), buildHealthMock())
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(false)
    expect(result.errorMessage).toContain('INVALID_STATE')
    // PUT was NEVER called (defensive bail-out)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('ENHANCEMENT 3: verify-GET timeout → ok=true with errorMessage marker', async () => {
    const requestMock = jest
      .fn()
      .mockResolvedValueOnce(FULL_INVENTORY_ITEM) // GET pre
      .mockResolvedValueOnce({}) // PUT
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 7000)), // GET post — exceeds 5s timeout
      )
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const health = buildHealthMock()
    const strategy = new GetThenPutStrategy(buildVerifier(), health)
    const result = await strategy.execute(ctx)

    // PUT was successful — ok=true even though verify-GET timed out
    expect(result.ok).toBe(true)
    expect(result.errorMessage).toBe('verify-get-timeout')
    expect(result.postSnapshot).toBeNull()
    // Issue #6 root-fix: PUT went through but verify-GET could not confirm
    // → eBay-side state not proven → push-service must skip lastSyncedQuantity.
    expect(result.verifiedSuccess).toBe(false)
  }, 10000)

  it('ENHANCEMENT 4: verify-GET fail → recordVerifyFailure called', async () => {
    const requestMock = jest
      .fn()
      .mockResolvedValueOnce(FULL_INVENTORY_ITEM) // GET pre
      .mockResolvedValueOnce({}) // PUT
      .mockRejectedValueOnce(new Error('network')) // GET post fail
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const health = buildHealthMock()
    const strategy = new GetThenPutStrategy(buildVerifier(), health)
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(true) // PUT succeeded — verify-fail isolated
    expect(result.errorMessage).toBe('verify-get-failed')
    expect(health.recordVerifyFailure).toHaveBeenCalledWith('get_then_put')
    // Issue #6 root-fix: PUT went through but verify-GET could not confirm
    // → eBay-side state not proven → push-service must skip lastSyncedQuantity.
    expect(result.verifiedSuccess).toBe(false)
  })

  it('detects data-loss via verifier (post-PUT title removed)', async () => {
    const post = JSON.parse(JSON.stringify(FULL_INVENTORY_ITEM))
    post.availability.shipToLocationAvailability.quantity = 7
    delete post.product.title // simulate eBay Replace-semantic

    const requestMock = jest
      .fn()
      .mockResolvedValueOnce(FULL_INVENTORY_ITEM)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(post)
    ;(EbayApiClient as unknown as jest.Mock).mockImplementation(() => ({ request: requestMock }))

    const strategy = new GetThenPutStrategy(buildVerifier(), buildHealthMock())
    const result = await strategy.execute(ctx)

    expect(result.ok).toBe(false)
    expect(result.dataLossDetected).toBe(true)
    expect(result.dataLossFields).toContain('product.title')
  })
})
