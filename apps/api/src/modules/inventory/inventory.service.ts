import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common'
import { Queue } from 'bullmq'
import { PrismaService } from '../../prisma/prisma.service'
import { AdjustInventoryDto } from './dto/adjust-inventory.dto'
import { TransferInventoryDto } from './dto/transfer-inventory.dto'
import { QueryHistoryDto } from './dto/query-history.dto'
import { JOB_NAMES } from '../../queues/queue.constants'

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject('INVENTORY_SYNC_QUEUE')
    private readonly inventoryQueue: Queue,
  ) {}

  // ── Public: SKU-Verfügbarkeit ────────────────────────────────

  async getAvailabilityBySku(sku: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku },
      include: {
        inventory: {
          select: { quantityOnHand: true, quantityReserved: true },
        },
      },
    })

    if (!variant || !variant.isActive) {
      return { sku, available: false, quantity: 0 }
    }

    const quantity = variant.inventory.reduce(
      (sum, i) => sum + (i.quantityOnHand - i.quantityReserved),
      0,
    )

    return { sku, available: quantity > 0, quantity: Math.max(0, quantity) }
  }

  // ── Admin: Detailabfrage pro Variante ────────────────────────

  async getStockByVariantId(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: {
          include: {
            translations: { where: { language: 'de' as any }, take: 1 },
          },
        },
        inventory: {
          include: {
            warehouse: {
              select: { id: true, name: true, type: true, isActive: true },
            },
          },
        },
      },
    })

    if (!variant) throw new NotFoundException(`Variante "${variantId}" nicht gefunden`)

    return {
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.translations[0]?.name ?? variant.sku,
      color: variant.color,
      size: variant.size,
      warehouses: variant.inventory.map((i) => ({
        warehouse: i.warehouse,
        quantityOnHand: i.quantityOnHand,
        quantityReserved: i.quantityReserved,
        quantityAvailable: Math.max(0, i.quantityOnHand - i.quantityReserved),
        reorderPoint: i.reorderPoint,
        reorderQuantity: i.reorderQuantity,
        isBelowReorderPoint:
          i.quantityOnHand - i.quantityReserved <= i.reorderPoint,
        lastSyncedAt: i.lastSyncedAt,
      })),
      totalAvailable: variant.inventory.reduce(
        (s, i) => s + Math.max(0, i.quantityOnHand - i.quantityReserved),
        0,
      ),
    }
  }

  // ── Admin: Gesamtübersicht ───────────────────────────────────

  async getOverview(warehouseId?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit

    const where: any = {}
    if (warehouseId) where.warehouseId = warehouseId

    const [items, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ warehouseId: 'asc' }, { updatedAt: 'desc' }],
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              color: true,
              size: true,
              product: {
                select: {
                  slug: true,
                  translations: {
                    where: { language: 'de' as any },
                    take: 1,
                    select: { name: true },
                  },
                },
              },
            },
          },
          warehouse: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
      this.prisma.inventory.count({ where }),
    ])

    return {
      data: items.map((i) => ({
        id: i.id,
        sku: i.variant.sku,
        variantId: i.variant.id,
        productName: i.variant.product.translations[0]?.name ?? i.variant.product.slug,
        color: i.variant.color,
        size: i.variant.size,
        warehouse: i.warehouse,
        quantityOnHand: i.quantityOnHand,
        quantityReserved: i.quantityReserved,
        quantityAvailable: Math.max(0, i.quantityOnHand - i.quantityReserved),
        reorderPoint: i.reorderPoint,
        isBelowReorderPoint:
          i.quantityOnHand - i.quantityReserved <= i.reorderPoint,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  // ── Admin: Manuelle Korrektur ────────────────────────────────

  async adjust(dto: AdjustInventoryDto, performedBy: string) {
    const inventoryRow = await this.prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
        },
      },
    })

    if (!inventoryRow) {
      throw new NotFoundException(
        `Kein Lagerbestand für diese Variante/Lagerort-Kombination gefunden`,
      )
    }

    const newQty = inventoryRow.quantityOnHand + dto.adjustment
    if (newQty < 0) {
      throw new BadRequestException(
        `Korrektur würde den Bestand negativ machen. Aktuell: ${inventoryRow.quantityOnHand}, Korrektur: ${dto.adjustment}`,
      )
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventory.update({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.warehouseId,
          },
        },
        data: { quantityOnHand: newQty },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          type: 'stocktake_adjustment',
          quantity: dto.adjustment,
          quantityBefore: inventoryRow.quantityOnHand,
          quantityAfter: newQty,
          notes: dto.reason,
          createdBy: performedBy,
        },
      }),
    ])

    await this.checkAndAlertLowStock(
      dto.variantId,
      dto.warehouseId,
      newQty - inventoryRow.quantityReserved,
      inventoryRow.reorderPoint,
    )

    this.logger.log(
      `Bestand angepasst: SKU=${dto.variantId} | ${inventoryRow.quantityOnHand} → ${newQty} | By=${performedBy}`,
    )

    return updated
  }

  // ── Admin: Transfer zwischen Lagerorten ─────────────────────

  async transfer(dto: TransferInventoryDto, performedBy: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Quell- und Ziellagerort dürfen nicht identisch sein')
    }

    const [source, target] = await Promise.all([
      this.prisma.inventory.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.fromWarehouseId,
          },
        },
      }),
      this.prisma.inventory.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.toWarehouseId,
          },
        },
      }),
    ])

    if (!source) {
      throw new NotFoundException('Quell-Lagerbestand nicht gefunden')
    }

    const sourceAvailable = source.quantityOnHand - source.quantityReserved
    if (sourceAvailable < dto.quantity) {
      throw new BadRequestException(
        `Nicht genügend verfügbarer Bestand. Verfügbar: ${sourceAvailable}, Angefordert: ${dto.quantity}`,
      )
    }

    const newSourceQty = source.quantityOnHand - dto.quantity
    const newTargetQty = (target?.quantityOnHand ?? 0) + dto.quantity

    await this.prisma.$transaction(async (tx) => {
      // Quelle abziehen
      await tx.inventory.update({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.fromWarehouseId,
          },
        },
        data: { quantityOnHand: newSourceQty },
      })

      // Ziel aufstocken oder neu anlegen
      await tx.inventory.upsert({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.toWarehouseId,
          },
        },
        update: { quantityOnHand: { increment: dto.quantity } },
        create: {
          variantId: dto.variantId,
          warehouseId: dto.toWarehouseId,
          quantityOnHand: dto.quantity,
        },
      })

      // Bewegungshistorie — zwei Einträge (Ausgang + Eingang)
      await tx.inventoryMovement.createMany({
        data: [
          {
            variantId: dto.variantId,
            warehouseId: dto.fromWarehouseId,
            type: 'transfer',
            quantity: -dto.quantity,
            quantityBefore: source.quantityOnHand,
            quantityAfter: newSourceQty,
            referenceId: dto.toWarehouseId,
            notes: `Transfer nach ${dto.toWarehouseId}: ${dto.reason}`,
            createdBy: performedBy,
          },
          {
            variantId: dto.variantId,
            warehouseId: dto.toWarehouseId,
            type: 'transfer',
            quantity: dto.quantity,
            quantityBefore: target?.quantityOnHand ?? 0,
            quantityAfter: newTargetQty,
            referenceId: dto.fromWarehouseId,
            notes: `Transfer von ${dto.fromWarehouseId}: ${dto.reason}`,
            createdBy: performedBy,
          },
        ],
      })
    })

    await this.checkAndAlertLowStock(
      dto.variantId,
      dto.fromWarehouseId,
      newSourceQty - source.quantityReserved,
      source.reorderPoint,
    )

    this.logger.log(
      `Transfer: SKU=${dto.variantId} | ${dto.fromWarehouseId} → ${dto.toWarehouseId} | Menge: ${dto.quantity}`,
    )

    return { success: true, transferred: dto.quantity }
  }

  // ── Admin: Bewegungshistorie ─────────────────────────────────

  async getHistory(variantId: string, query: QueryHistoryDto) {
    const { type, dateFrom, dateTo, page = 1, limit = 50 } = query
    const skip = (page - 1) * limit

    const where: any = { variantId }
    if (type) where.type = type
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const [movements, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          warehouse: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ])

    return {
      data: movements,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  // ── Internal: Low-Stock Check + Alert ───────────────────────

  async checkAndAlertLowStock(
    variantId: string,
    warehouseId: string,
    currentAvailable: number,
    reorderPoint: number,
  ) {
    if (currentAvailable > reorderPoint) return

    try {
      // Prüfen ob bereits eine offene Warnung existiert
      const existing = await this.prisma.lowStockAlert.findFirst({
        where: { variantId, warehouseId, resolvedAt: null },
      })

      if (existing) return // Warnung bereits aktiv

      // DB-Log
      await this.prisma.lowStockAlert.create({
        data: { variantId, warehouseId, currentQty: currentAvailable, reorderPoint },
      })

      // BullMQ-Job
      await this.inventoryQueue.add(
        JOB_NAMES.LOW_STOCK_ALERT,
        { variantId, warehouseId, currentAvailable, reorderPoint },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      )

      this.logger.warn(
        `LOW STOCK ALERT: variantId=${variantId} | warehouseId=${warehouseId} | available=${currentAvailable} | reorderPoint=${reorderPoint}`,
      )
    } catch (err) {
      // Alert-Fehler darf Hauptoperation nicht blockieren
      this.logger.error('Low-Stock-Alert fehlgeschlagen', err)
    }
  }
}
