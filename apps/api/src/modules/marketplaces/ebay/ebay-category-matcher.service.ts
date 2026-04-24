/**
 * eBay Category Matcher (Taxonomy → ebayCategoryId).
 *
 * Fetches eBay's Commerce Taxonomy API suggestions for every active
 * shop category's DE name, auto-approves on normalized-name equality,
 * and persists admin-picked mappings in batch.
 *
 * Two modes of operation per HTTP surface:
 *   GET  /admin/ebay/category-mapping  → fetchSuggestionsForAllActive
 *   POST /admin/ebay/category-mapping  → saveMappings
 *
 * Matching policy (discussed + locked-in):
 *   - normalize(deName) === normalize(topSuggestion.name) → auto-approve
 *   - else → needs-review (amber in UI), admin picks from Top-3 or
 *     enters a manual numeric ID or chooses "leave empty"
 *
 * API calls:
 *   - GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE
 *     (once per run)
 *   - GET /commerce/taxonomy/v1/category_tree/{id}/get_category_suggestions?q=...
 *     (once per category, Accept-Language: de-DE, app-token Bearer)
 *
 * Batching: Promise.allSettled in waves of 10 parallel. Resilient:
 * one failed fetch is captured as row.fetchError, other rows unaffected.
 */

import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { EbayAuthService } from './ebay-auth.service'
import { resolveEbayMode } from './ebay-env'

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface EbayCategorySuggestion {
  categoryId: string
  categoryName: string
  /** DE-localized breadcrumb from root to leaf, e.g. "Kleidung > Herren > Hemden". */
  breadcrumb: string
}

export interface CategoryMatchRow {
  categoryId: string
  slug: string
  deName: string
  hasDeTranslation: boolean
  currentEbayCategoryId: string | null
  suggestions: EbayCategorySuggestion[]
  autoApproved: boolean
  suggestedEbayCategoryId: string | null
  fetchError?: string
}

export interface AllMatchesResponse {
  treeId: string
  rows: CategoryMatchRow[]
  totalCategories: number
  autoApprovedCount: number
  needsReviewCount: number
  fetchErrorCount: number
}

// ── Pure helpers (exported for tests) ────────────────────────────

/**
 * Canonicalize a category name for equality matching.
 * Case-fold, strip diacritics (ä→a, ö→o, ü→u, etc), strip separators
 * (-, _, whitespace, /). Result is a comparable signature.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_\s/]+/g, '')
}

/**
 * True iff the top eBay suggestion's name equals the input name after
 * normalization. Drives the auto-approve vs needs-review UX split.
 */
export function isAutoApproved(
  deName: string,
  suggestions: EbayCategorySuggestion[],
): boolean {
  if (suggestions.length === 0) return false
  return normalize(suggestions[0].categoryName) === normalize(deName)
}

// ── Constants ────────────────────────────────────────────────────

const BATCH_SIZE = 10
const REQUEST_TIMEOUT_MS = 10_000

// ── Service ──────────────────────────────────────────────────────

