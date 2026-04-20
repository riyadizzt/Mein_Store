import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service'
import { buildInventoryRestockPayload } from '../../webhooks/payload-builders/inventory'

@Injectable()
export class AdminInventoryService {
  private readonly logger = new Logger(AdminInventoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Optional so unit tests without the webhook module still resolve.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
  ) {}

  /**
   * Fire-and-forget outbound restock webhook.
   * Never awaited, never throws — failures logged only.
   * Shared by intake() and intakeBySku() to keep the emit shape consistent.
   */
  private emitRestockWebhook(params: {
    variantId: string
    warehouseId: string
    delta: number
    newQuantity: number
    source: 'intake' | 'manual_correction' | 'return'
    supplierId?: string | null
  }): void {
    if (!this.webhookDispatcher) return
    buildInventoryRestockPayload(this.prisma, params)
      .then((payload) =>
        payload ? this.webhookDispatcher!.emit('inventory.restock', payload) : undefined,
      )
      .catch((err) =>
        this.logger.warn(`inventory.restock webhook failed: ${err?.message ?? err}`),
      )
  }

  // ── STATS ──────────────────────────────────────────────────
  //
  // Scope contract:
  //   - no warehouseId  → GLOBAL across all warehouses (sum of all stock)
  //   - with warehouseId → scoped to that single warehouse
  //
  // Previously fell back to the default warehouse when no ID was passed —
  // that silently hid stock in non-default warehouses (reported as "4950
  // total" while 163 units sat in Pannierstr Shop, confusing the admin).
  // The UI now shows a "scope" label next to each KPI so the admin can
  // always tell whether a number is warehouse-scoped or global.

  async getStats(warehouseId?: string) {
    const allInv = await this.prisma.inventory.findMany({
      where: warehouseId ? { warehouseId } : {},
      include: { variant: { select: { product: { select: { deletedAt: true } } } } },
    })

    const active = allInv.filter((i) => !i.variant.product.deletedAt)
    let totalItems = 0
    let totalUnits = 0
    let lowStock = 0
    let outOfStock = 0

    for (const inv of active) {
      totalItems++
      const avail = inv.quantityOnHand - inv.quantityReserved
      totalUnits += inv.quantityOnHand
      if (avail <= 0) outOfStock++
      else if (avail <= inv.reorderPoint) lowStock++
    }

    // Resolve warehouse name for display context — only fire this query
    // when actually filtering (the global case doesn't need it).
    const warehouseName = warehouseId
      ? (await this.prisma.warehouse.findUnique({
          where: { id: warehouseId },
          select: { name: true },
        }))?.name ?? null
      : null

    return {
      totalItems,
      totalUnits,
      lowStock,
      outOfStock,
      scope: warehouseId ? ('warehouse' as const) : ('global' as const),
      warehouseName,
    }
  }

