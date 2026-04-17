import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto } from './dto/create-product.dto'
import { Language } from '@omnichannel/types'
import { ensureVariantBarcode } from '../../common/helpers/variant-barcode'
import { resolveUniqueSkus, SkuAdjustment } from '../../common/helpers/sku-resolver'
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service'
import { buildProductCreatedPayload } from '../webhooks/payload-builders/product'

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
  // Variant-level filters: a product matches if AT LEAST ONE active variant matches.
  colors?: string[]
  sizes?: string[]
  inStock?: boolean
}

// ── Size sort: numeric first (2,3,34,36...), then letter sizes in canonical order
//                (XXS → XS → S → M → L → XL → XXL → 3XL → 4XL → ...), then alphabetical fallback.
//
// Why a custom comparator: alphabetical sort produces nonsense like "2,3,34,3XL,4XL,L,M,S,XS,XXL"
// for a typical clothing shop that mixes baby ages, shoe sizes and adult letter sizes.
const LETTER_SIZE_ORDER: Record<string, number> = {
  XXXS: 0, '3XS': 0,
  XXS: 1, '2XS': 1,
  XS: 2,
  S: 3,
  M: 4,
  L: 5,
  XL: 6,
  XXL: 7, '2XL': 7,
  XXXL: 8, '3XL': 8,
  XXXXL: 9, '4XL': 9,
  '5XL': 10,
  '6XL': 11,
  '7XL': 12,
}

