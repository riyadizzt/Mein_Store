import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AdminInventoryService } from '../admin/services/admin-inventory.service'

@Injectable()
export class MasterBoxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AdminInventoryService)) private readonly inventory: AdminInventoryService,
  ) {}

  // ── Generate box number: BOX-2026-W-001 ──────────────────
  private async generateBoxNumber(year: number, season: string): Promise<string> {
    const seasonCode = season.charAt(0).toUpperCase() // W, S, F, A
    const key = `${year}-${seasonCode}`

    const seq = await this.prisma.boxSequence.upsert({
      where: { yearSeasonKey: key },
      create: { yearSeasonKey: key, seq: 1 },
      update: { seq: { increment: 1 } },
    })

    return `BOX-${year}-${seasonCode}-${String(seq.seq).padStart(3, '0')}`
  }

  // ── Create new box ────────────────────────────────────────
  async create(data: { name: string; season: string; year: number; warehouseId: string; notes?: string; adminId: string }) {
    const boxNumber = await this.generateBoxNumber(data.year, data.season)

    // 1. Create InventoryLocation with box number as name
    const location = await this.prisma.inventoryLocation.create({
      data: {
        warehouseId: data.warehouseId,
        name: boxNumber,
        description: data.name,
      },
    })

    // 2. Create BoxManifest metadata
    const manifest = await this.prisma.boxManifest.create({
      data: {
        boxNumber,
        name: data.name,
        season: data.season,
        year: data.year,
        locationId: location.id,
        warehouseId: data.warehouseId,
        status: 'packing',
        notes: data.notes,
        createdBy: data.adminId,
      },
    })

    return { ...manifest, location }
  }

  // ── Scan product into box (upsert + increment) ───────────
  async scanIntoBox(boxId: string, sku: string) {
    const manifest = await this.prisma.boxManifest.findUnique({ where: { id: boxId } })
    if (!manifest) throw new NotFoundException('Box not found')

    // Find variant by SKU or barcode
    const variant = await this.prisma.productVariant.findFirst({
      where: { OR: [{ sku }, { barcode: sku }], isActive: true },
      include: {
        product: {
          select: {
            translations: { select: { language: true, name: true } },
            images: { select: { url: true, isPrimary: true, colorName: true }, take: 5, orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    })

    if (!variant) {
      throw new NotFoundException({ statusCode: 404, error: 'VariantNotFound',
        message: { de: `Produkt "${sku}" nicht gefunden.`, en: `Product "${sku}" not found.`, ar: `المنتج "${sku}" غير موجود.` } })
    }

    // Upsert BoxItem — increment quantity on each scan
    const boxItem = await this.prisma.boxItem.upsert({
      where: { boxId_variantId: { boxId, variantId: variant.id } },
      create: { boxId, variantId: variant.id, quantity: 1 },
      update: { quantity: { increment: 1 } },
    })

    // Tag Inventory with locationId (for the BOX badge in /admin/inventory).
    // If no inventory row exists for this variant+warehouse, create one so the
    // badge appears. This is best-effort — doesn't affect box quantity.
    try {
      const updated = await this.prisma.inventory.updateMany({
        where: { variantId: variant.id, warehouseId: manifest.warehouseId },
        data: { locationId: manifest.locationId },
      })
      if (updated.count === 0) {
        // No inventory row in this warehouse — create one with 0 stock + location
        await this.prisma.inventory.create({
          data: { variantId: variant.id, warehouseId: manifest.warehouseId, quantityOnHand: 0, quantityReserved: 0, reorderPoint: 5, locationId: manifest.locationId },
        }).catch(() => { /* unique constraint — row exists in another state */ })
      }
    } catch { /* ignore */ }

    const name = variant.product.translations.find((t) => t.language === 'de')?.name ?? sku
    const colorImg = variant.product.images.find((img) => img.colorName?.toLowerCase() === (variant.color ?? '').toLowerCase())
    const primaryImg = variant.product.images.find((img) => img.isPrimary)

    return {
      boxItemId: boxItem.id,
      sku: variant.sku,
      name,
      color: variant.color,
      size: variant.size,
      quantity: boxItem.quantity,
      imageUrl: colorImg?.url ?? primaryImg?.url ?? variant.product.images[0]?.url ?? null,
    }
  }

  // ── List boxes ────────────────────────────────────────────
  async findAll(filters?: { season?: string; year?: number; warehouseId?: string; status?: string }) {
    const where: any = {}
    if (filters?.season) where.season = filters.season
    if (filters?.year) where.year = filters.year
    if (filters?.warehouseId) where.warehouseId = filters.warehouseId
    if (filters?.status) where.status = filters.status

    const boxes = await this.prisma.boxManifest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    const enriched = await Promise.all(boxes.map(async (b) => {
      const items = await this.prisma.boxItem.findMany({
        where: { boxId: b.id },
        select: { quantity: true },
      })
      const totalQuantity = items.reduce((s, i) => s + i.quantity, 0)
      const warehouse = await this.prisma.warehouse.findUnique({ where: { id: b.warehouseId }, select: { name: true } })
      return { ...b, itemCount: items.length, totalQuantity, warehouseName: warehouse?.name ?? '—' }
    }))

    return enriched
  }

  // ── Get box detail with all items ─────────────────────────
  async findOne(boxId: string) {
    const manifest = await this.prisma.boxManifest.findUnique({ where: { id: boxId } })
    if (!manifest) throw new NotFoundException('Box not found')

    const boxItems = await this.prisma.boxItem.findMany({
      where: { boxId },
      orderBy: { createdAt: 'asc' },
    })

    // Batch load variants
    const variantIds = boxItems.map((bi) => bi.variantId)
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          select: {
            translations: { select: { language: true, name: true } },
            images: { select: { url: true, isPrimary: true, colorName: true }, orderBy: { sortOrder: 'asc' } },
            basePrice: true,
            salePrice: true,
          },
        },
      },
    })

    const variantMap = new Map(variants.map((v: any) => [v.id, v]))

    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: manifest.warehouseId } })

    const items = boxItems.map((bi) => {
      const variant: any = variantMap.get(bi.variantId)
      if (!variant) {
        return {
          boxItemId: bi.id,
          variantId: bi.variantId,
          sku: 'unknown',
          barcode: null,
          name: 'Unknown',
          color: null,
          size: null,
          quantity: bi.quantity,
          price: 0,
          imageUrl: null,
        }
      }
      const name = variant.product.translations.find((t: any) => t.language === 'de')?.name ?? variant.sku
      const colorImg = variant.product.images.find((img: any) => img.colorName?.toLowerCase() === (variant.color ?? '').toLowerCase())
      const primaryImg = variant.product.images.find((img: any) => img.isPrimary)
      return {
        boxItemId: bi.id,
        variantId: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        name,
        color: variant.color,
        size: variant.size,
        quantity: bi.quantity,
        price: Number(variant.product.salePrice ?? variant.product.basePrice),
        imageUrl: colorImg?.url ?? primaryImg?.url ?? variant.product.images[0]?.url ?? null,
      }
    })

    return {
      ...manifest,
      warehouse,
      items,
      totalItems: items.length,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    }
  }

  // ── Update item quantity (editable) ───────────────────────
  async updateItemQuantity(boxId: string, boxItemId: string, quantity: number) {
    if (quantity < 0) throw new BadRequestException('Quantity must be >= 0')

    const boxItem = await this.prisma.boxItem.findUnique({ where: { id: boxItemId } })
    if (!boxItem || boxItem.boxId !== boxId) throw new NotFoundException('Item not in this box')

    if (quantity === 0) {
      return this.removeItem(boxId, boxItemId)
    }

    return this.prisma.boxItem.update({
      where: { id: boxItemId },
      data: { quantity },
    })
  }

  // ── Remove item from box ─────────────────────────────────
  async removeItem(boxId: string, boxItemId: string) {
    const manifest = await this.prisma.boxManifest.findUnique({ where: { id: boxId } })
    if (!manifest) throw new NotFoundException('Box not found')

    const boxItem = await this.prisma.boxItem.findUnique({ where: { id: boxItemId } })
    if (!boxItem || boxItem.boxId !== boxId) throw new NotFoundException('Item not in this box')

    await this.prisma.boxItem.delete({ where: { id: boxItemId } })

    // If no more box items for this variant, clear inventory.locationId
    const remaining = await this.prisma.boxItem.count({
      where: { boxId, variantId: boxItem.variantId },
    })
    if (remaining === 0) {
      await this.prisma.inventory.updateMany({
        where: {
          variantId: boxItem.variantId,
          warehouseId: manifest.warehouseId,
          locationId: manifest.locationId,
        },
        data: { locationId: null },
      }).catch(() => { /* ignore */ })
    }

    return { success: true }
  }

  // ── Update status ──────────────────────────────────────────
  async updateStatus(boxId: string, status: 'packing' | 'sealed' | 'opened') {
    return this.prisma.boxManifest.update({ where: { id: boxId }, data: { status } })
  }

  // ── Transfer entire box to another warehouse (STRICT MODE) ─────────────
  // 1. Preflight: check ALL items have enough available stock. If any is short → abort, no writes.
  // 2. Execute: call existing transfer() for each item with the exact boxItem.quantity.
  // 3. Sync: explicitly update BoxItem.quantity to actually transferred amount (no phantom qty).
  async transferBox(boxId: string, targetWarehouseId: string, adminId: string, ipAddress: string) {
    const manifest = await this.prisma.boxManifest.findUnique({ where: { id: boxId } })
    if (!manifest) throw new NotFoundException('Box not found')

    if (manifest.warehouseId === targetWarehouseId) {
      throw new BadRequestException({ statusCode: 400, error: 'SameWarehouse',
        message: { de: 'Quell- und Ziellager dürfen nicht gleich sein.', en: 'Source and target warehouse must differ.', ar: 'المستودع المصدر والهدف يجب أن يكونا مختلفين.' } })
    }

    const boxItems = await this.prisma.boxItem.findMany({ where: { boxId } })
    if (boxItems.length === 0) {
      throw new BadRequestException({ statusCode: 400, error: 'EmptyBox',
        message: { de: 'Die Kiste ist leer.', en: 'The box is empty.', ar: 'الكرتونة فارغة.' } })
    }

    // ── PREFLIGHT (batch-load for efficiency, no writes) ──
    const variantIds = boxItems.map((bi) => bi.variantId)

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true, sku: true, color: true, size: true,
        product: { select: { translations: { select: { language: true, name: true } } } },
      },
    })
    const variantMap = new Map(variants.map((v: any) => [v.id, v]))

    const sourceInvs = await this.prisma.inventory.findMany({
      where: { variantId: { in: variantIds }, warehouseId: manifest.warehouseId },
    })
    const invMap = new Map(sourceInvs.map((inv) => [inv.variantId, inv]))

    const mismatches: { sku: string; name: string; wanted: number; available: number }[] = []

    for (const bi of boxItems) {
      const inv = invMap.get(bi.variantId)
      const available = inv ? inv.quantityOnHand - inv.quantityReserved : 0
      if (bi.quantity > available) {
        const v: any = variantMap.get(bi.variantId)
        const productName = v?.product?.translations?.find((t: any) => t.language === 'de')?.name ?? v?.sku ?? 'Unknown'
        const label = `${productName} (${v?.color ?? '—'}/${v?.size ?? '—'})`
        mismatches.push({
          sku: v?.sku ?? bi.variantId,
          name: label,
          wanted: bi.quantity,
          available,
        })
      }
    }

    if (mismatches.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'StockMismatch',
        message: {
          de: `Transfer abgebrochen: ${mismatches.length} Artikel haben nicht genug verfügbaren Bestand.`,
          en: `Transfer aborted: ${mismatches.length} items have insufficient available stock.`,
          ar: `تم إلغاء النقل: ${mismatches.length} منتج ليس لديه مخزون كافٍ.`,
        },
        mismatches,
      })
    }

    // ── EXECUTE (preflight passed — all items guaranteed available, barring concurrent race) ──
    const newLocation = await this.prisma.inventoryLocation.create({
      data: {
        warehouseId: targetWarehouseId,
        name: manifest.boxNumber,
        description: manifest.name,
      },
    })

    const results: { variantId: string; sku: string; transferred: number; success: boolean; error?: string }[] = []
    const executionErrors: { variantId: string; sku: string; error: string }[] = []

    for (const bi of boxItems) {
      const v: any = variantMap.get(bi.variantId)
      const sku = v?.sku ?? bi.variantId.slice(0, 8)
      const sourceInv = invMap.get(bi.variantId)
      if (!sourceInv) {
        executionErrors.push({ variantId: bi.variantId, sku, error: 'Source inventory disappeared' })
        results.push({ variantId: bi.variantId, sku, transferred: 0, success: false, error: 'Source inventory disappeared' })
        continue
      }

      try {
        await this.inventory.transfer(sourceInv.id, targetWarehouseId, bi.quantity, adminId, ipAddress)

        // Tag new-warehouse inventory with box location (for inventory badge)
        const newInv = await this.prisma.inventory.findFirst({
          where: { variantId: bi.variantId, warehouseId: targetWarehouseId },
        })
        if (newInv) {
          await this.prisma.inventory.update({
            where: { id: newInv.id },
            data: { locationId: newLocation.id },
          })
        }

        results.push({ variantId: bi.variantId, sku, transferred: bi.quantity, success: true })
      } catch (e: any) {
        const errMsg = typeof e?.response?.message === 'object'
          ? (e.response.message.de ?? e.response.message.en ?? 'Transfer failed')
          : (e?.message ?? 'Transfer failed')
        executionErrors.push({ variantId: bi.variantId, sku, error: errMsg })
        results.push({ variantId: bi.variantId, sku, transferred: 0, success: false, error: errMsg })
      }
    }

    if (executionErrors.length > 0) {
      // Rare race condition: preflight passed but execution failed on some items.
      // Clean up the new location and abort — manifest stays in source warehouse.
      await this.prisma.inventoryLocation.delete({ where: { id: newLocation.id } }).catch(() => { /* ignore */ })
      throw new InternalServerErrorException({
        statusCode: 500,
        error: 'TransferRaceCondition',
        message: {
          de: `${executionErrors.length} Artikel konnten wegen gleichzeitiger Bestandsänderung nicht transferiert werden. Transfer abgebrochen — bitte erneut versuchen.`,
          en: `${executionErrors.length} items could not be transferred due to concurrent stock changes. Transfer aborted — please retry.`,
          ar: `${executionErrors.length} منتج لم يتم نقله بسبب تغييرات متزامنة في المخزون. تم إلغاء النقل — يرجى إعادة المحاولة.`,
        },
        errors: executionErrors,
        partialResults: results.filter((r) => r.success),
      })
    }

    // ── SYNC: explicitly set BoxItem.quantity to actually transferred amount ──
    // In strict mode transferred === bi.quantity so this is idempotent,
    // but it makes the guarantee explicit: no phantom quantities possible.
    for (const r of results) {
      await this.prisma.boxItem.updateMany({
        where: { boxId, variantId: r.variantId },
        data: { quantity: r.transferred },
      })
    }

    // Clear box location from source-warehouse inventories (tag cleanup)
    await this.prisma.inventory.updateMany({
      where: { locationId: manifest.locationId, warehouseId: manifest.warehouseId },
      data: { locationId: null },
    })

    // Delete old source location
    await this.prisma.inventoryLocation.delete({ where: { id: manifest.locationId } }).catch(() => { /* ignore */ })

    // Update manifest to point to new location + warehouse
    // Auto-seal: a transferred box is logically sealed (it was moved as a unit)
    await this.prisma.boxManifest.update({
      where: { id: boxId },
      data: {
        locationId: newLocation.id,
        warehouseId: targetWarehouseId,
        status: 'sealed',
      },
    })

    return {
      results,
      successCount: results.length,
      failCount: 0,
      totalTransferred: results.reduce((s, r) => s + r.transferred, 0),
    }
  }

  // ── Delete box (unpack — remove all locationId references) ──
  async delete(boxId: string) {
    const manifest = await this.prisma.boxManifest.findUnique({ where: { id: boxId } })
    if (!manifest) throw new NotFoundException('Box not found')

    // Delete all box items
    await this.prisma.boxItem.deleteMany({ where: { boxId } })

    // Remove locationId from all inventories pointing to this box location
    await this.prisma.inventory.updateMany({
      where: { locationId: manifest.locationId },
      data: { locationId: null },
    })

    // Delete manifest
    await this.prisma.boxManifest.delete({ where: { id: boxId } })

    // Delete the location itself
    await this.prisma.inventoryLocation.delete({ where: { id: manifest.locationId } }).catch(() => { /* ignore if referenced */ })

    return { success: true }
  }
}
