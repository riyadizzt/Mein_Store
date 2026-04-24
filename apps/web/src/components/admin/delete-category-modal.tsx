'use client'

/**
 * DeleteCategoryModal — Commit 3 replacement for the old toast-only
 * delete-confirm flow. Consumes the Commit 2 /impact endpoint to render
 * a 3-state experience:
 *
 *   A  Clean (no dependencies)  → simple confirm + DELETE /:id
 *   B  Blocked by dependencies  → samples + conditional move-picker:
 *                                   only enabled when products are the
 *                                   ONLY blocker. Otherwise user must
 *                                   resolve coupons/promotions/children
 *                                   /charts separately first.
 *   C  Already archived         → green reactivate prompt
 *
 * Data flow:
 *   - open → /categories/admin/:id/impact (only for active cats)
 *   - submit state A → DELETE /categories/:id
 *   - submit state B → POST  /categories/admin/:id/archive-with-move
 *                      (with targetCategoryId in body)
 *   - submit state C → POST  /categories/admin/:id/reactivate
 *
 * All user-visible strings 3-lang (DE/EN/AR). RTL-safe — counts use
 * Latin digits in all locales per project convention.
 */

import { useState, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2, AlertTriangle, CheckCircle2, X, ExternalLink } from 'lucide-react'
import type { Category } from '@/hooks/use-categories'

const t3 = (l: string, de: string, en: string, ar: string) =>
  l === 'ar' ? ar : l === 'en' ? en : de

interface ImpactResponse {
  category: { id: string; slug: string; isActive: boolean; parentId: string | null }
  attachedProducts:   { count: number; sample: Array<{ id: string; slug: string }> }
  attachedCoupons:    { count: number; sample: Array<{ id: string; code: string }> }
  attachedPromotions: { count: number; sample: Array<{ id: string; name: string }> }
  children:           { count: number; sample: Array<{ id: string; slug: string; isActive: boolean }> }
  attachedSizeCharts: { count: number; sample: Array<{ id: string; name: string }> }
  canArchive: boolean
  blockingReasons: string[]
}

interface Props {
  open: boolean
  category: Category | null
  allCategories: Category[]   // full tree for target picker
  onClose: () => void
  onArchived?: () => void
  onReactivated?: () => void
}

export function DeleteCategoryModal(props: Props) {
  const { open, category, allCategories, onClose } = props
  const locale = useLocale()

  // Impact query — only active categories need the dependency dry-run.
  // Archived cats go straight to the reactivate state (C).
  const isActive = category?.isActive !== false
  const { data: impact, isLoading } = useQuery<ImpactResponse>({
    queryKey: ['category-impact', category?.id],
    queryFn: async () => {
      const { data } = await api.get(`/categories/admin/${category!.id}/impact`)
      return data as ImpactResponse
    },
    enabled: open && !!category?.id && isActive,
    staleTime: 0,
  })

  if (!open || !category) return null

  // ── STATE C: archived → reactivate prompt ──────────────────
  if (!isActive) {
    return (
      <StateCReactivate
        category={category}
        onClose={onClose}
        onSuccess={() => {
          onClose()
          props.onReactivated?.()
        }}
        locale={locale}
      />
    )
  }

  // Loading
  if (isLoading || !impact) {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ModalShell>
    )
  }

  // ── STATE A: clean → simple confirm ───────────────────────
  if (impact.canArchive) {
    return (
      <StateAClean
        category={category}
        onClose={onClose}
        onSuccess={() => {
          onClose()
          props.onArchived?.()
        }}
        locale={locale}
      />
    )
  }

  // ── STATE B: blocked → samples + conditional move-picker ──
  return (
    <StateBBlocked
      category={category}
      impact={impact}
      allCategories={allCategories}
      onClose={onClose}
      onSuccess={() => {
        onClose()
        props.onArchived?.()
      }}
      locale={locale}
    />
  )
}

// ──────────────────────────────────────────────────────────────
// Modal shell
// ──────────────────────────────────────────────────────────────

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-background shadow-xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b">
      <h2 className="text-base font-semibold">{title}</h2>
      <button
        onClick={onClose}
        className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// STATE A — Clean confirm
// ──────────────────────────────────────────────────────────────

