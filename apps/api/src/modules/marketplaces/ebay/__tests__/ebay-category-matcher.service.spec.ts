/**
 * EbayCategoryMatcherService unit tests.
 *
 * Covers:
 *   - normalize() pure helper: diacritics, separators, case
 *   - isAutoApproved() match/mismatch/empty
 *   - fetchSuggestionsForAllActive: batch resilience (Promise.allSettled)
 *   - fetchSuggestionsForAllActive: breadcrumb assembly
 *   - fetchSuggestionsForAllActive: fallback to slug when no DE translation
 *   - saveMappings: dirty-only filter + updated-count
 *   - saveMappings: all-no-op → no $transaction call
 */

import {
  EbayCategoryMatcherService,
  normalize,
  isAutoApproved,
  type EbayCategorySuggestion,
} from '../ebay-category-matcher.service'

function makeService(overrides?: { prisma?: any; auth?: any }) {
  const prisma = overrides?.prisma ?? {
    category: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  const auth = overrides?.auth ?? {
    getApplicationAccessToken: jest.fn().mockResolvedValue('test-app-token'),
  }
  const service = new EbayCategoryMatcherService(prisma as any, auth as any)
  return { service, prisma, auth }
}

describe('normalize() — category name canonicalisation', () => {
  it('lowercases + strips hyphens/underscores/spaces', () => {
    expect(normalize('Herren-Hemden')).toBe('herrenhemden')
    expect(normalize('HERREN  HEMDEN')).toBe('herrenhemden')
    expect(normalize('herren_hemden')).toBe('herrenhemden')
    expect(normalize('  Herren Hemden  ')).toBe('herrenhemden')
  })

  it('strips Umlaut diacritics (ä→a, ö→o, ü→u)', () => {
    expect(normalize('Mädchen Röcke')).toBe('madchenrocke')
    expect(normalize('Mäntel')).toBe('mantel')
    expect(normalize('Schürzen')).toBe('schurzen')
  })

  it('strips forward-slashes too (shop uses "Jungen/Mädchen" style names)', () => {
    expect(normalize('Jungen/Mädchen')).toBe('jungenmadchen')
  })
})

describe('isAutoApproved()', () => {
  const mkSugg = (name: string): EbayCategorySuggestion => ({
    categoryId: '1059',
    categoryName: name,
    breadcrumb: '',
  })

  it('returns true when top-1 normalized matches input', () => {
    expect(isAutoApproved('Herren-Hemden', [mkSugg('Herren Hemden')])).toBe(true)
    expect(isAutoApproved('Mädchen Röcke', [mkSugg('Madchen Rocke')])).toBe(true)
  })

  it('returns false when top-1 differs from input', () => {
    expect(isAutoApproved('Herren-Hemden', [mkSugg('Freizeithemden')])).toBe(false)
  })

  it('returns false when suggestions are empty', () => {
    expect(isAutoApproved('Herren-Hemden', [])).toBe(false)
  })
})

describe('EbayCategoryMatcherService.fetchSuggestionsForAllActive', () => {
  function stubFetch(behaviour: (url: string) => any) {
    return jest.fn(async (url: string) => {
      const result = behaviour(String(url))
      if (result instanceof Error) throw result
      return {
        ok: result.ok ?? true,
        status: result.status ?? 200,
        json: async () => result.body,
      }
    })
  }

  it('resilience: one failed fetch does not abort the rest of the batch', async () => {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', slug: 'a', ebayCategoryId: null, translations: [{ name: 'Alpha' }] },
          { id: 'c2', slug: 'b', ebayCategoryId: null, translations: [{ name: 'Beta' }] },
          { id: 'c3', slug: 'c', ebayCategoryId: null, translations: [{ name: 'Gamma' }] },
        ]),
      },
      $transaction: jest.fn(),
    }
    const { service } = makeService({ prisma })
    service.__setFetchForTests(
      stubFetch((url) => {
        if (url.includes('get_default_category_tree_id')) {
          return { body: { categoryTreeId: '77' } }
        }
        if (url.includes('q=Gamma')) return new Error('get_category_suggestions failed: 500')
        if (url.includes('q=Alpha')) {
          return {
            body: {
              categorySuggestions: [
                {
                  category: { categoryId: '100', categoryName: 'Alpha' },
                  categoryTreeNodeAncestors: [],
                },
              ],
            },
          }
        }
        if (url.includes('q=Beta')) {
          return {
            body: {
              categorySuggestions: [
                {
                  category: { categoryId: '200', categoryName: 'Beta' },
                  categoryTreeNodeAncestors: [],
                },
              ],
            },
          }
        }
        return { body: { categorySuggestions: [] } }
      }) as any,
    )

    const result = await service.fetchSuggestionsForAllActive()

    expect(result.totalCategories).toBe(3)
    expect(result.autoApprovedCount).toBe(2) // Alpha + Beta normalized-match
    expect(result.fetchErrorCount).toBe(1)
    const errorRow = result.rows.find((r) => r.slug === 'c')!
    expect(errorRow.fetchError).toMatch(/500/)
    expect(errorRow.suggestions).toEqual([])
  })

  it('builds breadcrumb from reversed ancestors + leaf name', async () => {
    // eBay returns ancestors in LEAF→ROOT order (parent first). Our code
    // reverses them and appends the leaf name for "Root > ... > Leaf".
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', slug: 'jeans', ebayCategoryId: null, translations: [{ name: 'Jeans' }] },
        ]),
      },
      $transaction: jest.fn(),
    }
    const { service } = makeService({ prisma })
    service.__setFetchForTests(
      stubFetch((url) => {
        if (url.includes('get_default_category_tree_id')) return { body: { categoryTreeId: '77' } }
        return {
          body: {
            categorySuggestions: [
              {
                category: { categoryId: '9999', categoryName: 'Jeans' },
                categoryTreeNodeAncestors: [
                  { categoryName: 'Herren' }, // parent
                  { categoryName: 'Kleidung' }, // grandparent
                  { categoryName: 'Mode' }, // root
                ],
              },
            ],
          },
        }
      }) as any,
    )

    const result = await service.fetchSuggestionsForAllActive()
    expect(result.rows[0].suggestions[0].breadcrumb).toBe('Mode > Kleidung > Herren > Jeans')
  })

  it('falls back to slug when no DE translation exists', async () => {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', slug: 'herren-schuhe', ebayCategoryId: null, translations: [] },
        ]),
      },
      $transaction: jest.fn(),
    }
    const { service } = makeService({ prisma })
    const capturedQueries: string[] = []
    service.__setFetchForTests(
      jest.fn(async (url: string) => {
        capturedQueries.push(String(url))
        if (String(url).includes('get_default_category_tree_id')) {
          return { ok: true, status: 200, json: async () => ({ categoryTreeId: '77' }) }
        }
        return { ok: true, status: 200, json: async () => ({ categorySuggestions: [] }) }
      }) as any,
    )

    const result = await service.fetchSuggestionsForAllActive()
    expect(result.rows[0].hasDeTranslation).toBe(false)
    expect(result.rows[0].deName).toBe('herren-schuhe') // slug fallback
    // Query URL contains the slug as the q= param
    const suggestionCall = capturedQueries.find((u) => u.includes('get_category_suggestions'))!
    expect(suggestionCall).toContain('q=herren-schuhe')
  })
})

