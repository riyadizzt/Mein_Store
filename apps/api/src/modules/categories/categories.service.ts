import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { Language } from '@omnichannel/types'

export interface ArchiveWithMoveResult {
  archivedCategoryId: string
  archivedCategorySlug: string
  targetCategoryId: string
  targetCategorySlug: string
  productsMoved: number
  movedProductSlugs: string[]
  movedVariantIds: string[]
}

export interface CategoryImpact {
  category: { id: string; slug: string; isActive: boolean; parentId: string | null }
  attachedProducts:   { count: number; sample: Array<{ id: string; slug: string }> }
  attachedCoupons:    { count: number; sample: Array<{ id: string; code: string }> }
  attachedPromotions: { count: number; sample: Array<{ id: string; name: string }> }
  children:           { count: number; sample: Array<{ id: string; slug: string; isActive: boolean }> }
  attachedSizeCharts: { count: number; sample: Array<{ id: string; name: string }> }
  canArchive: boolean
  blockingReasons: string[]
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: Language = 'de') {
    // Include requested language + German fallback so we never show raw slugs
    const langs = lang === 'de' ? [lang] : [lang, 'de' as Language]
    const langFilter = { where: { language: { in: langs } } }

    const categories = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      include: {
        translations: langFilter,
        children: {
          where: { isActive: true },
          include: { translations: langFilter },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return categories.map((c) => this.formatCategory(c, lang))
  }

  async findOne(slug: string, lang: Language = 'de') {
    const langs = lang === 'de' ? [lang] : [lang, 'de' as Language]
    const langFilter = { where: { language: { in: langs } } }

    const category = await this.prisma.category.findUnique({
      where: { slug, isActive: true },
      include: {
        translations: langFilter,
        children: {
          where: { isActive: true },
          include: { translations: langFilter },
        },
      },
    })

    if (!category) throw new NotFoundException(`Kategorie "${slug}" nicht gefunden`)
    return this.formatCategory(category, lang)
  }

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { slug: dto.slug } })
    if (existing) throw new ConflictException(`Slug "${dto.slug}" bereits vergeben`)

    return this.prisma.category.create({
      data: {
        slug: dto.slug,
        parentId: dto.parentId,
        imageUrl: dto.imageUrl,
        iconKey: dto.iconKey ?? null,
        googleCategoryId: dto.googleCategoryId ?? null,
        googleCategoryLabel: dto.googleCategoryLabel ?? null,
        ebayCategoryId: dto.ebayCategoryId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        translations: {
          create: dto.translations.map((t) => ({
            language: t.language,
            name: t.name,
            description: t.description,
          })),
        },
      },
      include: { translations: true },
    })
  }

  async update(id: string, dto: Partial<CreateCategoryDto>) {
    const category = await this.prisma.category.findUnique({ where: { id } })
    if (!category) throw new NotFoundException('Kategorie nicht gefunden')

    return this.prisma.category.update({
      where: { id },
      data: {
        slug: dto.slug,
        parentId: dto.parentId,
        imageUrl: dto.imageUrl,
        iconKey: dto.iconKey,
        googleCategoryId: dto.googleCategoryId,
        googleCategoryLabel: dto.googleCategoryLabel,
        ebayCategoryId: dto.ebayCategoryId,
        sortOrder: dto.sortOrder,
        translations: dto.translations
          ? {
              deleteMany: {},
              create: dto.translations.map((t) => ({
                language: t.language,
                name: t.name,
                description: t.description,
              })),
            }
          : undefined,
      },
      include: { translations: true },
    })
  }

  async remove(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } })
    if (!category) throw new NotFoundException('Kategorie nicht gefunden')

    // Pre-archive integrity checks. A category archive (isActive=false)
    // hides the category from the shop but keeps all FK references
    // intact. Without these guards, archiving a category silently
    // orphaned every reference to it — products became invisible,
    // coupons stopped applying, promotions lost their target, children
    // pointed to an archived parent. Defense-in-depth: check every
    // downstream in parallel, aggregate blockers, throw one structured
    // 409 so the admin sees the full picture in a single round-trip.
    //
    // Pattern extends the SizeChart guard from Size-Charts Hardening G
    // (2026-04-21) — same shape, four more dependency types.
    const [products, coupons, promotions, children, charts] = await Promise.all([
      this.prisma.product.findMany({
        where: { categoryId: id, deletedAt: null },
        select: { id: true, slug: true },
        take: 5,
      }),
      this.prisma.coupon.findMany({
        where: { appliesToCategoryId: id },
        select: { id: true, code: true },
        take: 5,
      }),
      this.prisma.promotion.findMany({
        where: { categoryId: id },
        select: { id: true, name: true },
        take: 5,
      }),
      this.prisma.category.findMany({
        where: { parentId: id },
        select: { id: true, slug: true, isActive: true },
        take: 5,
      }),
      this.prisma.sizeChart.findMany({
        where: { categoryId: id, isActive: true },
        select: { id: true, name: true },
        take: 5,
      }),
    ])
    const [pCount, cCount, prCount, chCount, scCount] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.coupon.count({ where: { appliesToCategoryId: id } }),
      this.prisma.promotion.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.sizeChart.count({ where: { categoryId: id, isActive: true } }),
    ])

    const blockers: Record<string, number> = {}
    if (pCount > 0) blockers.products = pCount
    if (cCount > 0) blockers.coupons = cCount
    if (prCount > 0) blockers.promotions = prCount
    if (chCount > 0) blockers.children = chCount
    if (scCount > 0) blockers.sizeCharts = scCount

    if (Object.keys(blockers).length > 0) {
      const de: string[] = []
      const en: string[] = []
      const ar: string[] = []
      if (pCount > 0)  { de.push(`${pCount} Produkt(e)`);         en.push(`${pCount} product(s)`);                            ar.push(`${pCount} منتج`) }
      if (cCount > 0)  { de.push(`${cCount} Gutschein(e)`);       en.push(`${cCount} coupon(s)`);                             ar.push(`${cCount} كوبون`) }
      if (prCount > 0) { de.push(`${prCount} Promotion(en)`);     en.push(`${prCount} promotion(s)`);                         ar.push(`${prCount} عرض ترويجي`) }
      if (chCount > 0) { de.push(`${chCount} Unterkategorie(n)`); en.push(`${chCount} sub-categor${chCount === 1 ? 'y' : 'ies'}`); ar.push(`${chCount} فئة فرعية`) }
      if (scCount > 0) { de.push(`${scCount} Größentabelle(n)`);  en.push(`${scCount} size chart(s)`);                        ar.push(`${scCount} جدول مقاسات`) }

      throw new ConflictException({
        statusCode: 409,
        error: 'CategoryHasAttachedResources',
        message: {
          de: `Kategorie kann nicht archiviert werden — ${de.join(', ')} sind noch zugeordnet. Bitte zuerst entfernen oder neu zuordnen.`,
          en: `Category cannot be archived — ${en.join(', ')} still attached. Please detach or reassign first.`,
          ar: `لا يمكن أرشفة الفئة — ${ar.join('، ')} لا يزالون مرتبطين. يرجى إزالتهم أو إعادة تعيينهم أولاً.`,
        },
        data: {
          blockers,
          attachedProducts:   { count: pCount,  sample: products },
          attachedCoupons:    { count: cCount,  sample: coupons },
          attachedPromotions: { count: prCount, sample: promotions },
          children:           { count: chCount, sample: children },
          attachedSizeCharts: { count: scCount, sample: charts },
        },
      })
    }

    return this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    })
  }

  /**
   * Dry-run: what would happen if this category were archived RIGHT NOW?
   * Drives the admin delete-confirm modal — counts + 5-sample per
   * dependency type. Read-only, safe to call speculatively on modal open.
   */
  async getImpact(id: string): Promise<CategoryImpact> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, slug: true, isActive: true, parentId: true },
    })
    if (!category) throw new NotFoundException('Kategorie nicht gefunden')

    const [products, coupons, promotions, children, charts] = await Promise.all([
      this.prisma.product.findMany({
        where: { categoryId: id, deletedAt: null },
        select: { id: true, slug: true },
        take: 5,
      }),
      this.prisma.coupon.findMany({
        where: { appliesToCategoryId: id },
        select: { id: true, code: true },
        take: 5,
      }),
      this.prisma.promotion.findMany({
        where: { categoryId: id },
        select: { id: true, name: true },
        take: 5,
      }),
      this.prisma.category.findMany({
        where: { parentId: id },
        select: { id: true, slug: true, isActive: true },
        take: 5,
      }),
      this.prisma.sizeChart.findMany({
        where: { categoryId: id, isActive: true },
        select: { id: true, name: true },
        take: 5,
      }),
    ])
    const [pCount, cCount, prCount, chCount, scCount] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.coupon.count({ where: { appliesToCategoryId: id } }),
      this.prisma.promotion.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.sizeChart.count({ where: { categoryId: id, isActive: true } }),
    ])

    const blockingReasons: string[] = []
    if (pCount > 0) blockingReasons.push('products')
    if (cCount > 0) blockingReasons.push('coupons')
    if (prCount > 0) blockingReasons.push('promotions')
    if (chCount > 0) blockingReasons.push('children')
    if (scCount > 0) blockingReasons.push('sizeCharts')

    return {
      category,
      attachedProducts:   { count: pCount,  sample: products },
      attachedCoupons:    { count: cCount,  sample: coupons },
      attachedPromotions: { count: prCount, sample: promotions },
      children:           { count: chCount, sample: children },
      attachedSizeCharts: { count: scCount, sample: charts },
      canArchive: blockingReasons.length === 0,
      blockingReasons,
    }
  }

  /**
   * Archives a category after moving all its active products to a target
   * category. Atomic: either all products move + source archives, or
   * nothing changes.
   *
   * Guards (all throw BEFORE any DB write — defense-in-depth; client
   * also filters archived/self/descendants from the picker):
   *   NotFound            — source or target missing
   *   409 TargetIsSelf    — source === target
   *   409 TargetIsArchived — target.isActive === false
   *   409 TargetIsDescendant — target is in source's subtree
   *   409 CategoryHasNonProductBlockers — coupons/promotions/children/
   *                                        charts still attached
   */
  async archiveWithMove(
    sourceId: string,
    targetCategoryId: string,
  ): Promise<ArchiveWithMoveResult> {
    if (sourceId === targetCategoryId) {
      throw new ConflictException({
        statusCode: 409,
        error: 'TargetIsSelf',
        message: {
          de: 'Die Zielkategorie kann nicht die gleiche sein wie die zu archivierende.',
          en: 'The target category cannot be the same as the one being archived.',
          ar: 'لا يمكن أن تكون الفئة المستهدفة هي نفس الفئة المؤرشفة.',
        },
      })
    }

    const [source, target] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: sourceId } }),
      this.prisma.category.findUnique({ where: { id: targetCategoryId } }),
    ])
    if (!source) throw new NotFoundException('Quellkategorie nicht gefunden')
    if (!target) throw new NotFoundException('Zielkategorie nicht gefunden')

    if (!target.isActive) {
      throw new ConflictException({
        statusCode: 409,
        error: 'TargetIsArchived',
        message: {
          de: 'Die Zielkategorie ist archiviert und kann keine Produkte aufnehmen.',
          en: 'The target category is archived and cannot receive products.',
          ar: 'الفئة المستهدفة مؤرشفة ولا يمكنها استقبال منتجات.',
        },
      })
    }

    // Descendant-check: walk target's ancestry upward, fail if sourceId
    // ever appears. Bounded at 16 hops to stop runaway loops if an
    // orphaned hierarchy somehow forms a cycle (shouldn't happen, but
    // defense-in-depth against future data-integrity issues).
    const descendantOfSource = await this.isDescendantOf(targetCategoryId, sourceId)
    if (descendantOfSource) {
      throw new ConflictException({
        statusCode: 409,
        error: 'TargetIsDescendant',
        message: {
          de: 'Die Zielkategorie liegt unterhalb der zu archivierenden Kategorie.',
          en: 'The target category is below the category being archived.',
          ar: 'الفئة المستهدفة تقع تحت الفئة المؤرشفة في التسلسل.',
        },
      })
    }

    // Non-product blockers MUST be resolved separately — this endpoint
    // only handles products. UI hides the move-picker in this case, the
    // server-guard ensures the contract even if someone calls the API
    // directly.
    const [cCount, prCount, chCount, scCount] = await Promise.all([
      this.prisma.coupon.count({ where: { appliesToCategoryId: sourceId } }),
      this.prisma.promotion.count({ where: { categoryId: sourceId } }),
      this.prisma.category.count({ where: { parentId: sourceId } }),
      this.prisma.sizeChart.count({ where: { categoryId: sourceId, isActive: true } }),
    ])
    if (cCount + prCount + chCount + scCount > 0) {
      const blockers: Record<string, number> = {}
      if (cCount > 0) blockers.coupons = cCount
      if (prCount > 0) blockers.promotions = prCount
      if (chCount > 0) blockers.children = chCount
      if (scCount > 0) blockers.sizeCharts = scCount
      throw new ConflictException({
        statusCode: 409,
        error: 'CategoryHasNonProductBlockers',
        message: {
          de: 'Weitere Zuordnungen (Gutscheine, Promotionen, Unterkategorien oder Größentabellen) blockieren die Archivierung. Bitte zuerst separat auflösen.',
          en: 'Other attachments (coupons, promotions, sub-categories or size charts) are blocking the archive. Please resolve them separately first.',
          ar: 'هناك ارتباطات أخرى (كوبونات، عروض ترويجية، فئات فرعية، أو جداول مقاسات) تمنع الأرشفة. يرجى حلها بشكل منفصل أولاً.',
        },
        data: { blockers },
      })
    }

    // Capture products + variantIds BEFORE the update — needed for
    // revalidation + audit context. Runs outside the tx; a product
    // concurrently moving to sourceId between query and tx just gets
    // swept along by the updateMany filter, which is fine.
    const productsToMove = await this.prisma.product.findMany({
      where: { categoryId: sourceId, deletedAt: null },
      select: { id: true, slug: true, variants: { select: { id: true } } },
    })
    const movedProductSlugs = productsToMove.map((p) => p.slug)
    const movedVariantIds = productsToMove.flatMap((p) => p.variants.map((v) => v.id))

    // Atomic: all-or-nothing.
    const result = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.product.updateMany({
        where: { categoryId: sourceId, deletedAt: null },
        data: { categoryId: targetCategoryId },
      })
      await tx.category.update({
        where: { id: sourceId },
        data: { isActive: false },
      })
      return { productsMoved: moved.count }
    })

    return {
      archivedCategoryId: sourceId,
      archivedCategorySlug: source.slug,
      targetCategoryId,
      targetCategorySlug: target.slug,
      productsMoved: result.productsMoved,
      movedProductSlugs,
      movedVariantIds,
    }
  }

  /**
   * Un-archives a category. No touch on products, translations, or any
   * other linked data — just flips isActive back to true. Idempotent:
   * calling on an already-active category is a no-op (not an error).
   */
  async reactivate(id: string): Promise<{ id: string; slug: string; isActive: true }> {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, slug: true, isActive: true },
    })
    if (!cat) throw new NotFoundException('Kategorie nicht gefunden')
    if (cat.isActive) {
      return { id: cat.id, slug: cat.slug, isActive: true }
    }
    const updated = await this.prisma.category.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, slug: true, isActive: true },
    })
    return { id: updated.id, slug: updated.slug, isActive: true }
  }

  /**
   * True iff `candidateId` is in the subtree rooted at `ancestorId`.
   * Walks parent chain upward; bounded at 16 hops to stop runaway
   * loops if an orphaned hierarchy somehow forms a cycle. The project's
   * real hierarchy is 2-3 levels, so 16 is extremely conservative.
   */
  private async isDescendantOf(candidateId: string, ancestorId: string): Promise<boolean> {
    let currentId: string | null = candidateId
    let hops = 0
    while (currentId && hops < 16) {
      if (currentId === ancestorId) return true
      const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      })
      currentId = parent?.parentId ?? null
      hops++
    }
    return false
  }

  private formatCategory(category: any, lang: Language = 'de') {
    // Prefer requested language, fallback to German, then slug
    const translations = category.translations ?? []
    const primary = translations.find((t: any) => t.language === lang)
    const fallback = translations.find((t: any) => t.language === 'de')
    const translation = primary ?? fallback
    return {
      id: category.id,
      parentId: category.parentId ?? null,
      slug: category.slug,
      imageUrl: category.imageUrl,
      iconKey: category.iconKey ?? null,
      // Taxonomy-IDs: previously dropped from the public projection,
      // causing the Google Shopping feed to silently fall back to
      // category.name (see C6 note in schema.prisma). Admin UIs that
      // read /categories instead of the direct Prisma path also need
      // these fields to render the taxonomy pickers correctly.
      googleCategoryId: category.googleCategoryId ?? null,
      googleCategoryLabel: category.googleCategoryLabel ?? null,
      ebayCategoryId: category.ebayCategoryId ?? null,
      sortOrder: category.sortOrder,
      name: translation?.name ?? category.slug,
      description: translation?.description,
      children: category.children?.map((c: any) => this.formatCategory(c, lang)) ?? [],
    }
  }
}