function StateAClean({
  category,
  onClose,
  onSuccess,
  locale,
}: {
  category: Category
  onClose: () => void
  onSuccess: () => void
  locale: string
}) {
  const mutation = useMutation({
    mutationFn: async () => api.delete(`/categories/${category.id}`),
    onSuccess,
  })

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={t3(locale, 'Kategorie archivieren', 'Archive category', 'أرشفة الفئة')}
        onClose={onClose}
      />
      <div className="px-6 py-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t3(
            locale,
            `Die Kategorie "${category.slug}" hat keine Produkte, Gutscheine, Promotionen, Unterkategorien oder Größentabellen zugeordnet. Sie kann archiviert werden.`,
            `Category "${category.slug}" has no attached products, coupons, promotions, sub-categories, or size charts. It can be archived.`,
            `الفئة "${category.slug}" لا تحتوي على منتجات، كوبونات، عروض ترويجية، فئات فرعية أو جداول مقاسات. يمكن أرشفتها.`,
          )}
        </p>
      </div>
      <div className="flex gap-2 px-6 py-4 border-t justify-end">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
        </Button>
        <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ltr:mr-2 rtl:ml-2" />}
          {t3(locale, 'Archivieren', 'Archive', 'أرشفة')}
        </Button>
      </div>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────
// STATE B — Blocked with samples + conditional move-picker
// ──────────────────────────────────────────────────────────────

function StateBBlocked({
  category,
  impact,
  allCategories,
  onClose,
  onSuccess,
  locale,
}: {
  category: Category
  impact: ImpactResponse
  allCategories: Category[]
  onClose: () => void
  onSuccess: () => void
  locale: string
}) {
  const [targetId, setTargetId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // Move-picker is only useful when products are the ONLY blocker.
  // Mixing with coupon/promo/child blockers → user must resolve those
  // separately (the archive-with-move endpoint will refuse anyway,
  // but hiding the picker is cleaner UX).
  const onlyProducts =
    impact.attachedProducts.count > 0 &&
    impact.attachedCoupons.count === 0 &&
    impact.attachedPromotions.count === 0 &&
    impact.children.count === 0 &&
    impact.attachedSizeCharts.count === 0

  // Filter the target picker:
  //   - exclude self
  //   - exclude all descendants (recursive)
  //   - exclude archived cats (can't receive products)
  const validTargets = useMemo(() => {
    const banned = collectSubtreeIds(allCategories, category.id)
    const flat: Category[] = []
    const walk = (nodes: Category[]) => {
      for (const n of nodes) {
        if (!banned.has(n.id) && n.isActive !== false) flat.push(n)
        if (n.children?.length) walk(n.children)
      }
    }
    walk(allCategories)
    return flat
  }, [allCategories, category.id])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!targetId) throw new Error('no target')
      return api.post(`/categories/admin/${category.id}/archive-with-move`, {
        targetCategoryId: targetId,
      })
    },
    onSuccess,
    onError: (e: any) => {
      const msg = e?.response?.data?.message ?? e?.message
      setError(typeof msg === 'object' ? msg[locale] ?? msg.de : String(msg))
    },
  })

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={t3(locale, 'Kategorie archivieren', 'Archive category', 'أرشفة الفئة')}
        onClose={onClose}
      />
      <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
        <p className="text-sm">
          <span className="font-medium">{category.slug}:</span>{' '}
          <span className="text-muted-foreground">
            {t3(
              locale,
              'Folgende Zuordnungen blockieren die Archivierung:',
              'The following attachments are blocking the archive:',
              'الارتباطات التالية تمنع الأرشفة:',
            )}
          </span>
        </p>

        {/* Dependency samples — 3 per type */}
        <DependencyBlock
          label={t3(locale, 'Produkte', 'Products', 'منتجات')}
          count={impact.attachedProducts.count}
          sample={impact.attachedProducts.sample.map((p) => p.slug)}
          href="/admin/products"
          locale={locale}
        />
        <DependencyBlock
          label={t3(locale, 'Gutscheine', 'Coupons', 'كوبونات')}
          count={impact.attachedCoupons.count}
          sample={impact.attachedCoupons.sample.map((c) => c.code)}
          href="/admin/marketing/coupons"
          locale={locale}
        />
        <DependencyBlock
          label={t3(locale, 'Promotionen', 'Promotions', 'عروض ترويجية')}
          count={impact.attachedPromotions.count}
          sample={impact.attachedPromotions.sample.map((p) => p.name)}
          href="/admin/marketing/promotions"
          locale={locale}
        />
        <DependencyBlock
          label={t3(locale, 'Unterkategorien', 'Sub-categories', 'فئات فرعية')}
          count={impact.children.count}
          sample={impact.children.sample.map((c) => c.slug)}
          href="/admin/categories"
          locale={locale}
        />
        <DependencyBlock
          label={t3(locale, 'Größentabellen', 'Size charts', 'جداول مقاسات')}
          count={impact.attachedSizeCharts.count}
          sample={impact.attachedSizeCharts.sample.map((s) => s.name)}
          href="/admin/sizing"
          locale={locale}
        />

        {/* Move-picker (only when products are the ONLY blocker) */}
        {onlyProducts && (
          <div className="pt-4 border-t space-y-2">
            <label className="text-sm font-medium block">
              {t3(locale, 'Produkte verschieben nach:', 'Move products to:', 'نقل المنتجات إلى:')}
            </label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border bg-background text-sm"
            >
              <option value="" disabled>
                {t3(locale, '— Zielkategorie wählen —', '— Select target —', '— اختر الهدف —')}
              </option>
              {validTargets.map((c) => {
                const label =
                  c.translations?.find((t) => t.language === locale)?.name ??
                  c.translations?.find((t) => t.language === 'de')?.name ??
                  c.slug
                return (
                  <option key={c.id} value={c.id}>
                    {label}
                  </option>
                )
              })}
            </select>
          </div>
        )}

        {/* Amber banner when mixed blockers prevent move */}
        {!onlyProducts && (
          <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              {t3(
                locale,
                'Gutscheine, Promotionen, Unterkategorien und Größentabellen müssen zuerst separat aufgelöst werden (Links oben).',
                'Coupons, promotions, sub-categories and size charts must be resolved separately first (links above).',
                'يجب أولاً حل الكوبونات والعروض الترويجية والفئات الفرعية وجداول المقاسات بشكل منفصل (الروابط أعلاه).',
              )}
            </span>
          </div>
        )}

        {error && (
          <div className="flex gap-2 p-3 rounded-lg bg-red-500/10 text-red-900 dark:text-red-200 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2 px-6 py-4 border-t justify-end">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
        </Button>
        <Button
          variant="destructive"
          onClick={() => mutation.mutate()}
          disabled={!onlyProducts || !targetId || mutation.isPending}
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ltr:mr-2 rtl:ml-2" />}
          {t3(
            locale,
            'Verschieben & Archivieren',
            'Move & Archive',
            'نقل وأرشفة',
          )}
        </Button>
      </div>
    </ModalShell>
  )
}

