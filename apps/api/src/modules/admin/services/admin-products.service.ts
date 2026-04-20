import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { ensureVariantBarcode } from '../../../common/helpers/variant-barcode'

// Map color names (DE/EN/AR) to SKU-safe 3-letter codes
const COLOR_SKU_MAP: Record<string, string> = {
  Schwarz: 'BLK', Weiß: 'WEI', Blau: 'BLU', Rot: 'ROT',
  Grün: 'GRU', Grau: 'GRA', Beige: 'BEI', Navy: 'NAV',
  Braun: 'BRN', Rosa: 'RSA', Gelb: 'GEL', Orange: 'ORA',
  Lila: 'LIL', Türkis: 'TRK', Bordeaux: 'BDX', Khaki: 'KHK',
  Silber: 'SLB', Gold: 'GLD',
  // English
  Black: 'BLK', White: 'WEI', Blue: 'BLU', Red: 'ROT',
  Green: 'GRU', Gray: 'GRA', Brown: 'BRN', Pink: 'RSA',
  Yellow: 'GEL', Purple: 'LIL',
  // Arabic
  'أسود': 'BLK', 'أبيض': 'WEI', 'أزرق': 'BLU', 'أحمر': 'ROT',
  'أخضر': 'GRU', 'رمادي': 'GRA', 'بيج': 'BEI', 'كحلي': 'NAV',
  'بني': 'BRN', 'وردي': 'RSA', 'أصفر': 'GEL', 'برتقالي': 'ORA',
  'بنفسجي': 'LIL', 'فيروزي': 'TRK', 'خمري': 'BDX', 'كاكي': 'KHK',
  'فضي': 'SLB', 'ذهبي': 'GLD',
}

function colorToSkuCode(name: string): string {
  // Check known colors first
  if (COLOR_SKU_MAP[name]) return COLOR_SKU_MAP[name]
  // Fallback: take first 3 ASCII-safe uppercase chars
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
  const letters = ascii.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 2) return letters.slice(0, 3).toUpperCase()
  // Last resort: hash-based 3-char code
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) >>> 0
  return 'C' + (h % 900 + 100).toString()
}

