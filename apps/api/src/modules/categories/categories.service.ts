import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { Language } from '@omnichannel/types'

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