  // ── RESERVATIONS (read-only view) ─────────────────────────
  //
  // Pure SELECT view on StockReservation. Zero writes. Zero side effects.
  // Joins variant+product+translations+warehouse for display, and fetches
  // the linked order (orderNumber + customer) in a second batched query
  // because StockReservation.orderId is a plain String (no FK relation).
  //
  // Used by /admin/inventory/reservations page and the inventory badge.
  async listReservations(query: {
    status?: 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'all'
    warehouseId?: string
    variantId?: string
    search?: string   // matches SKU or order number
    limit?: number
    offset?: number
  }) {
    const take = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const skip = Math.max(query.offset ?? 0, 0)
    const status = query.status && query.status !== 'all' ? query.status : 'RESERVED'

    const where: any = { status }
    if (query.warehouseId) where.warehouseId = query.warehouseId
    if (query.variantId) where.variantId = query.variantId

    if (query.search?.trim()) {
      const s = query.search.trim()
      where.OR = [
        { variant: { sku: { contains: s, mode: 'insensitive' } } },
        // orderId is a plain string — we filter it after the fact against
        // the resolved orderNumbers, so no direct Prisma filter here.
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.stockReservation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take,
        skip,
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              size: true,
              color: true,
              product: {
                select: {
                  id: true,
                  deletedAt: true,
                  translations: { select: { language: true, name: true } },
                  images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
                },
              },
            },
          },
          warehouse: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.stockReservation.count({ where }),
    ])

    // Resolve orderId → {orderNumber, customer} in a single batched query
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))]
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            guestEmail: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        })
      : []
    const orderMap = new Map(orders.map((o) => [o.id, o]))

    return {
      data: rows.map((r) => {
        const order = r.orderId ? orderMap.get(r.orderId) ?? null : null
        const customerName = order
          ? [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ').trim() || order.user?.email || order.guestEmail || null
          : null
        return {
          id: r.id,
          quantity: r.quantity,
          status: r.status,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          variant: {
            id: r.variant.id,
            sku: r.variant.sku,
            barcode: r.variant.barcode,
            size: r.variant.size,
            color: r.variant.color,
            productId: r.variant.product.id,
            productDeleted: !!r.variant.product.deletedAt,
            productTranslations: r.variant.product.translations,
            productImage: r.variant.product.images[0]?.url ?? null,
          },
          warehouse: r.warehouse,
          order: order
            ? {
                id: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                customerName,
              }
            : null,
        }
      }),
      meta: { total, limit: take, offset: skip },
    }
  }

  // Count of active (RESERVED) reservations per variant. Used by the
  // inventory grouped-view badge. One query, grouped aggregate, no joins.
  async countActiveReservationsByVariant(variantIds: string[]) {
    if (variantIds.length === 0) return new Map<string, number>()
    const grouped = await this.prisma.stockReservation.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds }, status: 'RESERVED' },
      _sum: { quantity: true },
    })
    return new Map(grouped.map((g) => [g.variantId, g._sum.quantity ?? 0]))
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
            size: true, priceModifier: true,
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
    locationId?: string
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

    // Inventory filter applied to both the product-level "has inventory" check AND the nested inventory select
    const whFilter: any = {}
    if (query.warehouseId) whFilter.warehouseId = query.warehouseId
    if (query.locationId) whFilter.locationId = query.locationId

    // Only load products that HAVE matching inventory (warehouse + location)
    if (query.warehouseId || query.locationId) {
      where.variants = { some: { inventory: { some: whFilter } } }
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
              inventory: {
                where: whFilter,
                select: { id: true, warehouseId: true, quantityOnHand: true, quantityReserved: true, reorderPoint: true, maxStock: true, location: { select: { name: true } }, warehouse: { select: { name: true } } },
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
      // variantsOutInAnyWh counts variants that have at least ONE warehouse
      // row with stock=0, regardless of the variant's cross-warehouse sum.
      // Used by the "out_of_stock" filter so selecting "all warehouses" +
      // "out of stock" matches the stats-KPI semantic ("X rows at zero")
      // instead of the stricter "aggregate = 0 everywhere" rule (which
      // hid every split-stock case like MAL-HERREN-GEL-M where Pannierstr
      // is empty but Marzahn still has some).
      let variantsOutInAnyWh = 0
      const variants = p.variants.map((v) => {
        let vStock = 0, vReserved = 0
        // Per-warehouse low/out evaluation — a variant is "low" if ANY of
        // its warehouse rows is low, not if the sum across all warehouses
        // is low. Old bug: summing 5+5 = 10 vs reorderPoint 5 → passed check
        // even though BOTH warehouses individually were at their reorder
        // threshold. Matches getStats() semantics (which counts per row).
        let vIsLow = false
        let vIsOut = false
        const invs = v.inventory.map((inv) => {
          vStock += inv.quantityOnHand
          vReserved += inv.quantityReserved
          totalStock += inv.quantityOnHand
          totalReserved += inv.quantityReserved
          const whAvail = inv.quantityOnHand - inv.quantityReserved
          if (whAvail <= 0) vIsOut = true
          else if (inv.reorderPoint > 0 && whAvail <= inv.reorderPoint) vIsLow = true
          return inv
        })
        const avail = vStock - vReserved
        // Only count variants that actually have inventory records
        if (v.inventory.length > 0) {
          if (vIsOut) variantsOutInAnyWh++
          if (vIsOut && avail <= 0) outCount++
          else if (vIsLow) lowCount++
        }
        return { id: v.id, sku: v.sku, barcode: v.barcode, color: v.color, colorHex: v.colorHex, size: v.size, stock: avail, price: Number(p.salePrice ?? p.basePrice ?? 0), inventory: invs }
      })

      const avail = totalStock - totalReserved
      // Product-level status: "out_of_stock" only when the aggregate is zero
      // (no warehouse has anything). "low" fires as soon as ANY variant is
      // low in ANY warehouse — so the orange badge surfaces reorder needs
      // even when another warehouse masks them in the sum.
      const status = avail <= 0 ? 'out_of_stock' : (lowCount > 0 || outCount > 0) ? 'low' : 'in_stock'

      return {
        productId: p.id,
        translations: p.translations,
        image: p.images.find((i) => i.isPrimary)?.url ?? p.images[0]?.url ?? null,
        category: p.category,
        totalStock: avail,
        totalStockRaw: totalStock,
        lowCount, outCount,
        outInAnyWarehouse: variantsOutInAnyWh > 0,
        status,
        variantsCount: p.variants.length,
        variants,
      }
    })

    // Batch-fetch box assignments for all variants so the frontend can show
    // ALL box numbers (not just the single locationId on the inventory row).
    // This handles variants that are split across multiple boxes.
    const allVariantIds = result.flatMap((p) => p.variants.map((v: any) => v.id))
    if (allVariantIds.length > 0) {
      const boxItems = await this.prisma.boxItem.findMany({
        where: { variantId: { in: allVariantIds } },
        select: { variantId: true, boxId: true, quantity: true },
      })
      if (boxItems.length > 0) {
        const boxIds = [...new Set(boxItems.map((bi) => bi.boxId))]
        const manifests = await this.prisma.boxManifest.findMany({
          where: { id: { in: boxIds } },
          select: { id: true, boxNumber: true, status: true, warehouseId: true },
        })
        const manifestMap = new Map(manifests.map((m) => [m.id, m]))

        // Build (variantId + warehouseId) → [{boxNumber, qty, status}]
        // Keyed by variant+warehouse so the frontend shows badges only on
        // the correct warehouse row (not on every row for this variant).
        const variantWhBoxes = new Map<string, Array<{ boxNumber: string; qty: number; status: string }>>()
        for (const bi of boxItems) {
          const m = manifestMap.get(bi.boxId)
          if (!m) continue
          const key = `${bi.variantId}::${m.warehouseId}`
          if (!variantWhBoxes.has(key)) variantWhBoxes.set(key, [])
          variantWhBoxes.get(key)!.push({ boxNumber: m.boxNumber, qty: bi.quantity, status: m.status })
        }

        // Attach boxes per inventory row (variant + warehouse)
        for (const p of result) {
          for (const v of p.variants as any[]) {
            for (const inv of v.inventory as any[]) {
              inv.boxes = variantWhBoxes.get(`${v.id}::${inv.warehouseId}`) ?? []
            }
          }
        }
      }
    }

    // If warehouse or location filter active, hide products with no matching inventory
    if (query.warehouseId || query.locationId) {
      result = result
        .map((p) => ({ ...p, variants: p.variants.filter((v: any) => v.inventory.length > 0) }))
        .filter((p) => p.variants.length > 0)
    }

    // Post-filter by stock status.
    //
    // out_of_stock semantic:
    //  - With warehouseId set: "status === 'out_of_stock'" — the aggregate
    //    within the selected warehouse is 0 (straight interpretation).
    //  - Without warehouseId (all warehouses): match products that have at
    //    least one variant-warehouse row at 0 (outInAnyWarehouse). Aligns
    //    with the stats-KPI ("13 نفذ") which counts rows, not products.
    //    Admin clicking the filter after seeing "13 out of stock" in the
    //    KPI now lands on the products causing those 13 zero rows.
    //
    // low filter: keep the existing semantic (includes out_of_stock) and
    // layer the new "out in any warehouse" signal on top so split-stock
    // cases where one warehouse is empty but another has stock also
    // surface here when no warehouse is selected.
    if (query.status === 'out_of_stock') {
      result = query.warehouseId
        ? result.filter((p) => p.status === 'out_of_stock')
        : result.filter((p) => p.status === 'out_of_stock' || p.outInAnyWarehouse)
    } else if (query.status === 'low') {
      result = query.warehouseId
        ? result.filter((p) => p.status === 'low' || p.status === 'out_of_stock')
        : result.filter((p) => p.status === 'low' || p.status === 'out_of_stock' || p.outInAnyWarehouse)
    } else if (query.status === 'in_stock') {
      result = result.filter((p) => p.status === 'in_stock')
    }

    const filteredTotal = (query.warehouseId || query.locationId || query.status) ? result.length : total
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

  // ── Scan Return Barcode → auto-restock all items ──────────
  /** Preview return items WITHOUT processing — for scanner confirmation step */
  async previewReturnScan(returnNumber: string) {
    const ret = await this.prisma.return.findFirst({
      where: { returnNumber },
      include: {
        order: {
          select: {
            orderNumber: true,
            items: { select: { variantId: true, snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true, variant: { select: { color: true, size: true, product: { select: { images: { select: { url: true, colorName: true, isPrimary: true }, orderBy: { sortOrder: 'asc' } } } } } } } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({ message: { de: `Retoure "${returnNumber}" nicht gefunden.`, en: `Return "${returnNumber}" not found.`, ar: `لم يتم العثور على المرتجع "${returnNumber}".` } })
    }

    if (['received', 'inspected', 'refunded', 'rejected'].includes(ret.status)) {
      return { alreadyProcessed: true, returnNumber, status: ret.status }
    }

    const returnItems = ret.returnItems as any[] | null
    const items = (returnItems?.length ? returnItems : ret.order.items).map((item: any) => {
      const orderItem = ret.order.items.find((oi: any) => oi.variantId === (item.variantId ?? item.variantId))
      return {
        variantId: item.variantId ?? orderItem?.variantId,
        sku: item.sku ?? item.snapshotSku ?? orderItem?.snapshotSku,
        name: item.name ?? item.snapshotName ?? orderItem?.snapshotName,
        quantity: item.quantity ?? orderItem?.quantity ?? 1,
        unitPrice: item.unitPrice ?? Number(orderItem?.unitPrice ?? 0),
        color: orderItem?.variant?.color ?? '',
        size: orderItem?.variant?.size ?? '',
        imageUrl: (() => {
          const images = orderItem?.variant?.product?.images ?? []
          const color = orderItem?.variant?.color
          // 1. Color-specific image (exact match)
          const colorImg = color ? images.find((img: any) => img.colorName?.toLowerCase() === color.toLowerCase()) : null
          // 2. Primary image
          const primaryImg = images.find((img: any) => img.isPrimary)
          // 3. First image
          return colorImg?.url ?? primaryImg?.url ?? images[0]?.url ?? null
        })(),
      }
    })

    return { preview: true, returnNumber, orderNumber: ret.order.orderNumber, status: ret.status, items }
  }

  async processReturnScan(returnNumber: string, adminId: string, targetWarehouseId?: string) {
    const ret = await this.prisma.return.findFirst({
      where: { returnNumber },
      include: {
        order: {
          select: {
            id: true, orderNumber: true,
            items: { select: { id: true, variantId: true, snapshotName: true, snapshotSku: true, quantity: true } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        message: { de: `Retoure "${returnNumber}" nicht gefunden.`, en: `Return "${returnNumber}" not found.`, ar: `لم يتم العثور على المرتجع "${returnNumber}".` },
      })
    }

    // Block if already scanned/processed (received, inspected, refunded, rejected)
    if (['received', 'inspected', 'refunded', 'rejected'].includes(ret.status)) {
      return { alreadyProcessed: true, returnNumber, status: ret.status, message: { de: 'Retoure bereits verarbeitet', en: 'Return already processed', ar: 'تمت معالجة المرتجع بالفعل' } }
    }

    // Get items to restock (from returnItems JSON or order items)
    const returnItems = ret.returnItems as any[] | null
    const orderItemMap = new Map(ret.order.items.map((i: any) => [i.id, i]))
    const items = returnItems?.length ? returnItems : ret.order.items
    const restocked: any[] = []

    for (const item of items) {
      // returnItems JSON may not have variantId — look it up from order items
      const variantId = item.variantId || orderItemMap.get(item.itemId)?.variantId
      const qty = item.quantity ?? 1
      if (!variantId || qty <= 0) continue

      // Use the admin's selected warehouse if provided, otherwise fall back
      // to the inventory row with the highest stock (old behavior).
      let inv = targetWarehouseId
        ? await this.prisma.inventory.findFirst({ where: { variantId, warehouseId: targetWarehouseId } })
        : null
      // If no inventory row exists for this variant in the target warehouse, create one
      if (!inv && targetWarehouseId) {
        inv = await this.prisma.inventory.create({
          data: { variantId, warehouseId: targetWarehouseId, quantityOnHand: 0, quantityReserved: 0, reorderPoint: 5 },
        })
      }
      // Fallback: no warehouse specified → pick the row with most stock
      if (!inv) {
        inv = await this.prisma.inventory.findFirst({
          where: { variantId },
          orderBy: { quantityOnHand: 'desc' },
        })
      }

      if (inv) {
        await this.prisma.inventory.update({
          where: { id: inv.id },
          data: { quantityOnHand: { increment: qty } },
        })
        await this.prisma.inventoryMovement.create({
          data: {
            variantId, warehouseId: inv.warehouseId,
            type: 'return_received', quantity: qty,
            quantityBefore: inv.quantityOnHand, quantityAfter: inv.quantityOnHand + qty,
            notes: `Return scan: ${returnNumber}`, createdBy: adminId,
          },
        })
        restocked.push({
          sku: item.sku ?? item.snapshotSku,
          name: item.name ?? item.snapshotName,
          quantity: qty,
          unitPrice: item.unitPrice ?? 0,
          variantId,
        })
      }
    }

    // Update return status to received
    if (ret.status === 'requested' || ret.status === 'label_sent' || ret.status === 'in_transit') {
      await this.prisma.return.update({
        where: { id: ret.id },
        data: { status: 'received', receivedAt: new Date() },
      })
    }

    // Audit log
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action: 'RETURN_SCANNED',
          entityType: 'return',
          entityId: ret.id,
          changes: { returnNumber, orderNumber: ret.order.orderNumber, itemsRestocked: restocked.length, items: restocked },
          ipAddress: '::1',
        },
      })
    } catch { /* silent */ }

    return {
      success: true,
      returnNumber,
      orderNumber: ret.order.orderNumber,
      itemsRestocked: restocked.length,
      items: restocked,
      message: { de: `${restocked.length} Artikel zurückgebucht`, en: `${restocked.length} items restocked`, ar: `تم إعادة ${restocked.length} عنصر للمخزون` },
    }
  }

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
    if (!items || !Array.isArray(items)) return { processed: 0, items: [] }

    const type = reason === 'return' ? 'return_received' : 'purchase_received'
    const results: any[] = []

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0 || item.quantity > 10000) continue
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

      // Fire-and-forget outbound webhook — enriches payload via DB and emits.
      this.emitRestockWebhook({
        variantId: inv.variantId,
        warehouseId: inv.warehouseId,
        delta: item.quantity,
        newQuantity: newQty,
        source: reason === 'return' ? 'return' : 'intake',
      })
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

      // Fire-and-forget outbound webhook.
      this.emitRestockWebhook({
        variantId: inv.variantId,
        warehouseId: inv.warehouseId,
        delta: item.quantity,
        newQuantity: newQty,
        source: reason === 'return' ? 'return' : 'intake',
      })
    }

    await this.audit.log({ adminId, action: 'INVENTORY_CSV_INTAKE', entityType: 'inventory',
      changes: { after: { processed: results.length, errors: errors.length, reason } }, ipAddress })
    return { processed: results.length, errors, items: results }
  }

  // ── STOCK OUTPUT (Warenausgang) ────────────────────────────

  async output(inventoryId: string, quantity: number, reason: string, adminId: string, ipAddress: string) {
    if (!quantity || quantity <= 0) {
      throw new BadRequestException({ statusCode: 400, error: 'InvalidQuantity',
        message: { de: 'Menge muss größer als 0 sein.', en: 'Quantity must be greater than 0.', ar: 'الكمية يجب أن تكون أكبر من 0.' } })
    }

    const typeMap: Record<string, string> = { sale: 'sale_pos', damaged: 'damaged', loss: 'damaged', gift: 'damaged', sample: 'damaged' }

    // Atomic: check + update in one transaction to prevent race conditions
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the row to prevent concurrent reads
      await tx.$executeRawUnsafe(`SELECT 1 FROM inventory WHERE id = '${inventoryId}' FOR UPDATE`)

      const inv = await tx.inventory.findUnique({ where: { id: inventoryId } })
      if (!inv) throw new NotFoundException('Inventory not found')

      const avail = inv.quantityOnHand - inv.quantityReserved
      if (quantity > avail) {
        throw new BadRequestException({ statusCode: 400, error: 'InsufficientStock',
          message: { de: `Nur ${avail} verfügbar.`, en: `Only ${avail} available.`, ar: `فقط ${avail} متاح.` } })
      }

      const newQty = inv.quantityOnHand - quantity

      await tx.inventory.update({ where: { id: inventoryId }, data: { quantityOnHand: newQty } })
      await tx.inventoryMovement.create({
        data: {
          variantId: inv.variantId, warehouseId: inv.warehouseId,
          type: (typeMap[reason] ?? 'sale_pos') as any, quantity: -quantity,
          quantityBefore: inv.quantityOnHand, quantityAfter: newQty,
          notes: reason, createdBy: adminId,
        },
      })

      return { before: inv.quantityOnHand, after: newQty, reorderPoint: inv.reorderPoint }
    })

    const warning = result.after <= 0 ? 'last_item' : result.after <= result.reorderPoint ? 'reorder' : null
    await this.audit.log({ adminId, action: 'INVENTORY_OUTPUT', entityType: 'inventory', entityId: inventoryId,
      changes: { after: { quantity: -quantity, reason, newQty: result.after } }, ipAddress })
    return { inventoryId, before: result.before, after: result.after, removed: quantity, warning }
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

  async batchTransfer(
    fromWarehouseId: string,
    toWarehouseId: string,
    items: { sku: string; quantity: number }[],
    adminId: string,
    ipAddress: string,
  ) {
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException({ statusCode: 400, error: 'SameWarehouse',
        message: { de: 'Quell- und Ziellager dürfen nicht gleich sein.', en: 'Source and target warehouse must be different.', ar: 'المستودع المصدر والهدف يجب أن يكونا مختلفين.' } })
    }

    // Error payloads are structured { code, params?, message: {de,en,ar} }
    // so the frontend can render the right locale. `message` is provided
    // pre-built for convenience — consumers that care about i18n use
    // `message[locale]` and fall back to the string lookup in code
    // mapping if they need a different shape.
    type TransferError = {
      code: 'NOT_FOUND' | 'NO_STOCK_IN_SOURCE' | 'INSUFFICIENT_STOCK'
      params?: Record<string, string | number>
      message: { de: string; en: string; ar: string }
    }
    const results: { sku: string; quantity: number; success: boolean; error?: TransferError | string }[] = []

    for (const item of items) {
      try {
        const variant = await this.prisma.productVariant.findFirst({
          where: { OR: [{ sku: item.sku }, { barcode: item.sku }] },
        })
        if (!variant) {
          results.push({
            sku: item.sku, quantity: item.quantity, success: false,
            error: {
              code: 'NOT_FOUND',
              message: { de: 'Artikel nicht gefunden', en: 'Product not found', ar: 'المنتج غير موجود' },
            },
          })
          continue
        }

        const inv = await this.prisma.inventory.findFirst({
          where: { variantId: variant.id, warehouseId: fromWarehouseId },
        })
        if (!inv) {
          results.push({
            sku: item.sku, quantity: item.quantity, success: false,
            error: {
              code: 'NO_STOCK_IN_SOURCE',
              message: { de: 'Kein Bestand im Quelllager', en: 'No stock in source warehouse', ar: 'لا يوجد مخزون في المستودع المصدر' },
            },
          })
          continue
        }

        const available = inv.quantityOnHand - inv.quantityReserved
        if (item.quantity > available) {
          results.push({
            sku: item.sku, quantity: item.quantity, success: false,
            error: {
              code: 'INSUFFICIENT_STOCK',
              params: { available },
              message: {
                de: `Nur ${available} verfügbar`,
                en: `Only ${available} available`,
                ar: `متاح فقط ${available}`,
              },
            },
          })
          continue
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: { decrement: item.quantity } } })
          await tx.inventory.upsert({
            where: { variantId_warehouseId: { variantId: variant.id, warehouseId: toWarehouseId } },
            create: { variantId: variant.id, warehouseId: toWarehouseId, quantityOnHand: item.quantity },
            update: { quantityOnHand: { increment: item.quantity } },
          })
          await tx.inventoryMovement.createMany({ data: [
            { variantId: variant.id, warehouseId: fromWarehouseId, type: 'transfer', quantity: -item.quantity, quantityBefore: inv.quantityOnHand, quantityAfter: inv.quantityOnHand - item.quantity, referenceId: toWarehouseId, notes: `Batch transfer out`, createdBy: adminId },
            { variantId: variant.id, warehouseId: toWarehouseId, type: 'transfer', quantity: item.quantity, referenceId: fromWarehouseId, notes: `Batch transfer in`, createdBy: adminId },
          ] })
        })

        results.push({ sku: item.sku, quantity: item.quantity, success: true })
      } catch (e: any) {
        results.push({ sku: item.sku, quantity: item.quantity, success: false, error: e.message })
      }
    }

    const transferred = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    await this.audit.log({ adminId, action: 'INVENTORY_BATCH_TRANSFER', entityType: 'inventory', entityId: fromWarehouseId,
      changes: { after: { from: fromWarehouseId, to: toWarehouseId, transferred, failed, items: results.length } }, ipAddress })

    return { results, summary: { total: items.length, transferred, failed } }
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
      const s = query.search.trim()
      // InventoryMovement has no Prisma `variant` relation — only variantId
      // as a plain string. To search by SKU/barcode/product name, we first
      // resolve matching variant IDs and then filter movements by those IDs.
      const matchingVariants = await this.prisma.productVariant.findMany({
        where: {
          OR: [
            { sku: { contains: s, mode: 'insensitive' } },
            { barcode: { contains: s, mode: 'insensitive' } },
            { product: { translations: { some: { name: { contains: s, mode: 'insensitive' } } } } },
          ],
        },
        select: { id: true },
        take: 200,
      })
      const variantIds = matchingVariants.map((v) => v.id)

      where.OR = [
        { notes: { contains: s, mode: 'insensitive' } },
        { referenceId: { contains: s, mode: 'insensitive' } },
        ...(variantIds.length > 0 ? [{ variantId: { in: variantIds } }] : []),
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

    const userIds = [...new Set(movements.map((m) => m.createdBy).filter(Boolean))] as string[]

    const [variants, warehouses, users] = await Promise.all([
      variantIds.length > 0 ? this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sku: true, color: true, size: true, product: { select: { translations: { select: { name: true, language: true } }, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } } } },
      }) : [],
      warehouseIds.length > 0 ? this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, type: true },
      }) : [],
      userIds.length > 0 ? this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      }) : [],
    ])

    const variantMap = new Map(variants.map((v) => [v.id, v]))
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]))
    const userMap = new Map(users.map((u) => [u.id, u]))

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
          createdByName: m.createdBy ? (() => { const u = userMap.get(m.createdBy); return u ? `${u.firstName} ${u.lastName}`.trim() : null })() : null,
          createdAt: m.createdAt,
          sku: v?.sku,
          color: v?.color,
          size: v?.size,
          productName: v?.product?.translations,
          productImage: v?.product?.images?.[0]?.url ?? null,
          warehouseName: w?.name,
          warehouseType: w?.type,
        }
      }),
      meta: { total, limit, offset },
    }
  }

  // ── CSV EXPORT ─────────────────────────────────────────────

  /**
   * CSV export for inventory.
   *
   * Two modes:
   *  - 'existing' (default): one row per Inventory record. Missing
   *    variant×warehouse combos are NOT in the file. This matches the
   *    historical behavior but without the silent 500-row cap that the
   *    previous implementation inherited from findAll().
   *  - 'matrix': one row per (active variant × target warehouse)
   *    combination. Missing Inventory rows are emitted with quantity 0
   *    so admins can see which variants are missing from which
   *    locations. Respects the same filters as 'existing'.
   *
   * Safety cap: 50 000 rows. A fresh seed of the whole DB is well
   * under that; the cap exists so a runaway query can't exhaust RAM.
   */
  async exportCsv(query: {
    warehouseId?: string
    categoryId?: string
    status?: string
    mode?: 'existing' | 'matrix'
  }) {
    const MAX_ROWS = 50_000
    const mode = query.mode === 'matrix' ? 'matrix' : 'existing'
    const header = 'SKU;Barcode;Produkt;Farbe;Größe;Kategorie;Bestand;Reserviert;Verfügbar;Min-Bestand;Max-Bestand;Verkaufspreis;Lager;Lagerort;Status'

    // Resolve the category filter to a list of effective category IDs
    // (sub-cats included so "Schuhe" matches "Sneaker" etc.). Shared
    // by both modes for consistent filtering.
    let categoryIds: string[] | null = null
    if (query.categoryId) {
      const subcats = await this.prisma.category.findMany({
        where: { parentId: query.categoryId },
        select: { id: true },
      })
      categoryIds = [query.categoryId, ...subcats.map((c) => c.id)]
    }

    // Status post-filter — applied identically to both modes. Zero-rows
    // in matrix mode count as 'out_of_stock'.
    const matchesStatus = (qty: number, reserved: number, reorderPoint: number): boolean => {
      if (!query.status || query.status === 'all') return true
      const avail = qty - reserved
      if (query.status === 'out_of_stock') return avail <= 0
      if (query.status === 'low') return avail > 0 && avail <= reorderPoint
      if (query.status === 'in_stock') return avail > reorderPoint
      return true
    }

    const computeStatus = (qty: number, reserved: number, reorderPoint: number): string => {
      const avail = qty - reserved
      if (avail <= 0) return 'out_of_stock'
      if (avail <= reorderPoint) return 'low'
      return 'in_stock'
    }

    // Escape CSV cells. Our delimiter is ';'. If a value contains a
    // semicolon, quote, or newline we wrap it in double quotes and
    // escape internal quotes by doubling. Matches RFC-4180 adapted to
    // the German Excel convention.
    const esc = (v: unknown): string => {
      if (v == null) return ''
      const s = String(v)
      if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const rows: string[] = []

    if (mode === 'existing') {
      // ── Mode A: only rows that have an Inventory record ──
      const where: any = { variant: { product: { deletedAt: null } } }
      if (query.warehouseId) where.warehouseId = query.warehouseId
      if (categoryIds) where.variant = { ...where.variant, product: { deletedAt: null, categoryId: { in: categoryIds } } }

      const items = await this.prisma.inventory.findMany({
        where,
        include: {
          variant: {
            select: {
              sku: true, barcode: true, color: true, size: true,
              product: {
                select: {
                  basePrice: true, salePrice: true,
                  translations: { where: { language: 'de' }, select: { name: true } },
                  category: { select: { translations: { where: { language: 'de' }, select: { name: true } } } },
                },
              },
            },
          },
          warehouse: { select: { name: true } },
          location: { select: { name: true } },
        },
        take: MAX_ROWS,
        orderBy: [{ warehouseId: 'asc' }, { variant: { sku: 'asc' } }],
      })

      for (const inv of items) {
        if (!matchesStatus(inv.quantityOnHand, inv.quantityReserved, inv.reorderPoint)) continue
        const name = inv.variant.product.translations[0]?.name ?? ''
        const cat = inv.variant.product.category?.translations[0]?.name ?? ''
        const price = Number(inv.variant.product.salePrice ?? inv.variant.product.basePrice)
        const available = inv.quantityOnHand - inv.quantityReserved
        const status = computeStatus(inv.quantityOnHand, inv.quantityReserved, inv.reorderPoint)
        rows.push([
          esc(inv.variant.sku),
          esc(inv.variant.barcode),
          esc(name),
          esc(inv.variant.color),
          esc(inv.variant.size),
          esc(cat),
          inv.quantityOnHand,
          inv.quantityReserved,
          available,
          inv.reorderPoint,
          inv.maxStock,
          price,
          esc(inv.warehouse.name),
          esc(inv.location?.name),
          status,
        ].join(';'))
      }
    } else {
      // ── Mode B: variant × warehouse matrix ──
      // Fetch target warehouses. If the caller filtered by warehouseId,
      // the matrix degrades to a single-warehouse view (which is the
      // same as existing-mode for that one location except zeros are
      // still emitted).
      const warehouseWhere: any = { isActive: true }
      if (query.warehouseId) warehouseWhere.id = query.warehouseId
      const warehouses = await this.prisma.warehouse.findMany({
        where: warehouseWhere,
        select: { id: true, name: true },
        orderBy: [{ type: 'desc' }, { name: 'asc' }],
      })

      // Fetch all variants that match the category filter.
      const variantWhere: any = { product: { deletedAt: null } }
      if (categoryIds) variantWhere.product = { deletedAt: null, categoryId: { in: categoryIds } }

      // Safety ceiling: if the cross-join would exceed MAX_ROWS we
      // still emit what we can. The admin can narrow by category or
      // warehouse if they hit the cap — very unlikely at realistic
      // catalog sizes.
      const variantLimit = Math.max(1, Math.floor(MAX_ROWS / Math.max(1, warehouses.length)))

      const variants = await this.prisma.productVariant.findMany({
        where: variantWhere,
        select: {
          id: true, sku: true, barcode: true, color: true, size: true,
          product: {
            select: {
              basePrice: true, salePrice: true,
              translations: { where: { language: 'de' }, select: { name: true } },
              category: { select: { translations: { where: { language: 'de' }, select: { name: true } } } },
            },
          },
        },
        take: variantLimit,
        orderBy: [{ sku: 'asc' }],
      })

      if (variants.length === 0 || warehouses.length === 0) {
        return header + '\n'
      }

      // Single bulk lookup for all existing inventory rows — avoid the
      // N+1 pattern of querying per (variant, warehouse).
      const variantIds = variants.map((v) => v.id)
      const warehouseIds = warehouses.map((w) => w.id)
      const invRows = await this.prisma.inventory.findMany({
        where: { variantId: { in: variantIds }, warehouseId: { in: warehouseIds } },
        select: {
          variantId: true, warehouseId: true,
          quantityOnHand: true, quantityReserved: true,
          reorderPoint: true, maxStock: true,
          location: { select: { name: true } },
        },
      })
      const key = (vId: string, wId: string) => `${vId}|${wId}`
      const invMap = new Map(invRows.map((r) => [key(r.variantId, r.warehouseId), r]))

      // Default reorder/max when a variant has never been stocked in a
      // warehouse. Matches the Prisma model defaults so the CSV columns
      // still reflect the admin's actual thresholds.
      const DEFAULT_REORDER = 5
      const DEFAULT_MAX = 100

      for (const v of variants) {
        const name = v.product.translations[0]?.name ?? ''
        const cat = v.product.category?.translations[0]?.name ?? ''
        const price = Number(v.product.salePrice ?? v.product.basePrice)
        for (const w of warehouses) {
          const inv = invMap.get(key(v.id, w.id))
          const qty = inv?.quantityOnHand ?? 0
          const reserved = inv?.quantityReserved ?? 0
          const reorder = inv?.reorderPoint ?? DEFAULT_REORDER
          const maxS = inv?.maxStock ?? DEFAULT_MAX
          if (!matchesStatus(qty, reserved, reorder)) continue
          const available = qty - reserved
          const status = computeStatus(qty, reserved, reorder)
          rows.push([
            esc(v.sku),
            esc(v.barcode),
            esc(name),
            esc(v.color),
            esc(v.size),
            esc(cat),
            qty,
            reserved,
            available,
            reorder,
            maxS,
            price,
            esc(w.name),
            esc(inv?.location?.name),
            status,
          ].join(';'))
          if (rows.length >= MAX_ROWS) break
        }
        if (rows.length >= MAX_ROWS) break
      }
    }

    return header + '\n' + rows.join('\n') + (rows.length ? '\n' : '')
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
    if (!warehouseId) {
      throw new BadRequestException({
        error: 'WarehouseRequired',
        message: {
          de: 'Bitte wähle ein Lager für die Inventur aus.',
          en: 'Please pick a warehouse for the stocktake.',
          ar: 'يرجى اختيار مستودع لعملية الجرد.',
        },
      })
    }

    // Make sure the warehouse exists + is active. We do NOT filter by
    // isActive: false because an admin may need to stocktake a warehouse
    // that was just deactivated in order to move the inventory out.
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, name: true },
    })
    if (!warehouse) throw new NotFoundException('Warehouse not found')

    // Guard: exactly one in-progress stocktake per warehouse. Running two
    // in parallel would produce stale expectedQty snapshots on whichever
    // one the admin completes second → ghost-stock bugs. Admin must
    // finish or delete the existing one first.
    const openInSameWarehouse = await this.prisma.stocktake.findFirst({
      where: { warehouseId, status: 'in_progress' },
      select: { id: true },
    })
    if (openInSameWarehouse) {
      throw new ConflictException({
        error: 'StocktakeAlreadyInProgress',
        message: {
          de: 'Für dieses Lager läuft bereits eine Inventur. Bitte schließe sie ab oder lösche sie, bevor du eine neue startest.',
          en: 'A stocktake is already running for this warehouse. Finish or delete it before starting a new one.',
          ar: 'يوجد جرد قيد التنفيذ لهذا المستودع. يرجى إنهاؤه أو حذفه قبل بدء جرد جديد.',
        },
        existingId: openInSameWarehouse.id,
      })
    }

    const where: any = { warehouseId, variant: { product: { deletedAt: null } } }
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

    await this.audit.log({
      adminId, action: 'STOCKTAKE_STARTED', entityType: 'stocktake', entityId: stocktake.id,
      changes: { after: { warehouseId, warehouseName: warehouse.name, categoryId, itemCount: inventory.length } },
      ipAddress: '',
    })

    return stocktake
  }

  /**
   * Start a correction stocktake from a completed one. The new stocktake
   * uses the OLD stocktake's actualQty as its expectedQty baseline (NOT
   * the current live quantityOnHand). This matches the admin's mental
   * model: "I want to correct what I counted last time, starting from
   * my previous count as the reference."
   *
   * The original stocktake is never modified — GoBD audit trail stays
   * intact. The new stocktake is linked via the `notes` column with
   * `correction_of:<sourceId>` so the frontend can render a "Korrektur
   * von #xxxxxx" banner.
   */
  async startCorrectionStocktake(sourceId: string, adminId: string) {
    const source = await this.prisma.stocktake.findUnique({
      where: { id: sourceId },
      include: { items: true },
    })
    if (!source) throw new NotFoundException('Source stocktake not found')
    if (source.status !== 'completed') {
      throw new BadRequestException({
        error: 'CanOnlyCorrectCompleted',
        message: {
          de: 'Nur abgeschlossene Inventuren können korrigiert werden.',
          en: 'Only completed stocktakes can be corrected.',
          ar: 'يمكن تصحيح الجرد المكتمل فقط.',
        },
      })
    }

    // Guard: same one-per-warehouse rule as a normal stocktake. Leaves
    // no room for a confused admin to create two concurrent corrections.
    const openInSameWarehouse = await this.prisma.stocktake.findFirst({
      where: { warehouseId: source.warehouseId, status: 'in_progress' },
      select: { id: true },
    })
    if (openInSameWarehouse) {
      throw new ConflictException({
        error: 'StocktakeAlreadyInProgress',
        message: {
          de: 'Für dieses Lager läuft bereits eine Inventur. Bitte schließe sie ab oder lösche sie, bevor du eine Korrektur startest.',
          en: 'A stocktake is already running for this warehouse. Finish or delete it before starting a correction.',
          ar: 'يوجد جرد قيد التنفيذ لهذا المستودع. يرجى إنهاؤه قبل بدء التصحيح.',
        },
        existingId: openInSameWarehouse.id,
      })
    }

    // Seed expectedQty from the source's actualQty (fallback to its own
    // expectedQty if the admin never filled an actual — shouldn't happen
    // on a completed stocktake but defensively handled).
    const correction = await this.prisma.stocktake.create({
      data: {
        warehouseId: source.warehouseId,
        categoryId: source.categoryId,
        adminId,
        status: 'in_progress',
        notes: `correction_of:${sourceId}`,
        items: {
          create: source.items.map((it) => ({
            variantId: it.variantId,
            expectedQty: it.actualQty ?? it.expectedQty,
          })),
        },
      },
      include: { items: true },
    })

    await this.audit.log({
      adminId, action: 'STOCKTAKE_CORRECTION_STARTED', entityType: 'stocktake', entityId: correction.id,
      changes: { after: { sourceId, warehouseId: source.warehouseId, itemCount: source.items.length } },
      ipAddress: '',
    })

    return correction
  }

  /**
   * Delete an in-progress stocktake. The cascade on StocktakeItem wipes
   * the items automatically. Completed stocktakes are NEVER deletable
   * (GoBD audit trail requirement) — the admin must start a correction
   * stocktake instead.
   */
  async deleteStocktake(stocktakeId: string, adminId: string, ipAddress: string) {
    const st = await this.prisma.stocktake.findUnique({
      where: { id: stocktakeId },
      include: { _count: { select: { items: true } } },
    })
    if (!st) throw new NotFoundException('Stocktake not found')

    if (st.status !== 'in_progress') {
      throw new BadRequestException({
        error: 'CanOnlyDeleteInProgress',
        message: {
          de: 'Abgeschlossene Inventuren können nicht gelöscht werden. Starte stattdessen eine Korrektur-Inventur.',
          en: 'Completed stocktakes cannot be deleted. Start a correction stocktake instead.',
          ar: 'لا يمكن حذف الجرد المكتمل. ابدأ جرد تصحيحي بدلاً من ذلك.',
        },
      })
    }

    await this.prisma.stocktake.delete({ where: { id: stocktakeId } })

    await this.audit.log({
      adminId, action: 'STOCKTAKE_DELETED', entityType: 'stocktake', entityId: stocktakeId,
      changes: { before: { warehouseId: st.warehouseId, categoryId: st.categoryId, itemCount: st._count.items } },
      ipAddress,
    })

    return { deleted: true }
  }

  async getStocktakes(limit = 20) {
    return this.prisma.stocktake.findMany({
      include: {
        _count: { select: { items: true } },
        // Joined so the list row can show "Hamburg Lager" / "Berlin Laden"
        // without a second network round-trip.
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }).then(async (rows) => {
      const warehouseIds = Array.from(new Set(rows.map((r) => r.warehouseId)))
      const warehouses = await this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true, type: true },
      })
      const wMap = new Map(warehouses.map((w) => [w.id, w]))
      return rows.map((r) => ({
        ...r,
        warehouse: wMap.get(r.warehouseId) ?? null,
      }))
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

    // Join warehouse so the detail view can render the "Hamburg Lager"
    // header badge without a second round-trip. Same shape as
    // getStocktakes() so the frontend can treat them uniformly.
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: st.warehouseId },
      select: { id: true, name: true, type: true },
    })

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
      warehouse,
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