@Injectable()
export class EbayCategoryMatcherService {
  private readonly logger = new Logger(EbayCategoryMatcherService.name)
  private fetchImpl: FetchLike = (input, init) => fetch(input as any, init)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: EbayAuthService,
  ) {}

  /** Test-only: inject a stub fetch. */
  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchImpl = f ?? ((input, init) => fetch(input as any, init))
  }

  private baseUrl(): string {
    return resolveEbayMode() === 'production'
      ? 'https://api.ebay.com'
      : 'https://api.sandbox.ebay.com'
  }

  private async fetchTreeId(appToken: string): Promise<string> {
    const res = await this.fetchImpl(
      `${this.baseUrl()}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: 'application/json',
          'Accept-Language': 'de-DE',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      throw new Error(`get_default_category_tree_id failed: ${res.status}`)
    }
    const body = (await res.json()) as { categoryTreeId: string }
    return body.categoryTreeId
  }

  private async fetchSuggestionsFor(
    treeId: string,
    appToken: string,
    deName: string,
  ): Promise<EbayCategorySuggestion[]> {
    const url = `${this.baseUrl()}/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(deName)}`
    const res = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${appToken}`,
        Accept: 'application/json',
        'Accept-Language': 'de-DE',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`get_category_suggestions failed: ${res.status}`)
    }
    const body = (await res.json()) as {
      categorySuggestions?: Array<{
        category: { categoryId: string; categoryName: string }
        categoryTreeNodeAncestors?: Array<{ categoryName: string }>
      }>
    }
    return (body.categorySuggestions ?? []).slice(0, 3).map((s) => {
      // eBay ancestors array is ordered LEAF → ROOT (parent first,
      // then grandparent, etc). Reverse to get root → parent, then
      // append the leaf name for the display breadcrumb.
      const ancestors = (s.categoryTreeNodeAncestors ?? [])
        .map((a) => a.categoryName)
        .reverse()
      const breadcrumb = [...ancestors, s.category.categoryName].join(' > ')
      return {
        categoryId: s.category.categoryId,
        categoryName: s.category.categoryName,
        breadcrumb,
      }
    })
  }

  /**
   * Main entrypoint. Fetches suggestions for every active category,
   * batched 10-parallel. Resilient via Promise.allSettled — one row's
   * fetch failure doesn't abort the others.
   */
  async fetchSuggestionsForAllActive(): Promise<AllMatchesResponse> {
    const appToken = await this.auth.getApplicationAccessToken()
    const treeId = await this.fetchTreeId(appToken)

    const cats = await this.prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
        ebayCategoryId: true,
        translations: {
          where: { language: 'de' },
          select: { name: true },
        },
      },
      orderBy: { slug: 'asc' },
    })

    const rows: CategoryMatchRow[] = []
    for (let i = 0; i < cats.length; i += BATCH_SIZE) {
      const batch = cats.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (cat) => {
          const hasDe = cat.translations.length > 0 && !!cat.translations[0].name
          const deName = hasDe ? cat.translations[0].name : cat.slug
          const suggestions = await this.fetchSuggestionsFor(treeId, appToken, deName)
          return { cat, deName, hasDe, suggestions }
        }),
      )
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        const cat = batch[j]
        const hasDe = cat.translations.length > 0 && !!cat.translations[0].name
        const deName = hasDe ? cat.translations[0].name : cat.slug
        if (r.status === 'fulfilled') {
          const { suggestions } = r.value
          const approved = isAutoApproved(deName, suggestions)
          rows.push({
            categoryId: cat.id,
            slug: cat.slug,
            deName,
            hasDeTranslation: hasDe,
            currentEbayCategoryId: cat.ebayCategoryId,
            suggestions,
            autoApproved: approved,
            suggestedEbayCategoryId: suggestions[0]?.categoryId ?? null,
          })
        } else {
          const err = r.reason as { message?: string }
          this.logger.warn(
            `Fetch failed for category ${cat.slug}: ${err?.message ?? r.reason}`,
          )
          rows.push({
            categoryId: cat.id,
            slug: cat.slug,
            deName,
            hasDeTranslation: hasDe,
            currentEbayCategoryId: cat.ebayCategoryId,
            suggestions: [],
            autoApproved: false,
            suggestedEbayCategoryId: null,
            fetchError: String(err?.message ?? r.reason),
          })
        }
      }
    }

    return {
      treeId,
      rows,
      totalCategories: rows.length,
      autoApprovedCount: rows.filter((r) => r.autoApproved).length,
      needsReviewCount: rows.filter((r) => !r.autoApproved && !r.fetchError).length,
      fetchErrorCount: rows.filter((r) => r.fetchError).length,
    }
  }

  /**
   * Batch save. Dirty-only: rows whose input ebayCategoryId equals the
   * currently-stored value are filtered out before the transaction.
   * Everything in one $transaction + single CATEGORY_UPDATED audit row
   * with a per-slug before/after map (entityId='batch' is the marker
   * for multi-category operations).
   */
  async saveMappings(
    inputs: Array<{ categoryId: string; ebayCategoryId: string | null }>,
    adminId: string,
  ): Promise<{ updated: number; unchanged: number }> {
    const ids = inputs.map((i) => i.categoryId)
    const existing = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, ebayCategoryId: true },
    })
    const existingMap = new Map(existing.map((c) => [c.id, c]))

    const changes: Array<{
      id: string
      slug: string
      before: string | null
      after: string | null
    }> = []
    for (const input of inputs) {
      const cur = existingMap.get(input.categoryId)
      if (!cur) continue
      const normalizedAfter = input.ebayCategoryId?.trim() || null
      if (normalizedAfter === cur.ebayCategoryId) continue
      changes.push({
        id: input.categoryId,
        slug: cur.slug,
        before: cur.ebayCategoryId,
        after: normalizedAfter,
      })
    }

    if (changes.length === 0) {
      return { updated: 0, unchanged: inputs.length }
    }

    await this.prisma.$transaction([
      ...changes.map((c) =>
        this.prisma.category.update({
          where: { id: c.id },
          data: { ebayCategoryId: c.after },
        }),
      ),
      this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action: 'CATEGORY_UPDATED',
          entityType: 'category',
          entityId: 'batch',
          changes: {
            before: {
              ebayCategoryIds: Object.fromEntries(changes.map((c) => [c.slug, c.before])),
            },
            after: {
              ebayCategoryIds: Object.fromEntries(changes.map((c) => [c.slug, c.after])),
            },
            batchSize: changes.length,
            source: 'ebay-category-mapper',
          } as any,
        },
      }),
    ])

    return { updated: changes.length, unchanged: inputs.length - changes.length }
  }
}
