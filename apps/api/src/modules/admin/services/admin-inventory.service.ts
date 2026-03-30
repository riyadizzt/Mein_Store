import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'

@Injectable()
export class AdminInventoryService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── STATS ──────────────────────────────────────────────────

  async getStats(warehouseId?: string) {
    const whId = warehouseId || (await this.prisma.warehouse.findFirst({ where: { isDefault: true } }))?.id

    const allInv = await this.prisma.inventory.findMany({
      where: whId ? { warehouseId: whId } : {},
      include: { variant: { select: { purchasePrice: true, product: { select: { deletedAt: true } } } } },
    })

    const active = allInv.filter((i) => !i.variant.product.deletedAt)
    let totalItems = 0
    let totalUnits = 0
    let lowStock = 0
    let outOfStock = 0
    let warehouseValue = 0

    for (const inv of active) {
      totalItems++
      const avail = inv.quantityOnHand - inv.quantityReserved
      totalUnits += inv.quantityOnHand
      if (avail <= 0) outOfStock++
      else if (avail <= inv.reorderPoint) lowStock++
      if (inv.variant.purchasePrice) {
        warehouseValue += inv.quantityOnHand * Number(inv.variant.purchasePrice)
      }
    }

    return { totalItems, totalUnits, lowStock, outOfStock, warehouseValue }
  }

  // ── LIST ───────────────────────────────────────────────────

  async findAll(query: {
    warehouseId?: string
    search?: string
    categoryId?: string
    parentCategoryId?: string
    status?: string      // all | in_stock | low | out_of_stock
    locationId?: string
    priceMin?: number
    priceMax?: number
    outOfStockOnly?: boolean
    lang?: string
    sortBy?: string      // stock | name | sku | price
    sortDir?: string
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 50, 500)
    const offset = query.offset ?? 0
    const where: any = { variant: { product: { deletedAt: null } } }

    if (query.warehouseId) where.warehouseId = query.warehouseId
    if (query.locationId) where.locationId = query.locationId

    if (query.search) {
      where.variant = {
        ...where.variant,
        OR: [
          { sku: { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
          { product: { deletedAt: null, translations: { some: { name: { contains: query.search, mode: 'insensitive' } } } } },
        ],
      }
    }

    if (query.categoryId || query.parentCategoryId) {
      const catFilter = where.variant?.product ?? { deletedAt: null }
      if (query.categoryId) {
        catFilter.categoryId = query.categoryId
      } else if (query.parentCategoryId) {
        const subcats = await this.prisma.category.findMany({
          where: { parentId: query.parentCategoryId, isActive: true },
          select: { id: true },
        })
        catFilter.categoryId = { in: [query.parentCategoryId, ...subcats.map((c) => c.id)] }
      }
      where.variant = { ...where.variant, product: catFilter }
    }

    // Sorting
    let orderBy: any = { quantityOnHand: 'asc' }
    const dir = query.sortDir === 'desc' ? 'desc' : 'asc'
    if (query.sortBy === 'stock') orderBy = { quantityOnHand: dir }
    else if (query.sortBy === 'sku') orderBy = { variant: { sku: dir } }

    const items = await this.prisma.inventory.findMany({
      where,
      include: {
        variant: {
          select: {
            id: true, sku: true, barcode: true, color: true, colorHex: true,
            size: true, purchasePrice: true, priceModifier: true,
            product: {
              select: {
                id: true, basePrice: true, salePrice: true, categoryId: true,
                translations: { select: { name: true, language: true } },
                images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
                category: { select: { id: true, parentId: true, translations: { select: { name: true, language: true } } } },
              },
            },
          },
        },
        warehouse: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy,
      take: limit + 200, // fetch more for post-filter
      skip: 0,
    })

    // Post-filter by status
    let filtered = items
    if (query.status === 'out_of_stock') {
      filtered = items.filter((i) => i.quantityOnHand - i.quantityReserved <= 0)
    } else if (query.status === 'low') {
      filtered = items.filter((i) => {
        const avail = i.quantityOnHand - i.quantityReserved
        return avail > 0 && avail <= i.reorderPoint
      })
    } else if (query.status === 'in_stock') {
      filtered = items.filter((i) => i.quantityOnHand - i.quantityReserved > i.reorderPoint)
    }

    if (query.outOfStockOnly) {
      filtered = filtered.filter((i) => i.quantityOnHand - i.quantityReserved <= 0)
    }

    // Price filter (on sale price)
    if (query.priceMin != null || query.priceMax != null) {
      filtered = filtered.filter((i) => {
        const price = Number(i.variant.product.salePrice ?? i.variant.product.basePrice)
        if (query.priceMin != null && price < query.priceMin) return false
        if (query.priceMax != null && price > query.priceMax) return false
        return true
      })
    }

    const total = filtered.length
    const paged = filtered.slice(offset, offset + limit)

    // Get last movement date for each
    const variantIds = paged.map((p) => p.variantId)
    const lastMovements = variantIds.length > 0 ? await this.prisma.inventoryMovement.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds } },
      _max: { createdAt: true },
    }) : []
    const lastMoveMap = new Map(lastMovements.map((m) => [m.variantId, m._max.createdAt]))

    return {
      data: paged.map((inv) => ({
        id: inv.id,
        variantId: inv.variantId,
        warehouseId: inv.warehouseId,
        warehouse: inv.warehouse,
        location: inv.location,
        quantityOnHand: inv.quantityOnHand,
        quantityReserved: inv.quantityReserved,
        available: inv.quantityOnHand - inv.quantityReserved,
        reorderPoint: inv.reorderPoint,
        maxStock: inv.maxStock,
        sku: inv.variant.sku,
        barcode: inv.variant.barcode,
        color: inv.variant.color,
        colorHex: inv.variant.colorHex,
        size: inv.variant.size,
        purchasePrice: inv.variant.purchasePrice ? Number(inv.variant.purchasePrice) : null,
        salePrice: Number(inv.variant.product.salePrice ?? inv.variant.product.basePrice),
        productId: inv.variant.product.id,
        productName: inv.variant.product.translations,
        image: inv.variant.product.images[0]?.url ?? null,
        category: inv.variant.product.category,
        lastMovement: lastMoveMap.get(inv.variantId) ?? null,
        status: (inv.quantityOnHand - inv.quantityReserved) <= 0 ? 'out_of_stock'
          : (inv.quantityOnHand - inv.quantityReserved) <= inv.reorderPoint ? 'low' : 'in_stock',
      })),
      meta: { total, limit, offset },
    }
  }

  // ── GROUPED BY PRODUCT ──────────────────────────────────────

  async findAllGrouped(query: {
    warehouseId?: string
    search?: string
    parentCategoryId?: string
    status?: string
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 50, 200)
    const offset = query.offset ?? 0
    const where: any = { deletedAt: null }

    if (query.search) {
      where.OR = [
        { slug: { contains: query.search, mode: 'insensitive' } },
        { translations: { some: { name: { contains: query.search, mode: 'insensitive' } } } },
        { variants: { some: { OR: [{ sku: { contains: query.search, mode: 'insensitive' } }, { barcode: { contains: query.search, mode: 'insensitive' } }] } } },
      ]
    }

    if (query.parentCategoryId) {
      const subcats = await this.prisma.category.findMany({ where: { parentId: query.parentCategoryId }, select: { id: true } })
      where.categoryId = { in: [query.parentCategoryId, ...subcats.map((c) => c.id)] }
    }

    const whFilter = query.warehouseId ? { warehouseId: query.warehouseId } : {}

    // If warehouse filter, only load products that HAVE inventory in this warehouse
    if (query.warehouseId) {
      where.variants = { some: { inventory: { some: { warehouseId: query.warehouseId } } } }
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          translations: { select: { name: true, language: true } },
          images: { select: { url: true, isPrimary: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          category: { select: { translations: { select: { name: true, language: true } } } },
          variants: {
            where: { isActive: true },
            select: {
              id: true, sku: true, barcode: true, color: true, colorHex: true, size: true,
              purchasePrice: true,
              inventory: {
                where: whFilter,
                select: { id: true, quantityOnHand: true, quantityReserved: true, reorderPoint: true, maxStock: true, location: { select: { name: true } }, warehouse: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.product.count({ where }),
    ])

    let result = products.map((p) => {
      let totalStock = 0, totalReserved = 0, lowCount = 0, outCount = 0
      const variants = p.variants.map((v) => {
        let vStock = 0, vReserved = 0, vReorder = 5
        const invs = v.inventory.map((inv) => {
          vStock += inv.quantityOnHand
          vReserved += inv.quantityReserved
          vReorder = inv.reorderPoint
          totalStock += inv.quantityOnHand
          totalReserved += inv.quantityReserved
          return inv
        })
        const avail = vStock - vReserved
        // Only count variants that actually have inventory records
        if (v.inventory.length > 0) {
          if (avail <= 0) outCount++
          else if (avail <= vReorder) lowCount++
        }
        return { id: v.id, sku: v.sku, barcode: v.barcode, color: v.color, colorHex: v.colorHex, size: v.size, stock: avail, inventory: invs }
      })

      const avail = totalStock - totalReserved
      const status = avail <= 0 ? 'out_of_stock' : (lowCount > 0 || outCount > 0) ? 'low' : 'in_stock'

      return {
        productId: p.id,
        translations: p.translations,
        image: p.images.find((i) => i.isPrimary)?.url ?? p.images[0]?.url ?? null,
        category: p.category,
        totalStock: avail,
        totalStockRaw: totalStock,
        lowCount, outCount,
        status,
        variantsCount: p.variants.length,
        variants,
      }
    })

    // If warehouse filter active, hide products with no inventory in that warehouse
    if (query.warehouseId) {
      result = result.filter((p) => p.variants.some((v: any) => v.inventory.length > 0))
    }

    // Post-filter by stock status
    if (query.status === 'out_of_stock') result = result.filter((p) => p.status === 'out_of_stock')
    else if (query.status === 'low') result = result.filter((p) => p.status === 'low' || p.status === 'out_of_stock')
    else if (query.status === 'in_stock') result = result.filter((p) => p.status === 'in_stock')

    const filteredTotal = (query.warehouseId || query.status) ? result.length : total
    return { data: result, meta: { total: filteredTotal, limit, offset } }
  }

  // ── DEPARTMENT SUMMARY ─────────────────────────────────────

  async getDepartmentSummary(warehouseId?: string) {
    const departments = await this.prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: {
        translations: { select: { name: true, language: true } },
        children: { where: { isActive: true }, select: { id: true, translations: { select: { name: true, language: true } } } },
      },
      orderBy: { sortOrder: 'asc' },
    })

    const result = []
    for (const dept of departments) {
      const allCatIds = [dept.id, ...dept.children.map((c) => c.id)]
      const invWhere: any = { variant: { product: { categoryId: { in: allCatIds }, deletedAt: null } } }
      if (warehouseId) invWhere.warehouseId = warehouseId
      const inventory = await this.prisma.inventory.findMany({
        where: invWhere,
        select: { quantityOnHand: true, quantityReserved: true, reorderPoint: true },
      })
      let total = 0, low = 0, critical = 0
      for (const inv of inventory) {
        total++
        const avail = inv.quantityOnHand - inv.quantityReserved
        if (avail <= 0) critical++
        else if (avail <= inv.reorderPoint) low++
      }
      result.push({ id: dept.id, slug: dept.slug, translations: dept.translations, children: dept.children, total, low, critical })
    }
    return result
  }

  // ── BARCODE LOOKUP ─────────────────────────────────────────

  async lookupBarcode(barcode: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { OR: [{ barcode }, { sku: barcode }] },
      include: {
        product: {
          select: {
            id: true, basePrice: true, salePrice: true,
            translations: { select: { name: true, language: true } },
            images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
        inventory: {
          include: { warehouse: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        },
      },
    })
    if (!variant) throw new NotFoundException({ statusCode: 404, error: 'BarcodeNotFound',
      message: { de: `Barcode "${barcode}" nicht gefunden.`, en: `Barcode "${barcode}" not found.`, ar: `لم يتم العثور على الباركود "${barcode}".` } })

    return {
      variantId: variant.id, sku: variant.sku, barcode: variant.barcode,
      color: variant.color, size: variant.size,
      productName: variant.product.translations,
      image: variant.product.images[0]?.url ?? null,
      price: Number(variant.product.salePrice ?? variant.product.basePrice),
      inventory: variant.inventory.map((inv) => ({
        id: inv.id, warehouseId: inv.warehouseId, warehouse: inv.warehouse.name,
        location: inv.location?.name ?? null, quantityOnHand: inv.quantityOnHand,
        quantityReserved: inv.quantityReserved, available: inv.quantityOnHand - inv.quantityReserved,
        reorderPoint: inv.reorderPoint,
      })),
    }
  }

  // ── STOCK ADJUST ───────────────────────────────────────────

  async adjustStock(inventoryId: string, newQuantity: number, reason: string, adminId: string, ipAddress: string) {
    const inventory = await this.prisma.inventory.findUnique({ where: { id: inventoryId } })
    if (!inventory) throw new NotFoundException('Inventory record not found')

    const diff = newQuantity - inventory.quantityOnHand
    await this.prisma.$transaction([
      this.prisma.inventory.update({ where: { id: inventoryId }, data: { quantityOnHand: newQuantity } }),
      this.prisma.inventoryMovement.create({
        data: {
          variantId: inventory.variantId, warehouseId: inventory.warehouseId,
          type: 'stocktake_adjustment', quantity: diff,
          quantityBefore: inventory.quantityOnHand, quantityAfter: newQuantity,
          notes: reason || null, createdBy: adminId,
        },
      }),
    ])
    await this.audit.log({ adminId, action: 'INVENTORY_ADJUSTED', entityType: 'inventory', entityId: inventoryId,
      changes: { before: { qty: inventory.quantityOnHand }, after: { qty: newQuantity, diff, reason } }, ipAddress })
    return { inventoryId, before: inventory.quantityOnHand, after: newQuantity, diff }
  }

  // ── STOCK INTAKE (Wareneingang) ────────────────────────────

  async intake(items: { inventoryId: string; quantity: number }[], reason: string, adminId: string, ipAddress: string) {
    const type = reason === 'return' ? 'return_received' : 'purchase_received'
    const results: any[] = []

    for (const item of items) {
      const inv = await this.prisma.inventory.findUnique({ where: { id: item.inventoryId } })
      if (!inv) continue

      const newQty = inv.quantityOnHand + item.quantity
      await this.prisma.$transaction([
        this.prisma.inventory.update({ where: { id: item.inventoryId }, data: { quantityOnHand: newQty } }),
        this.prisma.inventoryMovement.create({
          data: {
            variantId: inv.variantId, warehouseId: inv.warehouseId,
            type: type as any, quantity: item.quantity,
            quantityBefore: inv.quantityOnHand, quantityAfter: newQty,
            notes: reason, createdBy: adminId,
          },
        }),
      ])
      results.push({ inventoryId: item.inventoryId, before: inv.quantityOnHand, after: newQty, added: item.quantity })
    }

    await this.audit.log({ adminId, action: 'INVENTORY_INTAKE', entityType: 'inventory',
      changes: { after: { items: results.length, type, reason } }, ipAddress })
    return { processed: results.length, items: results }
  }

  // ── INTAKE BY SKU (CSV Import) ──────────────────────────────

  async intakeBySku(items: { sku: string; quantity: number }[], reason: string, adminId: string, ipAddress: string, warehouseId?: string) {
    const results: any[] = []
    const errors: any[] = []

    // Resolve warehouse — use provided or default
    let whId = warehouseId
    if (!whId) {
      const defaultWh = await this.prisma.warehouse.findFirst({ where: { isDefault: true } })
      whId = defaultWh?.id
    }

    for (const item of items) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { OR: [{ sku: item.sku }, { barcode: item.sku }] },
        select: { id: true, sku: true, inventory: { where: whId ? { warehouseId: whId } : {}, select: { id: true }, take: 1 } },
      })
      if (!variant) { errors.push({ sku: item.sku, error: 'not_found' }); continue }

      // If no inventory record exists for this warehouse, create one
      let invId = variant.inventory[0]?.id
      if (!invId && whId) {
        const newInv = await this.prisma.inventory.create({ data: { variantId: variant.id, warehouseId: whId, quantityOnHand: 0 } })
        invId = newInv.id
      }
      if (!invId) { errors.push({ sku: item.sku, error: 'no_inventory' }); continue }

      const inv = await this.prisma.inventory.findUnique({ where: { id: invId } })
      if (!inv) { errors.push({ sku: item.sku, error: 'no_inventory' }); continue }

      const newQty = inv.quantityOnHand + item.quantity
      await this.prisma.$transaction([
        this.prisma.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: newQty } }),
        this.prisma.inventoryMovement.create({
          data: {
            variantId: inv.variantId, warehouseId: inv.warehouseId,
            type: 'purchase_received', quantity: item.quantity,
            quantityBefore: inv.quantityOnHand, quantityAfter: newQty,
            notes: reason || 'CSV Import', createdBy: adminId,
          },
        }),
      ])
      results.push({ sku: item.sku, before: inv.quantityOnHand, after: newQty, added: item.quantity })
    }

    await this.audit.log({ adminId, action: 'INVENTORY_CSV_INTAKE', entityType: 'inventory',
      changes: { after: { processed: results.length, errors: errors.length, reason } }, ipAddress })
    return { processed: results.length, errors, items: results }
  }

  // ── STOCK OUTPUT (Warenausgang) ────────────────────────────

  async output(inventoryId: string, quantity: number, reason: string, adminId: string, ipAddress: string) {
    const inv = await this.prisma.inventory.findUnique({ where: { id: inventoryId } })
    if (!inv) throw new NotFoundException('Inventory not found')

    const avail = inv.quantityOnHand - inv.quantityReserved
    if (quantity > avail) {
      throw new BadRequestException({ statusCode: 400, error: 'InsufficientStock',
        message: { de: `Nur ${avail} verfügbar.`, en: `Only ${avail} available.`, ar: `فقط ${avail} متاح.` } })
    }

    const newQty = inv.quantityOnHand - quantity
    const typeMap: Record<string, string> = { sale: 'sale_pos', damaged: 'damaged', loss: 'damaged', gift: 'damaged', sample: 'damaged' }
    await this.prisma.$transaction([
      this.prisma.inventory.update({ where: { id: inventoryId }, data: { quantityOnHand: newQty } }),
      this.prisma.inventoryMovement.create({
        data: {
          variantId: inv.variantId, warehouseId: inv.warehouseId,
          type: (typeMap[reason] ?? 'sale_pos') as any, quantity: -quantity,
          quantityBefore: inv.quantityOnHand, quantityAfter: newQty,
          notes: reason, createdBy: adminId,
        },
      }),
    ])

    const warning = newQty <= 0 ? 'last_item' : newQty <= inv.reorderPoint ? 'reorder' : null
    await this.audit.log({ adminId, action: 'INVENTORY_OUTPUT', entityType: 'inventory', entityId: inventoryId,
      changes: { after: { quantity: -quantity, reason, newQty } }, ipAddress })
    return { inventoryId, before: inv.quantityOnHand, after: newQty, removed: quantity, warning }
  }

  // ── TRANSFER ───────────────────────────────────────────────

  async transfer(fromInventoryId: string, toWarehouseId: string, quantity: number, adminId: string, ipAddress: string) {
    const source = await this.prisma.inventory.findUnique({ where: { id: fromInventoryId } })
    if (!source) throw new NotFoundException('Source inventory not found')

    const available = source.quantityOnHand - source.quantityReserved
    if (quantity > available) {
      throw new BadRequestException({ statusCode: 400, error: 'InsufficientStock',
        message: { de: `Nur ${available} verfügbar.`, en: `Only ${available} available.`, ar: `فقط ${available} متاح.` } })
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({ where: { id: fromInventoryId }, data: { quantityOnHand: { decrement: quantity } } })
      await tx.inventory.upsert({
        where: { variantId_warehouseId: { variantId: source.variantId, warehouseId: toWarehouseId } },
        create: { variantId: source.variantId, warehouseId: toWarehouseId, quantityOnHand: quantity },
        update: { quantityOnHand: { increment: quantity } },
      })
      await tx.inventoryMovement.createMany({ data: [
        { variantId: source.variantId, warehouseId: source.warehouseId, type: 'transfer', quantity: -quantity, quantityBefore: source.quantityOnHand, quantityAfter: source.quantityOnHand - quantity, referenceId: toWarehouseId, notes: `Transfer out`, createdBy: adminId },
        { variantId: source.variantId, warehouseId: toWarehouseId, type: 'transfer', quantity, referenceId: source.warehouseId, notes: `Transfer in`, createdBy: adminId },
      ] })
    })

    await this.audit.log({ adminId, action: 'INVENTORY_TRANSFERRED', entityType: 'inventory', entityId: fromInventoryId,
      changes: { after: { from: source.warehouseId, to: toWarehouseId, quantity } }, ipAddress })
    return { transferred: quantity }
  }

  // ── BULK ADJUST ────────────────────────────────────────────

  async bulkAdjust(items: { inventoryId: string; quantity: number }[], reason: string, adminId: string, ipAddress: string) {
    const results: any[] = []
    for (const item of items) {
      try {
        const r = await this.adjustStock(item.inventoryId, item.quantity, reason, adminId, ipAddress)
        results.push(r)
      } catch { /* skip failed */ }
    }
    return { processed: results.length, items: results }
  }

  async bulkSetMinStock(inventoryIds: string[], reorderPoint: number) {
    await this.prisma.inventory.updateMany({ where: { id: { in: inventoryIds } }, data: { reorderPoint } })
    return { updated: inventoryIds.length }
  }

  async bulkSetLocation(inventoryIds: string[], locationId: string) {
    await this.prisma.inventory.updateMany({ where: { id: { in: inventoryIds } }, data: { locationId } })
    return { updated: inventoryIds.length }
  }

  // ── HISTORY ────────────────────────────────────────────────

  async getHistory(variantId: string, warehouseId: string, limit = 50) {
    return this.prisma.inventoryMovement.findMany({
      where: { variantId, warehouseId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async getMovementLog(query: { warehouseId?: string; type?: string; search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(query.limit ?? 50, 200)
    const offset = query.offset ?? 0
    const where: any = {}

    if (query.warehouseId) where.warehouseId = query.warehouseId
    if (query.type) where.type = query.type
    if (query.search) {
      where.OR = [
        { notes: { contains: query.search, mode: 'insensitive' } },
        { referenceId: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const [movements, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ])

    // Enrich with variant + warehouse info
    const variantIds = [...new Set(movements.map((m) => m.variantId))]
    const warehouseIds = [...new Set(movements.map((m) => m.warehouseId))]

    const [variants, warehouses] = await Promise.all([
      variantIds.length > 0 ? this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sku: true, color: true, size: true, product: { select: { translations: { select: { name: true, language: true } } } } },
      }) : [],
      warehouseIds.length > 0 ? this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, type: true },
      }) : [],
    ])

    const variantMap = new Map(variants.map((v) => [v.id, v]))
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]))

    return {
      data: movements.map((m) => {
        const v = variantMap.get(m.variantId)
        const w = warehouseMap.get(m.warehouseId)
        return {
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          quantityBefore: m.quantityBefore,
          quantityAfter: m.quantityAfter,
          notes: m.notes,
          createdBy: m.createdBy,
          createdAt: m.createdAt,
          sku: v?.sku,
          color: v?.color,
          size: v?.size,
          productName: v?.product?.translations,
          warehouseName: w?.name,
          warehouseType: w?.type,
        }
      }),
      meta: { total, limit, offset },
    }
  }

  // ── CSV EXPORT ─────────────────────────────────────────────

  async exportCsv(query: { warehouseId?: string; categoryId?: string; status?: string }) {
    const result = await this.findAll({ ...query, limit: 5000, offset: 0 })
    const header = 'SKU;Barcode;Produkt;Farbe;Größe;Kategorie;Bestand;Reserviert;Verfügbar;Min-Bestand;Max-Bestand;Einkaufspreis;Verkaufspreis;Lager;Lagerort;Status\n'
    const rows = result.data.map((i: any) => {
      const name = (i.productName ?? []).find((t: any) => t.language === 'de')?.name ?? ''
      const cat = (i.category?.translations ?? []).find((t: any) => t.language === 'de')?.name ?? ''
      return `${i.sku};${i.barcode ?? ''};${name};${i.color ?? ''};${i.size ?? ''};${cat};${i.quantityOnHand};${i.quantityReserved};${i.available};${i.reorderPoint};${i.maxStock};${i.purchasePrice ?? ''};${i.salePrice};${i.warehouse?.name ?? ''};${i.location?.name ?? ''};${i.status}`
    }).join('\n')
    return header + rows
  }

  // ── LOCATIONS ──────────────────────────────────────────────

  async getLocations(warehouseId?: string) {
    const where: any = {}
    if (warehouseId) where.warehouseId = warehouseId
    return this.prisma.inventoryLocation.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true } }, _count: { select: { inventory: true } } },
      orderBy: [{ warehouseId: 'asc' }, { sortOrder: 'asc' }],
    })
  }

  async createLocation(data: { warehouseId: string; name: string; description?: string }, _adminId: string) {
    return this.prisma.inventoryLocation.create({ data: { warehouseId: data.warehouseId, name: data.name, description: data.description } })
  }

  async updateLocation(id: string, data: { name?: string; description?: string }) {
    return this.prisma.inventoryLocation.update({ where: { id }, data })
  }

  async deleteLocation(id: string) {
    // Unlink inventory first
    await this.prisma.inventory.updateMany({ where: { locationId: id }, data: { locationId: null } })
    await this.prisma.inventoryLocation.delete({ where: { id } })
    return { deleted: true }
  }

  // ── STOCKTAKE ──────────────────────────────────────────────

  async startStocktake(warehouseId: string, categoryId: string | null, adminId: string) {
    const where: any = { variant: { product: { deletedAt: null } } }
    if (warehouseId) where.warehouseId = warehouseId
    if (categoryId) {
      const subcats = await this.prisma.category.findMany({ where: { parentId: categoryId }, select: { id: true } })
      where.variant.product.categoryId = { in: [categoryId, ...subcats.map((c) => c.id)] }
    }

    const inventory = await this.prisma.inventory.findMany({
      where,
      select: { variantId: true, quantityOnHand: true },
    })

    const stocktake = await this.prisma.stocktake.create({
      data: {
        warehouseId, categoryId, adminId, status: 'in_progress',
        items: { create: inventory.map((inv) => ({ variantId: inv.variantId, expectedQty: inv.quantityOnHand })) },
      },
      include: { items: true },
    })

    return stocktake
  }

  async getStocktakes(limit = 20) {
    return this.prisma.stocktake.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async getStocktake(id: string) {
    const st = await this.prisma.stocktake.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            stocktake: false,
          },
        },
      },
    })
    if (!st) throw new NotFoundException('Stocktake not found')

    // Get variant info
    const variantIds = st.items.map((i) => i.variantId)
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true, sku: true, barcode: true, color: true, size: true,
        product: { select: { translations: { select: { name: true, language: true } }, images: { select: { url: true }, take: 1 } } },
      },
    })
    const variantMap = new Map(variants.map((v) => [v.id, v]))

    return {
      ...st,
      items: st.items.map((item) => {
        const v = variantMap.get(item.variantId)
        return { ...item, variant: v }
      }),
    }
  }

  async updateStocktakeItem(itemId: string, actualQty: number) {
    const item = await this.prisma.stocktakeItem.findUnique({ where: { id: itemId } })
    if (!item) throw new NotFoundException('Item not found')

    return this.prisma.stocktakeItem.update({
      where: { id: itemId },
      data: { actualQty, difference: actualQty - item.expectedQty },
    })
  }

  async completeStocktake(stocktakeId: string, applyChanges: boolean, adminId: string, ipAddress: string) {
    const st = await this.prisma.stocktake.findUnique({
      where: { id: stocktakeId },
      include: { items: { where: { actualQty: { not: null } } } },
    })
    if (!st) throw new NotFoundException('Stocktake not found')

    if (applyChanges) {
      for (const item of st.items) {
        if (item.difference && item.difference !== 0) {
          const inv = await this.prisma.inventory.findFirst({
            where: { variantId: item.variantId, warehouseId: st.warehouseId },
          })
          if (inv) {
            await this.adjustStock(inv.id, item.actualQty!, `Inventur #${stocktakeId.slice(-6)}`, adminId, ipAddress)
          }
        }
      }
    }

    return this.prisma.stocktake.update({
      where: { id: stocktakeId },
      data: { status: 'completed', completedAt: new Date() },
    })
  }

  // ── INLINE EDIT ────────────────────────────────────────────

  async quickAdjust(inventoryId: string, delta: number, adminId: string, ipAddress: string) {
    const inv = await this.prisma.inventory.findUnique({ where: { id: inventoryId } })
    if (!inv) throw new NotFoundException('Not found')

    const newQty = Math.max(0, inv.quantityOnHand + delta)
    return this.adjustStock(inventoryId, newQty, delta > 0 ? 'Quick add' : 'Quick remove', adminId, ipAddress)
  }

  async updateMinMax(inventoryId: string, reorderPoint?: number, maxStock?: number) {
    const data: any = {}
    if (reorderPoint !== undefined) data.reorderPoint = reorderPoint
    if (maxStock !== undefined) data.maxStock = maxStock
    return this.prisma.inventory.update({ where: { id: inventoryId }, data })
  }
}
