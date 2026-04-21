/**
 * channel-feed-cache-ref helper — unit tests.
 *
 * Covers:
 *   - no-op when no FeedsService registered
 *   - register → invalidate calls clearCache once
 *   - unregister (pass null) → subsequent invalidate is no-op
 *   - clearCache throwing is swallowed (does not propagate)
 *   - idempotent across multiple invalidations
 */

import {
  registerChannelFeedCache,
  invalidateChannelFeedCache,
} from '../channel-feed-cache-ref'

describe('channel-feed-cache-ref', () => {
  afterEach(() => registerChannelFeedCache(null))

  it('is a no-op when nothing is registered', () => {
    expect(() => invalidateChannelFeedCache()).not.toThrow()
  })

  it('calls clearCache() on the registered ref', () => {
    const clearCache = jest.fn()
    registerChannelFeedCache({ clearCache })
    invalidateChannelFeedCache()
    expect(clearCache).toHaveBeenCalledTimes(1)
  })

  it('no-ops after unregistering (null)', () => {
    const clearCache = jest.fn()
    registerChannelFeedCache({ clearCache })
    registerChannelFeedCache(null)
    invalidateChannelFeedCache()
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('swallows errors from clearCache() — caller transaction safe', () => {
    const clearCache = jest.fn(() => { throw new Error('boom') })
    registerChannelFeedCache({ clearCache })
    expect(() => invalidateChannelFeedCache()).not.toThrow()
    expect(clearCache).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — repeated calls each trigger clearCache', () => {
    const clearCache = jest.fn()
    registerChannelFeedCache({ clearCache })
    invalidateChannelFeedCache()
    invalidateChannelFeedCache()
    invalidateChannelFeedCache()
    expect(clearCache).toHaveBeenCalledTimes(3)
  })

  it('replacing ref (second register) routes invalidations to the new one', () => {
    const first = jest.fn()
    const second = jest.fn()
    registerChannelFeedCache({ clearCache: first })
    registerChannelFeedCache({ clearCache: second })
    invalidateChannelFeedCache()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