function DependencyBlock({
  label,
  count,
  sample,
  href,
  locale,
}: {
  label: string
  count: number
  sample: string[]
  href: string
  locale: string
}) {
  if (count === 0) return null
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium">
          <span dir="ltr" className="tabular-nums">
            {count}
          </span>{' '}
          {label}
        </span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          {t3(locale, 'Alle ansehen', 'View all', 'عرض الكل')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <ul className="text-xs text-muted-foreground space-y-0.5 ltr:pl-3 rtl:pr-3 list-disc list-inside">
        {sample.slice(0, 3).map((s, i) => (
          <li key={i} className="font-mono truncate">
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// STATE C — Reactivate archived category
// ──────────────────────────────────────────────────────────────

function StateCReactivate({
  category,
  onClose,
  onSuccess,
  locale,
}: {
  category: Category
  onClose: () => void
  onSuccess: () => void
  locale: string
}) {
  const mutation = useMutation({
    mutationFn: async () => api.post(`/categories/admin/${category.id}/reactivate`),
    onSuccess,
  })

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader
        title={t3(locale, 'Kategorie reaktivieren', 'Reactivate category', 'إعادة تفعيل الفئة')}
        onClose={onClose}
      />
      <div className="px-6 py-5 space-y-3">
        <div className="flex gap-2 p-3 rounded-lg bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            {t3(
              locale,
              `Diese Kategorie ("${category.slug}") ist archiviert. Reaktivieren macht sie wieder im Shop sichtbar. Keine anderen Änderungen — alle Zuordnungen bleiben wie sie sind.`,
              `This category ("${category.slug}") is archived. Reactivating makes it visible in the shop again. No other changes — all attachments stay as they are.`,
              `هذه الفئة ("${category.slug}") مؤرشفة. إعادة التفعيل تجعلها مرئية في المتجر مرة أخرى. لا توجد تغييرات أخرى — تبقى جميع الارتباطات كما هي.`,
            )}
          </span>
        </div>
      </div>
      <div className="flex gap-2 px-6 py-4 border-t justify-end">
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin ltr:mr-2 rtl:ml-2" />}
          {t3(locale, 'Reaktivieren', 'Reactivate', 'إعادة تفعيل')}
        </Button>
      </div>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/**
 * Recursively collects all IDs in the subtree rooted at `rootId`.
 * Used to exclude self + descendants from the move-picker (a target
 * below the source would make the archive pointless — the moved
 * products would stay inside the subtree that just got archived).
 */
function collectSubtreeIds(tree: Category[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  const childrenOf = new Map<string, Category[]>()
  const walk = (nodes: Category[]) => {
    for (const n of nodes) {
      const pid = n.parentId ?? '__root__'
      if (!childrenOf.has(pid)) childrenOf.set(pid, [])
      childrenOf.get(pid)!.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(tree)
  // BFS from root
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const c of childrenOf.get(cur) ?? []) {
      if (!ids.has(c.id)) {
        ids.add(c.id)
        queue.push(c.id)
      }
    }
  }
  return ids
}
