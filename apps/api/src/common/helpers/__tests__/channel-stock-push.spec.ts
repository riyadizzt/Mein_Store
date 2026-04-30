/**
 * channel-stock-push.ts (C15) helper unit tests.
 *
 * Pins down:
 *   - No registered pusher → no-op (but caller .catch isn't needed
 *     because helper itself never throws)
 *   - Registered pusher receives deduped variantIds
 *   - Empty input is a no-op
 *   - Pusher exceptions are swallowed (NEVER propagated)
 *   - register/unregister roundtrip works
 */

import {
  ChannelStockPusher,
  propagateChannelStockPush,
  registerChannelStockPusher,
  _getRegisteredPusher,
} from '../channel-stock-push'

function makeFakePusher(): ChannelStockPusher & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    async pushForVariants(variantIds: string[]) {
      calls.push([...variantIds])
    },
  }
}

describe('channel-stock-push helper (C15)', () => {
  beforeEach(() => {
    registerChannelStockPusher(null)
  })

  afterAll(() => {
    registerChannelStockPusher(null)
  })

  it('no pusher registered → no-op', async () => {
    expect(_getRegisteredPusher()).toBeNull()
    await expect(propagateChannelStockPush(['v1'])).resolves.toBeUndefined()
  })

  it('empty variantIds → no-op even with pusher', async () => {
    const pusher = makeFakePusher()
    registerChannelStockPusher(pusher)
    await propagateChannelStockPush([])
    expect(pusher.calls).toHaveLength(0)
  })

  it('passes unique variantIds to pusher', async () => {
    const pusher = makeFakePusher()
    registerChannelStockPusher(pusher)
    await propagateChannelStockPush(['v1', 'v2', 'v1', 'v3', 'v2'])
    expect(pusher.calls).toHaveLength(1)
    expect(pusher.calls[0].sort()).toEqual(['v1', 'v2', 'v3'])
  })

  it('filters non-string entries defensively', async () => {
    const pusher = makeFakePusher()
    registerChannelStockPusher(pusher)
    // Cast through unknown to simulate caller drift
    await propagateChannelStockPush(['v1', null as any, undefined as any, 42 as any, 'v2'])
    expect(pusher.calls[0].sort()).toEqual(['v1', 'v2'])
  })

  it('swallows pusher exceptions — never propagates', async () => {
    const throwing: ChannelStockPusher = {
      async pushForVariants() {
        throw new Error('eBay 5xx')
      },
    }
    registerChannelStockPusher(throwing)
    await expect(propagateChannelStockPush(['v1'])).resolves.toBeUndefined()
  })

  it('register/unregister roundtrip works', () => {
    const a = makeFakePusher()
    const b = makeFakePusher()
    registerChannelStockPusher(a)
    expect(_getRegisteredPusher()).toBe(a)
    registerChannelStockPusher(b)
    expect(_getRegisteredPusher()).toBe(b)
    registerChannelStockPusher(null)
    expect(_getRegisteredPusher()).toBeNull()
  })
})
