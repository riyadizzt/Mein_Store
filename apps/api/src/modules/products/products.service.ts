import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto } from './dto/create-product.dto'
import { Language } from '@omnichannel/types'

export interface ProductFilters {
  lang?: Language
  categoryId?: string
  gender?: string
  brand?: string
  minPrice?: number
  maxPrice?: number
  isFeatured?: boolean
  sort?: string
  page?: number
  limit?: number
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { slug: dto.slug },
    })
    if (existing) throw new ConflictException(`Slug "${dto.slug}" bereits vergeben`)

    // Find default warehouse for initial inventory
    const defaultWarehouse = await this.prisma.warehouse.findFirst({
      where: { isDefault: true, isActive: true },
    })

    const product = await this.prisma.product.create({
      data: {
        slug: dto.slug,
        categoryId: dto.categoryId,
        brand: dto.brand,
        gender: dto.gender as any,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        taxRate: dto.taxRate ?? 19,
        isActive: dto.isActive ?? true,
        isFeatured: dto.isFeatured ?? false,
        publishedAt: new Date(),
        translations: {
          create: dto.translations.map((t) => ({
            language: t.language as any,
            name: t.name,
            description: t.description,
            sizeGuide: t.sizeGuide,
            metaTitle: t.metaTitle,
            metaDesc: t.metaDesc,
          })),
        },
        variants: {
          create: dto.variants.map((v) => ({
            sku: v.sku,
            barcode: v.barcode,
            color: v.color,
            colorHex: v.colorHex,
            size: v.size,
            sizeSystem: v.sizeSystem as any,
            priceModifier: v.priceModifier ?? 0,
            weightGrams: v.weightGrams,
            ...(defaultWarehouse && v.initialStock !== undefined
              ? {
                  inventory: {
                    create: {
                      warehouseId: defaultWarehouse.id,
                      quantityOnHand: v.initialStock,
                    },
                  },
                }
              : {}),
          })),
        },
      },
      include: {
        translations: true,
        variants: {
          include: { inventory: true },
        },
        images: true,
      },
    })

    return product
  }

  async findAll(filters: ProductFilters = {}) {
    const {
      lang = 'de',
      categoryId,
      gender,
      brand,
      minPrice,
      maxPrice,
      isFeatured,
      sort,
      page = 1,
      limit = 20,
    } = filters

    const skip = (page - 1) * limit

    const where: any = {
      isActive: true,
      deletedAt: null,
    }

    if (categoryId) {
      // Check if this is a parent category — if so, include all children
      const childCats = await this.prisma.category.findMany({
        where: { parentId: categoryId, isActive: true },
        select: { id: true },
      })
      if (childCats.length > 0) {
        where.categoryId = { in: [categoryId, ...childCats.map((c) => c.id)] }
      } else {
        where.categoryId = categoryId
      }
    }
    if (gender) where.gender = gender
    if (brand) where.brand = { contains: brand, mode: 'insensitive' }
    if (isFeatured !== undefined) where.isFeatured = isFeatured
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {}
      if (minPrice !== undefined) where.basePrice.gte = minPrice
      if (maxPrice !== undefined) where.basePrice.lte = maxPrice
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: sort === 'price_asc' ? { basePrice: 'asc' }
          : sort === 'price_desc' ? { basePrice: 'desc' }
          : sort === 'bestseller' ? { isFeatured: 'desc' }
          : { createdAt: 'desc' },
        include: {
          translations: { where: { language: lang as any } },
          images: {
            where: { isPrimary: true },
            take: 1,
          },
          variants: {
            where: { isActive: true },
            include: {
              inventory: {
                select: { quantityOnHand: true, quantityReserved: true },
              },
            },
          },
          category: {
            include: {
              translations: { where: { language: lang as any } },
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ])

    return {
      data: items.map((p) => this.formatProduct(p)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(slug: string, lang: Language = 'de') {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      include: {
        translations: { where: { language: lang as any } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: {
          where: { isActive: true },
          include: {
            inventory: {
              select: {
                quantityOnHand: true,
                quantityReserved: true,
                warehouseId: true,
              },
            },
          },
        },
        category: {
          include: {
            translations: { where: { language: lang as any } },
          },
        },
      },
    })

    if (!product) throw new NotFoundException(`Produkt "${slug}" nicht gefunden`)

    return this.formatProductDetail(product)
  }

  async findById(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    })
    if (!product) throw new NotFoundException('Produkt nicht gefunden')
    return product
  }

  async update(id: string, dto: Partial<CreateProductDto>) {
    await this.findById(id)

    if (dto.slug) {
      const conflict = await this.prisma.product.findFirst({
        where: { slug: dto.slug, id: { not: id } },
      })
      if (conflict) throw new ConflictException(`Slug "${dto.slug}" bereits vergeben`)
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        slug: dto.slug,
        categoryId: dto.categoryId,
        brand: dto.brand,
        gender: dto.gender as any,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        taxRate: dto.taxRate,
        isFeatured: dto.isFeatured,
        ...(dto.translations
          ? {
              translations: {
                deleteMany: {},
                create: dto.translations.map((t) => ({
                  language: t.language as any,
                  name: t.name,
                  description: t.description,
                  sizeGuide: t.sizeGuide,
                  metaTitle: t.metaTitle,
                  metaDesc: t.metaDesc,
                })),
              },
            }
          : {}),
      },
      include: {
        translations: true,
        variants: true,
        images: true,
      },
    })
  }

  async remove(id: string) {
    await this.findById(id)
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    })
  }

  async search(query: string, lang: Language = 'de', page = 1, limit = 20) {
    const skip = (page - 1) * limit

    // PostgreSQL full-text search on translations
    const results = await this.prisma.$queryRaw<{ id: string; rank: number }[]>`
      SELECT p.id, ts_rank(
        to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, '')),
        plainto_tsquery('simple', ${query})
      ) AS rank
      FROM products p
      JOIN product_translations pt ON pt.product_id = p.id AND pt.language = ${lang}
      WHERE p.is_active = true AND p.deleted_at IS NULL
        AND to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, ''))
            @@ plainto_tsquery('simple', ${query})
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${skip}
    `

    if (results.length === 0) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } }
    }

    const ids = results.map((r) => r.id)

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        translations: { where: { language: lang as any } },
        images: { where: { isPrimary: true }, take: 1 },
        variants: {
          where: { isActive: true },
          include: {
            inventory: { select: { quantityOnHand: true, quantityReserved: true } },
          },
        },
      },
    })

    // Preserve search ranking order
    const productMap = new Map(products.map((p) => [p.id, p]))
    const ordered = ids.map((id) => productMap.get(id)).filter(Boolean) as typeof products

    const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM products p
      JOIN product_translations pt ON pt.product_id = p.id AND pt.language = ${lang}
      WHERE p.is_active = true AND p.deleted_at IS NULL
        AND to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, ''))
            @@ plainto_tsquery('simple', ${query})
    `
    const total = Number(countResult[0]?.count ?? 0)

    return {
      data: ordered.map((p) => this.formatProduct(p)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  private formatProduct(product: any) {
    const translation = product.translations?.[0]
    const primaryImage = product.images?.[0]
    const totalStock = product.variants?.reduce((sum: number, v: any) => {
      const available = v.inventory?.reduce(
        (s: number, i: any) => s + (i.quantityOnHand - i.quantityReserved),
        0,
      ) ?? 0
      return sum + available
    }, 0) ?? 0

    return {
      id: product.id,
      slug: product.slug,
      brand: product.brand,
      gender: product.gender,
      basePrice: Number(product.basePrice),
      salePrice: product.salePrice ? Number(product.salePrice) : null,
      taxRate: Number(product.taxRate),
      isFeatured: product.isFeatured,
      name: translation?.name ?? product.slug,
      description: translation?.description,
      imageUrl: primaryImage?.url ?? null,
      category: product.category
        ? {
            id: product.category.id,
            slug: product.category.slug,
            name: product.category.translations?.[0]?.name ?? product.category.slug,
          }
        : null,
      variantCount: product.variants?.length ?? 0,
      totalStock,
      createdAt: product.createdAt,
    }
  }

  private formatProductDetail(product: any) {
    const translation = product.translations?.[0]

    return {
      id: product.id,
      slug: product.slug,
      brand: product.brand,
      gender: product.gender,
      basePrice: Number(product.basePrice),
      salePrice: product.salePrice ? Number(product.salePrice) : null,
      taxRate: Number(product.taxRate),
      isFeatured: product.isFeatured,
      publishedAt: product.publishedAt,
      name: translation?.name ?? product.slug,
      description: translation?.description,
      sizeGuide: translation?.sizeGuide,
      metaTitle: translation?.metaTitle,
      metaDesc: translation?.metaDesc,
      images: product.images.map((img: any) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
        isPrimary: img.isPrimary,
        sortOrder: img.sortOrder,
      })),
      variants: product.variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        color: v.color,
        colorHex: v.colorHex,
        size: v.size,
        sizeSystem: v.sizeSystem,
        price: Number(product.basePrice) + Number(v.priceModifier),
        priceModifier: Number(v.priceModifier),
        weightGrams: v.weightGrams,
        stock: v.inventory.reduce(
          (s: number, i: any) => s + (i.quantityOnHand - i.quantityReserved),
          0,
        ),
        isInStock: v.inventory.some(
          (i: any) => i.quantityOnHand - i.quantityReserved > 0,
        ),
      })),
      category: product.category
        ? {
            id: product.category.id,
            slug: product.category.slug,
            name: product.category.translations?.[0]?.name ?? product.category.slug,
          }
        : null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }
  }
}
