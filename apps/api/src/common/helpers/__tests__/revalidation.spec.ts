/**
 * Tests for the R13 revalidation helper.
 *
 * Verifies the non-blocking contract:
 *   - No REVALIDATE_SECRET → no-op, NO fetch
 *   - Secret set + valid variants → fetch invoked with resolved slugs
 *   - fetch rejection → swallowed, helper still resolves
 *   - Empty variantIds → no-op
 *   - Duplicate variants for same product → dedup into one tag
 */

import { revalidateProductTags, postRevalidateTags } from '../revalidation'

function buildPrismaMock(variants: Array<{ id: string; slug: string }>) {
  return {
    productVariant: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? []
        return variants
          .filter((v) => ids.includes(v.id))
          .map((v) => ({ product: { slug: v.slug } }))
      }),
    },
  } as any
}

describe('R13 — revalidation helper', () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.REVALIDATE_SECRET
  const originalUrl = process.env.WEB_BASE_URL

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.REVALIDATE_SECRET = 'test-secret'
    process.env.WEB_BASE_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.REVALIDATE_SECRET
    else process.env.REVALIDATE_SECRET = originalSecret
    if (originalUrl === undefined) delete process.env.WEB_BASE_URL
    else process.env.WEB_BASE_URL = originalUrl
  })

  it('no-op when REVALIDATE_SECRET is missing (graceful degradation)', async () => {
    delete process.env.REVALIDATE_SECRET
    const mockFetch = jest.fn()
    globalThis.fetch = mockFetch as any

    await postRevalidateTags(['product:foo'])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('no-op when variantIds is empty', async () => {
    const mockFetch = jest.fn()
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([])

    await revalidateProductTags(prisma, [])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('resolves variantIds to product slugs and posts tags', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([
      { id: 'v1', slug: 'shirt-red' },
      { id: 'v2', slug: 'shoe-blue' },
    ])

    await revalidateProductTags(prisma, ['v1', 'v2'])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/revalidate')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.secret).toBe('test-secret')
    expect(body.tags).toContain('product:shirt-red')
    expect(body.tags).toContain('product:shoe-blue')
    expect(body.tags).toContain('products:list')
  })

  it('dedupes when multiple variants map to same product', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([
      { id: 'v1', slug: 'shirt-red' },
      { id: 'v2', slug: 'shirt-red' }, // same product, different variant
    ])

    await revalidateProductTags(prisma, ['v1', 'v2'])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    const productTags = body.tags.filter((t: string) => t.startsWith('product:'))
    expect(productTags).toHaveLength(1)
    expect(productTags[0]).toBe('product:shirt-red')
  })

  it('swallows fetch errors (never throws upstream)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([{ id: 'v1', slug: 'shirt-red' }])

    // Must NOT throw
    await expect(revalidateProductTags(prisma, ['v1'])).resolves.toBeUndefined()
  })

  it('swallows HTTP error status (never throws upstream)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 503 })
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([{ id: 'v1', slug: 'shirt-red' }])

    await expect(revalidateProductTags(prisma, ['v1'])).resolves.toBeUndefined()
  })

  it('filters null/empty variantIds before querying', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([{ id: 'v1', slug: 'shirt-red' }])

    await revalidateProductTags(prisma, [null, undefined, '', 'v1'])

    // Only 'v1' should reach the query
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['v1'] } } }),
    )
  })

  it('no fetch if no slugs resolved (all variants missing)', async () => {
    const mockFetch = jest.fn()
    globalThis.fetch = mockFetch as any
    const prisma = buildPrismaMock([]) // no variants at all

    await revalidateProductTags(prisma, ['unknown-id'])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
