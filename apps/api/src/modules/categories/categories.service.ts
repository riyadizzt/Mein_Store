import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { Language } from '@omnichannel/types'

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(lang: Language = 'de') {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      include: {
        translations: { where: { language: lang } },
        children: {
          where: { isActive: true },
          include: { translations: { where: { language: lang } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return categories.map((c) => this.formatCategory(c))
  }

  async findOne(slug: string, lang: Language = 'de') {
    const category = await this.prisma.category.findUnique({
      where: { slug, isActive: true },
      include: {
        translations: { where: { language: lang } },
        children: {
          where: { isActive: true },
          include: { translations: { where: { language: lang } } },
        },
      },
    })

    if (!category) throw new NotFoundException(`Kategorie "${slug}" nicht gefunden`)
    return this.formatCategory(category)
  }

  async create(dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { slug: dto.slug } })
    if (existing) throw new ConflictException(`Slug "${dto.slug}" bereits vergeben`)

    return this.prisma.category.create({
      data: {
        slug: dto.slug,
        parentId: dto.parentId,
        imageUrl: dto.imageUrl,
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

    return this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    })
  }

  private formatCategory(category: any) {
    const translation = category.translations?.[0]
    return {
      id: category.id,
      slug: category.slug,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      name: translation?.name ?? category.slug,
      description: translation?.description,
      children: category.children?.map((c: any) => this.formatCategory(c)) ?? [],
    }
  }
}
