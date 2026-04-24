import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { Language } from '@omnichannel/types'

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

    // Pre-delete check for attached SizeCharts. Pre-hardening, deactivating
    // a category silently orphaned any charts attached to it — the charts
    // stayed active but customers in that category saw no size guide until
    // someone re-linked them. The audit flagged this as a "structured 409"
    // so the admin is forced to decide explicitly: detach the charts first,
    // or deactivate them alongside the category. Defense-in-depth.
    const attachedCharts = await this.prisma.sizeChart.findMany({
      where: { categoryId: id, isActive: true },
      select: { id: true, name: true },
    })
    if (attachedCharts.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'CategoryHasAttachedSizeCharts',
        message: {
          de: `Kategorie kann nicht deaktiviert werden — ${attachedCharts.length} Größentabelle(n) hängen daran. Bitte zuerst entfernen oder neu zuordnen.`,
          en: `Category cannot be deactivated — ${attachedCharts.length} size chart(s) are attached. Please detach or reassign them first.`,
          ar: `لا يمكن إلغاء تفعيل الفئة — يوجد ${attachedCharts.length} جدول(جداول) مقاسات مرتبطة بها. يرجى إزالتها أو إعادة تعيينها أولاً.`,
        },
        data: { attachedCharts },
      })
    }

    return this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    })
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