describe('EbayCategoryMatcherService.saveMappings', () => {
  it('writes only dirty rows; returns updated count', async () => {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', slug: 'herren', ebayCategoryId: '1059' }, // no-op: same
          { id: 'b', slug: 'damen', ebayCategoryId: null }, // dirty: null→2222
          { id: 'c', slug: 'kids', ebayCategoryId: '3333' }, // dirty: 3333→null
        ]),
        update: jest.fn(),
      },
      adminAuditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    }
    const { service } = makeService({ prisma })

    const result = await service.saveMappings(
      [
        { categoryId: 'a', ebayCategoryId: '1059' },
        { categoryId: 'b', ebayCategoryId: '2222' },
        { categoryId: 'c', ebayCategoryId: null },
      ],
      'admin-1',
    )

    expect(result).toEqual({ updated: 2, unchanged: 1 })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // The transaction receives an array: 2 updates + 1 audit
    const txArg = prisma.$transaction.mock.calls[0][0]
    expect(txArg).toHaveLength(3)
  })

  it('skips $transaction entirely when every row is a no-op', async () => {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a', slug: 'x', ebayCategoryId: '1059' }]),
        update: jest.fn(),
      },
      adminAuditLog: { create: jest.fn() },
      $transaction: jest.fn(),
    }
    const { service } = makeService({ prisma })

    const result = await service.saveMappings([{ categoryId: 'a', ebayCategoryId: '1059' }], 'admin-1')

    expect(result).toEqual({ updated: 0, unchanged: 1 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