@Injectable()
export class AdminProductsService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        translations: true,
        variants: {
          where: { isActive: true },
          include: {
            inventory: { select: { id: true, quantityOnHand: true, quantityReserved: true, reorderPoint: true, warehouse: { select: { id: true, name: true } } } },
          },
        },
        images: { orderBy: { sortOrder: 'asc' } },
        category: { include: { translations: true, parent: { include: { translations: true } } } },
        _count: { select: { reviews: true } },
      },
    })
    if (!product) throw new NotFoundException('Product not found')
    return product
  }

  async findAll(query: {
    search?: string
    isActive?: boolean
    status?: string       // active | inactive | deleted | all
    categoryId?: string
    parentCategoryId?: string
    stockStatus?: string  // in_stock | low | out_of_stock
    channel?: string      // facebook | tiktok | google | whatsapp
    priceMin?: number
    priceMax?: number
    sortBy?: string       // name | price | stock | date
    sortDir?: string
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 25, 200)
    const offset = query.offset ?? 0
    const where: any = {}

    // Status filter: active (default), inactive, deleted, all
    if (query.status === 'deleted') {
      where.deletedAt = { not: null }
    } else if (query.status === 'all') {
      // no deletedAt filter — show everything
    } else {
      where.deletedAt = null
    }

    if (query.isActive !== undefined) where.isActive = query.isActive
    if (query.status === 'inactive') { where.isActive = false; where.deletedAt = null }
    if (query.status === 'active') { where.isActive = true; where.deletedAt = null }
    if (query.search) {
      where.OR = [
        { slug: { contains: query.search, mode: 'insensitive' } },
        { translations: { some: { name: { contains: query.search, mode: 'insensitive' } } } },
        { variants: { some: { OR: [{ sku: { contains: query.search, mode: 'insensitive' } }, { barcode: { contains: query.search, mode: 'insensitive' } }] } } },
      ]
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId
    } else if (query.parentCategoryId) {
      const subcats = await this.prisma.category.findMany({
        where: { parentId: query.parentCategoryId, isActive: true },
        select: { id: true },
      })
      where.categoryId = { in: [query.parentCategoryId, ...subcats.map((c) => c.id)] }
    }

    if (query.priceMin != null || query.priceMax != null) {
      where.basePrice = {}
      if (query.priceMin != null) where.basePrice.gte = query.priceMin
      if (query.priceMax != null) where.basePrice.lte = query.priceMax
    }

    // Channel filter
    if (query.channel === 'facebook') where.channelFacebook = true
    else if (query.channel === 'tiktok') where.channelTiktok = true
    else if (query.channel === 'google') where.channelGoogle = true
    else if (query.channel === 'whatsapp') where.channelWhatsapp = true

    // Sorting
    const dir = query.sortDir === 'asc' ? 'asc' : 'desc'
    let orderBy: any = { createdAt: 'desc' }
    if (query.sortBy === 'price') orderBy = { basePrice: dir }
    else if (query.sortBy === 'name') orderBy = { translations: { _count: dir } } // fallback
    else if (query.sortBy === 'date') orderBy = { createdAt: dir }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          translations: { select: { language: true, name: true } },
          variants: {
            where: { isActive: true },
            select: {
              id: true, sku: true, barcode: true, color: true, colorHex: true, size: true,
              priceModifier: true,
              inventory: { select: { quantityOnHand: true, quantityReserved: true, reorderPoint: true } },
            },
          },
          // colorName is needed by the label-print page (/admin/etiketten)
          // so per-color photos render correctly instead of falling to a
          // coloured placeholder. `take` bumped so products with many color
          // variants don't get their images clipped.
          images: { select: { url: true, isPrimary: true, colorName: true }, orderBy: { sortOrder: 'asc' }, take: 20 },
          category: {
            select: {
              id: true, parentId: true,
              translations: { select: { name: true, language: true } },
              parent: { select: { translations: { select: { name: true, language: true } } } },
            },
          },
          _count: { select: { reviews: true } },
        },
        orderBy,
        take: limit,
        skip: offset,
      }),
      this.prisma.product.count({ where }),
    ])

    // Enrich with computed fields
    let enriched = products.map((p) => {
      // Calculate total stock across all variants and warehouses
      let totalStock = 0
      let totalReserved = 0
      let lowStockVariants = 0
      let outOfStockVariants = 0
      const uniqueColors = new Set<string>()
      const uniqueSizes = new Set<string>()
      let minPrice = Number(p.basePrice)
      let maxPrice = Number(p.basePrice)

      for (const v of p.variants) {
        if (v.color) uniqueColors.add(v.color)
        if (v.size) uniqueSizes.add(v.size)
        const variantPrice = Number(p.basePrice) + Number(v.priceModifier)
        if (variantPrice < minPrice) minPrice = variantPrice
        if (variantPrice > maxPrice) maxPrice = variantPrice

        let variantStock = 0
        let variantReserved = 0
        for (const inv of v.inventory) {
          variantStock += inv.quantityOnHand
          variantReserved += inv.quantityReserved
          totalStock += inv.quantityOnHand
          totalReserved += inv.quantityReserved
        }
        const avail = variantStock - variantReserved
        if (avail <= 0) outOfStockVariants++
        else if (v.inventory.some((inv) => (inv.quantityOnHand - inv.quantityReserved) <= inv.reorderPoint)) lowStockVariants++
      }

      const availableStock = totalStock - totalReserved
      const stockStatus = availableStock <= 0 ? 'out_of_stock'
        : outOfStockVariants > 0 || lowStockVariants > 0 ? 'low' : 'in_stock'

      // Check which translations exist
      const hasDE = p.translations.some((t) => t.language === 'de' && t.name)
      const hasEN = p.translations.some((t) => t.language === 'en' && t.name)
      const hasAR = p.translations.some((t) => t.language === 'ar' && t.name)

      return {
        id: p.id,
        slug: p.slug,
        basePrice: Number(p.basePrice),
        salePrice: (p as any).salePrice ? Number((p as any).salePrice) : null,
        isActive: p.isActive,
        isFeatured: p.isFeatured,
        channelFacebook: (p as any).channelFacebook ?? false,
        channelTiktok: (p as any).channelTiktok ?? false,
        channelGoogle: (p as any).channelGoogle ?? false,
        channelWhatsapp: (p as any).channelWhatsapp ?? false,
        deletedAt: p.deletedAt,
        createdAt: p.createdAt,
        translations: p.translations,
        missingLangs: [!hasDE && 'de', !hasEN && 'en', !hasAR && 'ar'].filter(Boolean),
        image: p.images.find((i) => i.isPrimary)?.url ?? p.images[0]?.url ?? null,
        imageCount: p.images.length,
        // Full images array so downstream callers (label-print station)
        // can do per-color matching via colorName.
        images: p.images.map((i) => ({ url: i.url, isPrimary: i.isPrimary, colorName: i.colorName })),
        category: p.category,
        variantsCount: p.variants.length,
        colors: [...uniqueColors],
        colorHexes: [...new Set(p.variants.filter((v) => v.colorHex).map((v) => v.colorHex!))],
        sizes: [...uniqueSizes],
        priceRange: { min: minPrice, max: maxPrice },
        totalStock: availableStock,
        totalStockRaw: totalStock,
        lowStockVariants,
        outOfStockVariants,
        stockStatus,
        reviewsCount: p._count.reviews,
        variants: p.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          color: v.color,
          colorHex: v.colorHex,
          size: v.size,
          price: Number(p.basePrice) + Number(v.priceModifier),
          stock: v.inventory.reduce((sum, inv) => sum + (inv.quantityOnHand - inv.quantityReserved), 0),
        })),
      }
    })

    // Post-filter by stock status
    if (query.stockStatus === 'out_of_stock') enriched = enriched.filter((p) => p.stockStatus === 'out_of_stock')
    else if (query.stockStatus === 'low') enriched = enriched.filter((p) => p.stockStatus === 'low' || p.stockStatus === 'out_of_stock')
    else if (query.stockStatus === 'in_stock') enriched = enriched.filter((p) => p.stockStatus === 'in_stock')

    // Sort by stock (post-query)
    if (query.sortBy === 'stock') {
      enriched.sort((a, b) => dir === 'asc' ? a.totalStock - b.totalStock : b.totalStock - a.totalStock)
    }

    return {
      data: enriched,
      meta: { total: query.stockStatus ? enriched.length : total, limit, offset },
    }
  }

  // ── DUPLICATE DETECTION ─────────────────────────────────────

  async checkDuplicate(query: { name?: string; sku?: string; barcode?: string; excludeId?: string }) {
    const results: { type: 'exact_name' | 'similar_name' | 'sku' | 'barcode'; product: any }[] = []

    if (query.name && query.name.trim().length >= 3) {
      const searchName = query.name.trim().toLowerCase()

      // Find all products with translations
      const candidates = await this.prisma.product.findMany({
        where: {
          deletedAt: null,
          ...(query.excludeId ? { id: { not: query.excludeId } } : {}),
          translations: { some: { name: { not: '' } } },
        },
        select: {
          id: true, slug: true, basePrice: true, isActive: true,
          translations: { select: { language: true, name: true } },
          variants: { select: { sku: true }, take: 1 },
          images: { select: { url: true, isPrimary: true }, take: 1, orderBy: { sortOrder: 'asc' } },
          category: { select: { translations: { select: { name: true, language: true } } } },
        },
        take: 200,
      })

      for (const product of candidates) {
        for (const t of product.translations) {
          if (!t.name) continue
          const prodName = t.name.toLowerCase()

          // Exact match
          if (prodName === searchName) {
            results.push({ type: 'exact_name', product: this.formatDuplicateResult(product) })
            break
          }

          // Similar match (Levenshtein)
          const dist = this.levenshtein(searchName, prodName)
          if (dist <= 3 && dist > 0) {
            results.push({ type: 'similar_name', product: this.formatDuplicateResult(product) })
            break
          }

          // Contains match
          if (prodName.includes(searchName) || searchName.includes(prodName)) {
            if (Math.abs(prodName.length - searchName.length) <= 5) {
              results.push({ type: 'similar_name', product: this.formatDuplicateResult(product) })
              break
            }
          }
        }
      }
    }

    // SKU check
    if (query.sku && query.sku.trim()) {
      const variant = await this.prisma.productVariant.findFirst({
        where: {
          sku: query.sku.trim(),
          ...(query.excludeId ? { product: { id: { not: query.excludeId } } } : {}),
        },
        select: {
          product: {
            select: {
              id: true, slug: true, basePrice: true, isActive: true,
              translations: { select: { language: true, name: true } },
              variants: { select: { sku: true }, take: 1 },
              images: { select: { url: true, isPrimary: true }, take: 1 },
              category: { select: { translations: { select: { name: true, language: true } } } },
            },
          },
        },
      })
      if (variant) {
        results.push({ type: 'sku', product: this.formatDuplicateResult(variant.product) })
      }
    }

    // Barcode check
    if (query.barcode && query.barcode.trim()) {
      const variant = await this.prisma.productVariant.findFirst({
        where: {
          barcode: query.barcode.trim(),
          ...(query.excludeId ? { product: { id: { not: query.excludeId } } } : {}),
        },
        select: {
          product: {
            select: {
              id: true, slug: true, basePrice: true, isActive: true,
              translations: { select: { language: true, name: true } },
              variants: { select: { sku: true }, take: 1 },
              images: { select: { url: true, isPrimary: true }, take: 1 },
              category: { select: { translations: { select: { name: true, language: true } } } },
            },
          },
        },
      })
      if (variant) {
        results.push({ type: 'barcode', product: this.formatDuplicateResult(variant.product) })
      }
    }

    // Deduplicate by product ID
    const seen = new Set<string>()
    const unique = results.filter((r) => {
      if (seen.has(r.product.id)) return false
      seen.add(r.product.id)
      return true
    })

    return { duplicates: unique }
  }

  async getNextSku(prefix: string): Promise<string> {
    // Find highest SKU number with this prefix
    const existing = await this.prisma.productVariant.findMany({
      where: { sku: { startsWith: prefix } },
      select: { sku: true },
      orderBy: { sku: 'desc' },
      take: 1,
    })
    if (existing.length === 0) return `${prefix}-001`

    const lastSku = existing[0].sku
    const parts = lastSku.split('-')
    const num = parseInt(parts[parts.length - 1]) || 0
    const next = String(num + 1).padStart(3, '0')
    parts[parts.length - 1] = next
    return parts.join('-')
  }

  private formatDuplicateResult(product: any) {
    return {
      id: product.id,
      slug: product.slug,
      translations: product.translations,
      sku: product.variants?.[0]?.sku ?? null,
      image: product.images?.find((i: any) => i.isPrimary)?.url ?? product.images?.[0]?.url ?? null,
      price: Number(product.basePrice),
      isActive: product.isActive,
      category: product.category,
    }
  }

  private levenshtein(a: string, b: string): number {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    const matrix: number[][] = []
    for (let i = 0; i <= b.length; i++) matrix[i] = [i]
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1]
        else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
      }
    }
    return matrix[b.length][a.length]
  }

  // ── VARIANT MANAGEMENT ──────────────────────────────────────

  async addColor(productId: string, data: {
    color: string; colorHex: string; sizes: string[];
    priceModifier?: number; stock?: Record<string, number>; barcode?: string;
  }, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, slug: true, variants: { select: { sku: true } } },
    })
    if (!product) throw new NotFoundException('Product not found')

    // Find the product's SKU prefix (e.g. MAL-050)
    const existingSku = product.variants[0]?.sku ?? ''
    const skuParts = existingSku.split('-')
    const skuPrefix = skuParts.length >= 2 ? `${skuParts[0]}-${skuParts[1]}` : `MAL-${Date.now().toString().slice(-3)}`

    // Color code for SKU (first 3 chars uppercase)
    const colorCode = colorToSkuCode(data.color)

    const defaultWh = await this.prisma.warehouse.findFirst({ where: { isDefault: true } })
    const whId = defaultWh?.id

    const created: any[] = []
    for (const size of data.sizes) {
      // Generate unique SKU
      let sku = `${skuPrefix}-${colorCode}-${size}`
      const existing = await this.prisma.productVariant.findUnique({ where: { sku } })
      if (existing) sku = `${skuPrefix}-${colorCode}-${size}-${Date.now().toString().slice(-4)}`

      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          sku,
          // Guard: barcode is mandatory on every variant. Defaults to
          // the generated SKU if the admin didn't supply an EAN.
          barcode: ensureVariantBarcode({ sku, barcode: data.barcode }),
          color: data.color,
          colorHex: data.colorHex,
          size,
          priceModifier: data.priceModifier ?? 0,
        },
      })

      // Create inventory record
      if (whId) {
        const stockQty = data.stock?.[size] ?? 0
        await this.prisma.inventory.create({
          data: { variantId: variant.id, warehouseId: whId, quantityOnHand: stockQty },
        })
        if (stockQty > 0) {
          await this.prisma.inventoryMovement.create({
            data: {
              variantId: variant.id, warehouseId: whId,
              type: 'purchase_received', quantity: stockQty,
              quantityBefore: 0, quantityAfter: stockQty,
              notes: `New color added: ${data.color}`, createdBy: adminId,
            },
          })
        }
      }

      created.push({ id: variant.id, sku, color: data.color, size, stock: data.stock?.[size] ?? 0 })
    }

    await this.audit.log({
      adminId, action: 'VARIANT_COLOR_ADDED', entityType: 'product', entityId: productId,
      changes: { after: { color: data.color, sizes: data.sizes, variants: created.length } }, ipAddress,
    })

    return { created: created.length, variants: created }
  }

  async addSize(productId: string, data: {
    size: string; colors: string[];
    priceModifier?: number; stock?: Record<string, number>;
  }, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        variants: { select: { sku: true, color: true, colorHex: true }, where: { isActive: true } },
      },
    })
    if (!product) throw new NotFoundException('Product not found')

    const skuParts = (product.variants[0]?.sku ?? '').split('-')
    const skuPrefix = skuParts.length >= 2 ? `${skuParts[0]}-${skuParts[1]}` : `MAL-${Date.now().toString().slice(-3)}`

    // Get colorHex map from existing variants
    const colorHexMap = new Map<string, string>()
    for (const v of product.variants) {
      if (v.color && v.colorHex) colorHexMap.set(v.color, v.colorHex)
    }

    const defaultWh = await this.prisma.warehouse.findFirst({ where: { isDefault: true } })
    const whId = defaultWh?.id

    const created: any[] = []
    for (const color of data.colors) {
      const colorCode = colorToSkuCode(color)
      let sku = `${skuPrefix}-${colorCode}-${data.size}`
      const existing = await this.prisma.productVariant.findUnique({ where: { sku } })
      if (existing) sku = `${skuPrefix}-${colorCode}-${data.size}-${Date.now().toString().slice(-4)}`

      const variant = await this.prisma.productVariant.create({
        data: {
          productId, sku,
          // Guard: barcode must never be null. addSize() didn't set
          // this field at all before — every size-variant landed in
          // the DB with barcode=null. Now defaults to SKU.
          barcode: ensureVariantBarcode({ sku }),
          color, colorHex: colorHexMap.get(color) ?? '#999999',
          size: data.size, priceModifier: data.priceModifier ?? 0,
        },
      })

      if (whId) {
        const stockQty = data.stock?.[color] ?? 0
        await this.prisma.inventory.create({
          data: { variantId: variant.id, warehouseId: whId, quantityOnHand: stockQty },
        })
        if (stockQty > 0) {
          await this.prisma.inventoryMovement.create({
            data: {
              variantId: variant.id, warehouseId: whId,
              type: 'purchase_received', quantity: stockQty,
              quantityBefore: 0, quantityAfter: stockQty,
              notes: `New size added: ${data.size}`, createdBy: adminId,
            },
          })
        }
      }

      created.push({ id: variant.id, sku, color, size: data.size, stock: data.stock?.[color] ?? 0 })
    }

    await this.audit.log({
      adminId, action: 'VARIANT_SIZE_ADDED', entityType: 'product', entityId: productId,
      changes: { after: { size: data.size, colors: data.colors, variants: created.length } }, ipAddress,
    })

    return { created: created.length, variants: created }
  }

  async deleteVariant(productId: string, variantId: string, adminId: string, ipAddress: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true, sku: true, color: true, size: true },
    })
    if (!variant) throw new NotFoundException('Variant not found')

    // Soft-delete by deactivating
    await this.prisma.productVariant.update({ where: { id: variantId }, data: { isActive: false } })

    await this.audit.log({
      adminId, action: 'VARIANT_DELETED', entityType: 'product', entityId: productId,
      changes: { before: { variantId, sku: variant.sku, color: variant.color, size: variant.size } }, ipAddress,
    })

    return { deleted: true, sku: variant.sku }
  }

  async updateVariant(variantId: string, data: {
    priceModifier?: number; barcode?: string;
  }, adminId: string, ipAddress: string) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } })
    if (!variant) throw new NotFoundException('Variant not found')

    const updateData: any = {}
    if (data.priceModifier !== undefined) updateData.priceModifier = data.priceModifier
    // Guard: barcode is invariant-required. If the admin sends an
    // empty string or whitespace, we fall back to SKU (the default).
    // Clearing the field to null is not allowed — the helper enforces
    // it. Sending an explicit EAN overrides SKU as usual.
    if (data.barcode !== undefined) {
      updateData.barcode = ensureVariantBarcode({ sku: variant.sku, barcode: data.barcode })
    }

    const updated = await this.prisma.productVariant.update({ where: { id: variantId }, data: updateData })

    await this.audit.log({
      adminId, action: 'VARIANT_UPDATED', entityType: 'product', entityId: variant.productId,
      changes: { after: updateData }, ipAddress,
    })

    return updated
  }

  // Get existing colors and sizes for a product (for the modals)
  async getProductVariantOptions(productId: string) {
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      select: { color: true, colorHex: true, size: true },
    })

    const colors = new Map<string, string>()
    const sizes = new Set<string>()
    for (const v of variants) {
      if (v.color && v.colorHex) colors.set(v.color, v.colorHex)
      if (v.size) sizes.add(v.size)
    }

    return {
      colors: [...colors.entries()].map(([name, hex]) => ({ name, hex })),
      sizes: [...sizes],
    }
  }

  async updatePrice(productId: string, basePrice: number, salePrice: number | null, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } })
    if (!product) throw new NotFoundException('Product not found')

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { basePrice, salePrice },
    })

    await this.audit.log({
      adminId, action: 'PRODUCT_PRICE_CHANGED', entityType: 'product', entityId: productId,
      changes: { before: { basePrice: Number(product.basePrice), salePrice: product.salePrice ? Number(product.salePrice) : null }, after: { basePrice, salePrice } },
      ipAddress,
    })
    return updated
  }

  async bulkUpdateStatus(productIds: string[], isActive: boolean, adminId: string, ipAddress: string) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, deletedAt: null },
      data: { isActive },
    })
    await this.audit.log({
      adminId, action: isActive ? 'PRODUCTS_ACTIVATED' : 'PRODUCTS_DEACTIVATED',
      entityType: 'product', entityId: productIds.join(','),
      changes: { after: { isActive, count: result.count } }, ipAddress,
    })
    return { updated: result.count }
  }

  async bulkUpdateCategory(
    productIds: string[],
    categoryId: string,
    adminId: string,
    ipAddress: string,
  ) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return { updated: 0 }
    }
    // Validate the target category exists + is active. Fail fast with a
    // clear message rather than silently leaving productIds in an
    // inconsistent state.
    const target = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true, slug: true },
    })
    if (!target) throw new NotFoundException('Target category not found or inactive')

    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, deletedAt: null },
      data: { categoryId },
    })

    await this.audit.log({
      adminId,
      action: 'PRODUCTS_CATEGORY_CHANGED',
      entityType: 'product',
      entityId: productIds.join(','),
      changes: {
        after: {
          categoryId,
          categorySlug: target.slug,
          count: result.count,
        },
      },
      ipAddress,
    })
    return { updated: result.count, categoryId, categorySlug: target.slug }
  }

  async softDelete(productId: string, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { translations: { where: { language: 'de' }, select: { name: true } } },
    })
    if (!product) throw new NotFoundException('Product not found')

    await this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), isActive: false },
    })

    await this.audit.log({
      adminId, action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId,
      changes: { before: { name: product.translations[0]?.name, isActive: product.isActive }, after: { deletedAt: new Date().toISOString() } },
      ipAddress,
    })

    // Fire-and-forget storefront cache invalidation. If the web app's
    // revalidation endpoint is unreachable or not configured, the soft
    // delete still succeeds — the customer just sees the cached page
    // for up to 10 seconds longer (same as the pre-fix behavior).
    this.revalidateStorefront(product.slug).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[softDelete] storefront revalidation failed:', e?.message ?? e)
    })

    return { deleted: true, name: product.translations[0]?.name }
  }

  /**
   * POSTs to the Next.js /api/revalidate endpoint to invalidate cached
   * storefront pages for a product that was just soft-deleted. Non-
   * blocking: any failure here only affects cache freshness, never data
   * integrity — the DB delete has already committed by the time we
   * reach this call.
   *
   * Env vars:
   *   WEB_BASE_URL       — defaults to http://localhost:3000 for dev
   *   REVALIDATE_SECRET  — MUST match the value on the web app
   * If REVALIDATE_SECRET is missing, we silently skip (graceful
   * degradation) so admins don't get 500s during local dev setup.
   */
  private async revalidateStorefront(slug: string): Promise<void> {
    const secret = process.env.REVALIDATE_SECRET
    if (!secret || !slug) return
    const webUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000'
    // Revalidate the PDP page for each locale + the top-level products
    // listing page. Category-filtered listings share the same cache
    // entry shape, so revalidating the base /<locale>/products invalidates
    // all of them.
    const paths: string[] = []
    for (const locale of ['de', 'en', 'ar']) {
      paths.push(`/${locale}/products/${slug}`)
      paths.push(`/${locale}/products`)
    }
    const res = await fetch(`${webUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, secret }),
      // short timeout so a hanging web app never blocks the admin
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[softDelete revalidate] HTTP ${res.status} ${res.statusText}`)
    }
  }

  /**
   * HARD delete a product. Only allowed when:
   *   1. The product is already soft-deleted (deletedAt IS NOT NULL).
   *   2. No order_items reference any of its variants (GoBD: orders
   *      must keep their line items readable forever).
   *   3. No product_reviews, coupons, or promotions reference it
   *      (these columns have NO cascade — they would RESTRICT the
   *      delete at the DB level).
   *
   * If any blocker is found we throw a ConflictException with a
   * 3-lang message + a `blockers` object the frontend uses to render
   * a helpful error modal ("verknüpft mit 3 Bestellungen").
   *
   * On success the DB cascade wipes translations, variants,
   * inventory, stock reservations, product_images, wishlist_items,
   * and channel_product_listings automatically.
   */
  async hardDelete(productId: string, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        translations: { where: { language: 'de' }, select: { name: true } },
        variants: { select: { id: true } },
      },
    })
    if (!product) throw new NotFoundException('Product not found')

    if (!product.deletedAt) {
      // Defense-in-depth: the frontend should not offer the button
      // for non-deleted products, but a direct API call would.
      throw new BadRequestException({
        error: 'ProductMustBeSoftDeletedFirst',
        message: {
          de: 'Produkt muss zuerst in den Papierkorb verschoben werden, bevor es endgültig gelöscht werden kann.',
          en: 'Product must be soft-deleted before it can be permanently removed.',
          ar: 'يجب حذف المنتج أولاً قبل أن يتم حذفه نهائياً.',
        },
      })
    }

    const variantIds = product.variants.map((v) => v.id)

    const [orderItems, reviews, coupons, promotions] = await Promise.all([
      variantIds.length
        ? this.prisma.orderItem.count({ where: { variantId: { in: variantIds } } })
        : Promise.resolve(0),
      this.prisma.productReview.count({ where: { productId } }),
      this.prisma.coupon.count({ where: { appliesToProductId: productId } }),
      this.prisma.promotion.count({ where: { productId } }),
    ])

    if (orderItems > 0 || reviews > 0 || coupons > 0 || promotions > 0) {
      // Build a human-readable list of what is blocking. Only non-zero
      // categories show up in the message so the admin gets a concise
      // reason instead of a wall of zeros.
      const partsDe: string[] = []
      const partsEn: string[] = []
      const partsAr: string[] = []
      if (orderItems > 0) {
        partsDe.push(`${orderItems} Bestellung${orderItems === 1 ? '' : 'en'}`)
        partsEn.push(`${orderItems} order${orderItems === 1 ? '' : 's'}`)
        partsAr.push(`${orderItems} طلب`)
      }
      if (reviews > 0) {
        partsDe.push(`${reviews} Bewertung${reviews === 1 ? '' : 'en'}`)
        partsEn.push(`${reviews} review${reviews === 1 ? '' : 's'}`)
        partsAr.push(`${reviews} تقييم`)
      }
      if (coupons > 0) {
        partsDe.push(`${coupons} Gutschein${coupons === 1 ? '' : 'e'}`)
        partsEn.push(`${coupons} coupon${coupons === 1 ? '' : 's'}`)
        partsAr.push(`${coupons} قسيمة`)
      }
      if (promotions > 0) {
        partsDe.push(`${promotions} Promotion${promotions === 1 ? '' : 'en'}`)
        partsEn.push(`${promotions} promotion${promotions === 1 ? '' : 's'}`)
        partsAr.push(`${promotions} عرض`)
      }
      throw new ConflictException({
        error: 'ProductHasReferences',
        message: {
          de: `Dieses Produkt kann nicht endgültig gelöscht werden — es ist mit ${partsDe.join(', ')} verknüpft.`,
          en: `This product cannot be permanently deleted — it is linked to ${partsEn.join(', ')}.`,
          ar: `لا يمكن حذف هذا المنتج نهائياً — مرتبط بـ ${partsAr.join('، ')}.`,
        },
        blockers: { orderItems, reviews, coupons, promotions },
      })
    }

    const slug = product.slug
    const name = product.translations[0]?.name ?? slug

    // The DB handles cascading to translations / variants / inventory /
    // stock_reservations / product_images / wishlist_items /
    // channel_product_listings via ON DELETE CASCADE on their FKs.
    await this.prisma.product.delete({ where: { id: productId } })

    await this.audit.log({
      adminId,
      action: 'PRODUCT_HARD_DELETED',
      entityType: 'product',
      entityId: productId,
      changes: { before: { name, slug } },
      ipAddress,
    })

    // Fire-and-forget cache invalidation (same pattern as softDelete).
    // The DB row is gone at this point; cache staleness is just a
    // cosmetic issue, not a data-integrity one.
    this.revalidateStorefront(slug).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[hardDelete] storefront revalidation failed:', e?.message ?? e)
    })

    return { hardDeleted: true, name }
  }

  async restore(productId: string, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: { not: null } },
      include: { translations: { where: { language: 'de' }, select: { name: true } } },
    })
    if (!product) throw new NotFoundException('Product not found or not deleted')

    await this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: null },
    })

    await this.audit.log({
      adminId, action: 'PRODUCT_RESTORED', entityType: 'product', entityId: productId,
      changes: { after: { name: product.translations[0]?.name, restored: true } },
      ipAddress,
    })

    return { restored: true, name: product.translations[0]?.name }
  }

  async bulkDelete(productIds: string[], adminId: string, ipAddress: string) {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    await this.audit.log({
      adminId, action: 'PRODUCTS_DELETED', entityType: 'product', entityId: productIds.join(','),
      changes: { after: { deletedCount: result.count } }, ipAddress,
    })
    return { deleted: result.count }
  }

  async duplicate(productId: string, adminId: string, ipAddress: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { translations: true, variants: true, images: true },
    })
    if (!product) throw new NotFoundException('Product not found')

    const slug = `${product.slug}-copy-${Date.now()}`
    const newProduct = await this.prisma.product.create({
      data: {
        slug, categoryId: product.categoryId, brand: product.brand,
        gender: product.gender, basePrice: product.basePrice,
        salePrice: product.salePrice, taxRate: product.taxRate, isActive: false,
        translations: {
          create: product.translations.map((t) => ({
            language: t.language, name: `${t.name} (Kopie)`,
            description: t.description, sizeGuide: t.sizeGuide,
            metaTitle: t.metaTitle, metaDesc: t.metaDesc,
          })),
        },
      },
      include: { translations: true },
    })

    await this.audit.log({
      adminId, action: 'PRODUCT_DUPLICATED', entityType: 'product', entityId: newProduct.id,
      changes: { before: { sourceId: productId }, after: { newId: newProduct.id, slug } }, ipAddress,
    })
    return newProduct
  }

  // ── IMAGE-COLOR ASSIGNMENT ──────────────────────────────────

  async assignImageToColor(imageId: string, colorName: string | null) {
    return this.prisma.productImage.update({ where: { id: imageId }, data: { colorName } })
  }

  async addImageUrl(productId: string, url: string, colorName?: string) {
    const count = await this.prisma.productImage.count({ where: { productId } })
    return this.prisma.productImage.create({
      data: { productId, url, colorName: colorName || null, sortOrder: count, isPrimary: count === 0 },
    })
  }

  async getProductImages(productId: string) {
    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    })
  }

  // ── CHANNEL MANAGEMENT ──────────────────────────────────

  async bulkUpdateChannels(productIds: string[], channel: string, enabled: boolean, adminId: string, ipAddress: string) {
    const fieldMap: Record<string, string> = { facebook: 'channelFacebook', tiktok: 'channelTiktok', google: 'channelGoogle', whatsapp: 'channelWhatsapp' }
    const field = fieldMap[channel]
    if (!field) throw new BadRequestException(`Invalid channel: ${channel}`)
    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, deletedAt: null },
      data: { [field]: enabled },
    })
    await this.audit.log({
      adminId, action: enabled ? 'PRODUCTS_CHANNEL_ENABLED' : 'PRODUCTS_CHANNEL_DISABLED',
      entityType: 'product', entityId: productIds.join(','),
      changes: { after: { channel, enabled, count: result.count } }, ipAddress,
    })
    return { updated: result.count }
  }

  async getChannelStats() {
    const [total, facebook, tiktok, google, whatsapp, ordersByChannel] = await Promise.all([
      this.prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.product.count({ where: { isActive: true, deletedAt: null, channelFacebook: true } }),
      this.prisma.product.count({ where: { isActive: true, deletedAt: null, channelTiktok: true } }),
      this.prisma.product.count({ where: { isActive: true, deletedAt: null, channelGoogle: true } }),
      this.prisma.product.count({ where: { isActive: true, deletedAt: null, channelWhatsapp: true } }),
      this.prisma.order.groupBy({ by: ['channel'], _count: true, where: { deletedAt: null } }),
    ])
    const orders: Record<string, number> = {}
    for (const g of ordersByChannel) orders[g.channel] = g._count
    return {
      total, facebook, tiktok, google, whatsapp, website: total,
      orders: {
        website: orders['website'] ?? 0,
        facebook: orders['facebook'] ?? 0,
        instagram: orders['instagram'] ?? 0,
        tiktok: orders['tiktok'] ?? 0,
      },
    }
  }

  async exportCsv() {
    const result = await this.findAll({ limit: 2000, offset: 0 })
    const header = 'Name (DE);Name (EN);Name (AR);SKU;Kategorie;Preis;Sale-Preis;Varianten;Bestand;Status\n'
    const rows = result.data.map((p: any) => {
      const nameDE = p.translations.find((t: any) => t.language === 'de')?.name ?? ''
      const nameEN = p.translations.find((t: any) => t.language === 'en')?.name ?? ''
      const nameAR = p.translations.find((t: any) => t.language === 'ar')?.name ?? ''
      const cat = (p.category?.translations ?? []).find((t: any) => t.language === 'de')?.name ?? ''
      return `${nameDE};${nameEN};${nameAR};${p.variants[0]?.sku ?? ''};${cat};${p.basePrice};${p.salePrice ?? ''};${p.variantsCount};${p.totalStock};${p.isActive ? 'Aktiv' : 'Inaktiv'}`
    }).join('\n')
    return header + rows
  }
}
