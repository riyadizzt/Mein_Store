/**
 * channel-listing-transitions — pure helper unit tests (C4).
 *
 * Covers:
 *   - computeTransitions: all 4 × 4 cases (true→true, true→false,
 *     false→true, false→false + undefined handling)
 *   - applyTransitionInTx false→true: upsert per active variant,
 *     existing rows revived to 'pending'
 *   - applyTransitionInTx true→false: updateMany with status='deleted',
 *     filter skips already-deleted rows
 *   - createInitialListingsInTx: one row per (variant, channel-true)
 */

import {
  computeTransitions,
  applyTransitionInTx,
  createInitialListingsInTx,
} from '../channel-listing-transitions'

describe('computeTransitions', () => {
  const baseCurrent = {
    channelFacebook: true,
    channelTiktok: false,
    channelGoogle: true,
    channelWhatsapp: false,
  }

  it('returns [] when body is empty (all undefined)', () => {
    expect(computeTransitions(baseCurrent, {})).toEqual([])
  })

  it('detects false → true for one channel', () => {
    const t = computeTransitions(baseCurrent, { channelTiktok: true })
    expect(t).toEqual([{ channel: 'tiktok', from: false, to: true }])
  })

  it('detects true → false for one channel', () => {
    const t = computeTransitions(baseCurrent, { channelFacebook: false })
    expect(t).toEqual([{ channel: 'facebook', from: true, to: false }])
  })

  it('skips true → true as idempotent no-op', () => {
    expect(computeTransitions(baseCurrent, { channelFacebook: true })).toEqual([])
  })

  it('skips false → false as idempotent no-op', () => {
    expect(computeTransitions(baseCurrent, { channelTiktok: false })).toEqual([])
  })

  it('handles multiple transitions in one request', () => {
    const t = computeTransitions(baseCurrent, {
      channelFacebook: false,
      channelTiktok: true,
      channelGoogle: true,    // idempotent, skipped
      channelWhatsapp: false, // idempotent, skipped
    })
    expect(t).toEqual([
      { channel: 'facebook', from: true, to: false },
      { channel: 'tiktok', from: false, to: true },
    ])
  })
})

describe('applyTransitionInTx — false → true (publish)', () => {
  it('upserts one pending row per active variant', async () => {
    const upsertCalls: any[] = []
    const tx: any = {
      productVariant: {
        findMany: jest.fn(async () => [
          { id: 'v1' }, { id: 'v2' }, { id: 'v3' },
        ]),
      },
      channelProductListing: {
        upsert: jest.fn(async (args: any) => { upsertCalls.push(args); return {} }),
        updateMany: jest.fn(),
      },
    }
    const result = await applyTransitionInTx(tx, 'p1', { channel: 'facebook', from: false, to: true })
    expect(result).toEqual({
      channel: 'facebook',
      action: 'enabled',
      variantIds: ['v1', 'v2', 'v3'],
      affectedRows: 3,
    })
    expect(upsertCalls).toHaveLength(3)
    expect(upsertCalls[0].create.status).toBe('pending')
    expect(upsertCalls[0].update.status).toBe('pending')
    // The update branch must NOT clear externalListingId / channelPrice
    // so revived rows keep their external state intact.
    expect(upsertCalls[0].update).not.toHaveProperty('externalListingId')
    expect(upsertCalls[0].update).not.toHaveProperty('channelPrice')
  })

  it('no-ops when product has no active variants', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn(async () => []) },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    }
    const result = await applyTransitionInTx(tx, 'p-empty', { channel: 'google', from: false, to: true })
    expect(result.affectedRows).toBe(0)
    expect(tx.channelProductListing.upsert).not.toHaveBeenCalled()
  })
})

describe('applyTransitionInTx — true → false (soft-delete)', () => {
  it('updates all non-deleted rows to status=deleted', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn() },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 5 })),
      },
    }
    const result = await applyTransitionInTx(tx, 'p1', { channel: 'tiktok', from: true, to: false })
    expect(result).toEqual({
      channel: 'tiktok',
      action: 'disabled',
      variantIds: [],
      affectedRows: 5,
    })
    const args = tx.channelProductListing.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({
      productId: 'p1',
      channel: 'tiktok',
      status: { not: 'deleted' },
    })
    expect(args.data).toEqual({ status: 'deleted' })
    // No hard delete — confirm method was NOT updateMany with a delete
    expect(tx.channelProductListing.upsert).not.toHaveBeenCalled()
  })
})

describe('createInitialListingsInTx', () => {
  it('creates one row per (variant, channel=true) combination', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn() },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(async (args: any) => ({ count: args.data.length })),
      },
    }
    const product = {
      id: 'p1',
      channelFacebook: true,
      channelTiktok: false,
      channelGoogle: true,
      channelWhatsapp: true,
      variants: [{ id: 'v1' }, { id: 'v2' }],
    }
    const count = await createInitialListingsInTx(tx, product)
    // 3 channels × 2 variants = 6 rows
    expect(count).toBe(6)
    const rows = tx.channelProductListing.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(6)
    // Every row has status='pending'
    expect(rows.every((r: any) => r.status === 'pending')).toBe(true)
    // Every row references a real variant
    expect(rows.every((r: any) => r.variantId === 'v1' || r.variantId === 'v2')).toBe(true)
    // Every row is one of the 3 enabled channels
    const channels = new Set(rows.map((r: any) => r.channel))
    expect(channels).toEqual(new Set(['facebook', 'google', 'whatsapp']))
  })

  it('no-ops when no channels are enabled', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn() },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
    }
    const count = await createInitialListingsInTx(tx, {
      id: 'p1',
      channelFacebook: false,
      channelTiktok: false,
      channelGoogle: false,
      channelWhatsapp: false,
      variants: [{ id: 'v1' }],
    })
    expect(count).toBe(0)
    expect(tx.channelProductListing.createMany).not.toHaveBeenCalled()
  })

  it('no-ops when product has no variants (edge: shouldn\'t happen in C4)', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn() },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
    }
    const count = await createInitialListingsInTx(tx, {
      id: 'p1',
      channelFacebook: true,
      channelTiktok: true,
      channelGoogle: true,
      channelWhatsapp: true,
      variants: [],
    })
    expect(count).toBe(0)
    expect(tx.channelProductListing.createMany).not.toHaveBeenCalled()
  })

  it('uses skipDuplicates for retry safety', async () => {
    const tx: any = {
      productVariant: { findMany: jest.fn() },
      channelProductListing: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(async (args: any) => ({ count: args.data.length })),
      },
    }
    await createInitialListingsInTx(tx, {
      id: 'p1',
      channelFacebook: true,
      channelTiktok: false,
      channelGoogle: false,
      channelWhatsapp: false,
      variants: [{ id: 'v1' }],
    })
    const args = tx.channelProductListing.createMany.mock.calls[0][0]
    expect(args.skipDuplicates).toBe(true)
  })
})