export function compareSizes(a: string, b: string): number {
  const aTrim = a.trim()
  const bTrim = b.trim()

  // Pure-number sizes (e.g. "2", "34", "164") sort numerically and come first.
  const aIsNum = /^\d+(\.\d+)?$/.test(aTrim)
  const bIsNum = /^\d+(\.\d+)?$/.test(bTrim)
  if (aIsNum && bIsNum) return parseFloat(aTrim) - parseFloat(bTrim)
  if (aIsNum) return -1
  if (bIsNum) return 1

  // Letter sizes use the canonical clothing order.
  const aRank = LETTER_SIZE_ORDER[aTrim.toUpperCase()]
  const bRank = LETTER_SIZE_ORDER[bTrim.toUpperCase()]
  if (aRank !== undefined && bRank !== undefined) return aRank - bRank
  if (aRank !== undefined) return -1
  if (bRank !== undefined) return 1

  // Anything else (typos, custom labels, age ranges like "0-3M") → alphabetical fallback.
  return aTrim.localeCompare(bTrim)
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name)

  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit-test TestingModules that only provide Prisma still resolve.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async create(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { slug: dto.slug },
    })
    if (existing) throw new ConflictException(`Slug "${dto.slug}" bereits vergeben`)

    // Find default warehouse for initial inventory
    const defaultWarehouse = await this.prisma.warehouse.findFirst({
      where: { isDefault: true, isActive: true },
    })

    // Resolve SKU collisions BEFORE insert. The wizard generates
    // deterministic SKUs from `MAL-<slug6>-<color3>-<size>`, which means
    // two products with similar slug prefixes (e.g. "herren-schuhe" vs
    // "herren-schue") would produce identical SKUs and trip Prisma's
    // `sku @unique` constraint with a P2002 → 500 error.
    //
    // The resolver checks each base SKU against the DB, appending a
    // `-002/-003/...` suffix until it finds a free slot. The list of
    // adjustments is returned to the caller so the frontend can surface
    // a toast like "SKU war belegt, wurde zu ...-002 geändert".
    const baseSkus = dto.variants.map((v) => v.sku)
    const { resolved, adjustments } = await resolveUniqueSkus(this.prisma, baseSkus)

    const product = await this.prisma.product.create({
      data: {
        slug: dto.slug,
        categoryId: dto.categoryId,
        brand: dto.brand,
        gender: dto.gender as any,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        taxRate: dto.taxRate ?? 19,
        isActive: dto.isActive ?? false, // New products default INACTIVE — admin must review first
        isFeatured: dto.isFeatured ?? false,
        publishedAt: dto.isActive ? new Date() : null,
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
          create: dto.variants.map((v, i) => {
            // Use the resolved SKU — may be suffixed if the base
            // collided with an existing variant.
            const finalSku = resolved[i]
            return {
              sku: finalSku,
              // Guard: every variant must carry a non-empty barcode.
              // Default = final SKU (not the original!) to keep sku
              // and barcode in sync. External EAN overrides still win.
              barcode: ensureVariantBarcode({ sku: finalSku, barcode: v.barcode }),
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
            }
          }),
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

    // Fire-and-forget outbound webhook — product.created with full payload
    // (3 languages + all images + variants + shop URLs) so n8n can auto-post
    // to Instagram/Facebook/TikTok without any API callback. Not awaited.
    // If builder or emit fails, swallow and log — never blocks product creation.
    if (this.webhookDispatcher) {
      const appUrl = this.config?.get<string>('APP_URL', 'https://malak-bekleidung.com') ?? 'https://malak-bekleidung.com'
      buildProductCreatedPayload(this.prisma, product.id, appUrl)
        .then((payload) =>
          payload ? this.webhookDispatcher!.emit('product.created', payload) : undefined,
        )
        .catch((err) => this.logger.warn(`product.created webhook failed: ${err?.message ?? err}`))
    }

    // Attach the adjustments list as a non-DB field on the response so
    // the frontend can show a "SKU was auto-renamed" toast without an
    // extra round-trip. Non-empty only when at least one SKU changed.
    return { ...product, skuAdjustments: adjustments } as typeof product & { skuAdjustments: SkuAdjustment[] }
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
      colors,
      sizes,
      inStock,
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

    // Variant-level filters: a product matches if at least one active variant matches.
    // Color names are case-insensitive (stored as DE strings, but the URL might send any case).
    const variantConditions: any = { isActive: true }
    let hasVariantFilter = false
    if (colors && colors.length > 0) {
      variantConditions.color = { in: colors, mode: 'insensitive' }
      hasVariantFilter = true
    }
    if (sizes && sizes.length > 0) {
      variantConditions.size = { in: sizes, mode: 'insensitive' }
      hasVariantFilter = true
    }
    if (inStock) {
      variantConditions.inventory = {
        some: {
          quantityOnHand: { gt: 0 },
        },
      }
      hasVariantFilter = true
    }
    if (hasVariantFilter) {
      where.variants = { some: variantConditions }
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
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
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

  /**
   * Returns the distinct colors and sizes available across all active variants,
   * optionally narrowed to a single category. Used by the storefront filter sidebar
   * so customers only see options that actually have products.
   */
  async getFilterOptions(categoryId?: string): Promise<{
    colors: { name: string; hex: string | null }[]
    sizes: string[]
  }> {
    const where: any = {
      isActive: true,
      product: { isActive: true, deletedAt: null },
    }
    if (categoryId) {
      // Match parent or child categories (same logic as findAll)
      const childCats = await this.prisma.category.findMany({
        where: { parentId: categoryId, isActive: true },
        select: { id: true },
      })
      where.product.categoryId =
        childCats.length > 0
          ? { in: [categoryId, ...childCats.map((c) => c.id)] }
          : categoryId
    }

    const variants = await this.prisma.productVariant.findMany({
      where,
      select: { color: true, colorHex: true, size: true },
    })

    // Deduplicate colors by name (case-insensitive), keep first hex seen
    const colorMap = new Map<string, { name: string; hex: string | null }>()
    const sizeSet = new Set<string>()
    for (const v of variants) {
      if (v.color) {
        const key = v.color.toLowerCase()
        if (!colorMap.has(key)) {
          colorMap.set(key, { name: v.color, hex: v.colorHex ?? null })
        }
      }
      if (v.size) sizeSet.add(v.size)
    }

    return {
      colors: Array.from(colorMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      sizes: Array.from(sizeSet).sort(compareSizes),
    }
  }

  async checkStock(variantIds: string[]): Promise<Record<string, number>> {
    const inventories = await this.prisma.inventory.findMany({
      where: {
        variantId: { in: variantIds },
        variant: { isActive: true, product: { isActive: true, deletedAt: null } },
        warehouse: { isActive: true },
      },
      select: { variantId: true, quantityOnHand: true, quantityReserved: true },
    })
    const result: Record<string, number> = {}
    for (const id of variantIds) result[id] = 0
    for (const inv of inventories) {
      result[inv.variantId] = (result[inv.variantId] ?? 0) + Math.max(0, inv.quantityOnHand - inv.quantityReserved)
    }
    return result
  }

  async findOne(slug: string, lang: Language = 'de') {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      include: {
        // Load ALL three translations, not just the requested locale.
        // formatProductDetail() walks a fallback chain
        // requested → de → en → first available, so a product that only
        // has a German description still shows something on the Arabic
        // storefront instead of "no description available".
        translations: true,
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
            translations: true,
          },
        },
      },
    })

    if (!product) throw new NotFoundException(`Produkt "${slug}" nicht gefunden`)

    return this.formatProductDetail(product, lang)
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

    // PostgreSQL full-text search on translations + ILIKE fallback for partial matches
    // For multi-word queries, search each word separately with ILIKE
    const words = query.split(/\s+/).filter((w) => w.length >= 2)
    const likePattern = `%${query}%`
    const firstWord = words[0] ? `%${words[0]}%` : likePattern
    const results = await this.prisma.$queryRaw<{ id: string; rank: number }[]>`
      SELECT p.id, GREATEST(
        ts_rank(
          to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, '')),
          plainto_tsquery('simple', ${query})
        ),
        CASE WHEN pt.name ILIKE ${likePattern} THEN 0.5 ELSE 0 END
      ) AS rank
      FROM products p
      JOIN product_translations pt ON pt.product_id = p.id AND pt.language = ${lang}::"Language"
      WHERE p.is_active = true AND p.deleted_at IS NULL
        AND (
          to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, ''))
            @@ plainto_tsquery('simple', ${query})
          OR pt.name ILIKE ${likePattern}
          OR pt.description ILIKE ${likePattern}
          OR pt.name ILIKE ${firstWord}
        )
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${skip}
    `

    if (results.length === 0) {
      // Log zero-result search for analytics
      this.prisma.searchLog.create({
        data: { query, language: lang, resultCount: 0 },
      }).catch(() => {})
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } }
    }

    const ids = results.map((r) => r.id)

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        translations: { where: { language: lang as any } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
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
      JOIN product_translations pt ON pt.product_id = p.id AND pt.language = ${lang}::"Language"
      WHERE p.is_active = true AND p.deleted_at IS NULL
        AND (
          to_tsvector('simple', COALESCE(pt.name, '') || ' ' || COALESCE(pt.description, ''))
            @@ plainto_tsquery('simple', ${query})
          OR pt.name ILIKE ${likePattern}
          OR pt.description ILIKE ${likePattern}
          OR pt.name ILIKE ${firstWord}
        )
    `
    const total = Number(countResult[0]?.count ?? 0)

    // Log search for analytics (fire-and-forget, don't block response)
    this.prisma.searchLog.create({
      data: { query, language: lang, resultCount: total },
    }).catch(() => {})

    return {
      data: ordered.map((p) => this.formatProduct(p)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  private formatProduct(product: any) {
    const translation = product.translations?.[0]
    const primaryImage = product.images?.[0]
    // Max-per-warehouse Semantik: der Checkout erwartet EIN Warehouse pro
    // Cart-Line (orders.service.ts:649) → wir dürfen nie mehr versprechen
    // als ein einzelnes Warehouse in einer Bestellung liefern kann.
    // Pro Variante: max(available) über alle Warehouses. Produkt-total = Summe davon.
    const totalStock = product.variants?.reduce((sum: number, v: any) => {
      const maxPerWh = v.inventory?.reduce(
        (max: number, i: any) => Math.max(max, i.quantityOnHand - i.quantityReserved),
        0,
      ) ?? 0
      return sum + maxPerWh
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

  private formatProductDetail(product: any, lang: Language = 'de') {
    // Pick the best available translation using a fallback chain:
    // requested language → de → en → whatever comes first. Same chain
    // applied per field so a product with e.g. AR name but empty AR
    // description falls back to DE description only for the missing field,
    // keeping the Arabic name when possible.
    const translations: any[] = product.translations ?? []
    const byLang = (l: string) => translations.find((t: any) => t.language === l)
    const pickField = (key: 'name' | 'description' | 'sizeGuide' | 'metaTitle' | 'metaDesc'): string | undefined => {
      const val = byLang(lang)?.[key]
      if (val) return val
      const de = byLang('de')?.[key]
      if (de) return de
      const en = byLang('en')?.[key]
      if (en) return en
      for (const t of translations) {
        if (t?.[key]) return t[key]
      }
      return undefined
    }

    const categoryTranslations: any[] = product.category?.translations ?? []
    const categoryName = (() => {
      const inLang = categoryTranslations.find((t: any) => t.language === lang)?.name
      if (inLang) return inLang
      const de = categoryTranslations.find((t: any) => t.language === 'de')?.name
      if (de) return de
      const en = categoryTranslations.find((t: any) => t.language === 'en')?.name
      return en ?? categoryTranslations[0]?.name
    })()

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
      excludeFromReturns: product.excludeFromReturns ?? false,
      returnExclusionReason: product.returnExclusionReason ?? null,
      name: pickField('name') ?? product.slug,
      description: pickField('description'),
      sizeGuide: pickField('sizeGuide'),
      metaTitle: pickField('metaTitle'),
      metaDesc: pickField('metaDesc'),
      images: product.images.map((img: any) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
        colorName: img.colorName ?? null,
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
        isActive: v.isActive,
        price: Number(product.basePrice) + Number(v.priceModifier),
        priceModifier: Number(v.priceModifier),
        weightGrams: v.weightGrams,
        // stock = max-orderable-in-einer-Bestellung (= max pro Warehouse).
        // Der Checkout weist genau ein Warehouse pro Cart-Line zu; wir dürfen
        // also nie die Summe über alle Warehouses versprechen, sonst 409 bei
        // gesplittetem Bestand. isInStock bleibt "any warehouse > 0".
        stock: v.inventory.reduce(
          (max: number, i: any) => Math.max(max, i.quantityOnHand - i.quantityReserved),
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
            // Same fallback chain as the product name.
            name: categoryName ?? product.category.slug,
          }
        : null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }
  }
}
