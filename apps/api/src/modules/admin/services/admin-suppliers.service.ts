import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { ensureVariantBarcode } from '../../../common/helpers/variant-barcode'

// Per-line quantity cap. Tippfehler like 100.000 get rejected early,
// not silently accepted. Aligned with admin-inventory.service.intake()
// which already uses the same ceiling for manual stock corrections.
const MAX_QTY_PER_DELIVERY_LINE = 10000

// ── Types ────────────────────────────────────────────────────

interface CreateSupplierDto {
  name: string
  contactPerson?: string
  email?: string
  phone?: string
  address?: string
  country?: string
  notes?: string
}

interface SupplierFindAllQuery {
  search?: string
  country?: string
  isActive?: boolean
  limit?: number
  offset?: number
}

interface DeliveryNewProductItem {
  productName: string
  productNameDe?: string
  categoryId?: string
  colors: string[]
  // Hex lookup for each colour name in `colors`. Optional for backwards
  // compat — older clients that don't send it fall back to null (which
  // makes the product edit page render a #999 gray placeholder). New
  // clients include this map so variants get their real color swatch.
  colorHexes?: Record<string, string>
  sizes: string[]
  purchasePrice: number
  salePrice: number
  quantities: Record<string, number> // "Rot/M": 10, "Rot/L": 15
}

interface DeliveryExistingProductItem {
  variantId: string
  quantity: number
  purchasePrice?: number
}

interface CreateDeliveryDto {
  supplierId: string
  warehouseId?: string
  notes?: string
  newProducts?: DeliveryNewProductItem[]
  existingItems?: DeliveryExistingProductItem[]
}

interface CreatePaymentDto {
  supplierId: string
  amount: number
  method: 'cash' | 'bank_transfer'
  notes?: string
  paidAt?: Date
}

const COLOR_SKU_MAP: Record<string, string> = {
  'Schwarz': 'SCH', 'Weiß': 'WEI', 'Grau': 'GRA', 'Rot': 'ROT', 'Blau': 'BLA',
  'Navy': 'NAV', 'Grün': 'GRN', 'Gelb': 'GEL', 'Orange': 'ORA', 'Pink': 'PNK',
  'Rosa': 'ROS', 'Lila': 'LIL', 'Braun': 'BRN', 'Beige': 'BEI', 'Creme': 'CRM',
  'Gold': 'GLD', 'Silber': 'SLB', 'Bordeaux': 'BDX', 'Khaki': 'KHK', 'Türkis': 'TRK',
  'Hellblau': 'HBL', 'Dunkelgrün': 'DGR', 'Anthrazit': 'ANT', 'Multicolor': 'MUL',
}

function colorCode(name: string): string {
  return COLOR_SKU_MAP[name] ?? (name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'XXX')
}

@Injectable()
export class AdminSuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Supplier CRUD ────────────────────────────────────────────

  async findAll(query: SupplierFindAllQuery) {
    const { search, country, isActive, limit = 50, offset = 0 } = query

    const where: any = { isActive: true }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (country) where.country = country
    if (isActive !== undefined) where.isActive = isActive

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.supplier.count({ where }),
    ])

    // Calculate balances for each supplier
    const enriched = await Promise.all(
      suppliers.map(async (s) => {
        const [deliveryAgg, paymentAgg, lastDelivery, deliveryCount] = await Promise.all([
          this.prisma.supplierDelivery.aggregate({
            where: { supplierId: s.id, status: { not: 'cancelled' } },
            _sum: { totalAmount: true },
          }),
          this.prisma.supplierPayment.aggregate({
            where: { supplierId: s.id },
            _sum: { amount: true },
          }),
          this.prisma.supplierDelivery.findFirst({
            where: { supplierId: s.id },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
          }),
          this.prisma.supplierDelivery.count({ where: { supplierId: s.id } }),
        ])

        const totalDeliveries = Number(deliveryAgg._sum.totalAmount ?? 0)
        const totalPayments = Number(paymentAgg._sum.amount ?? 0)

        return {
          ...s,
          balance: totalDeliveries - totalPayments,
          totalDeliveries,
          totalPayments,
          lastDeliveryAt: lastDelivery?.receivedAt ?? null,
          deliveryCount,
        }
      }),
    )

    return { data: enriched, meta: { total, limit, offset } }
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } })
    if (!supplier) throw new NotFoundException('Lieferant nicht gefunden')

    const [deliveryAgg, paymentAgg] = await Promise.all([
      this.prisma.supplierDelivery.aggregate({
        where: { supplierId: id, status: { not: 'cancelled' } },
        _sum: { totalAmount: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: { supplierId: id },
        _sum: { amount: true },
      }),
    ])

    const totalDeliveries = Number(deliveryAgg._sum.totalAmount ?? 0)
    const totalPayments = Number(paymentAgg._sum.amount ?? 0)

    return {
      ...supplier,
      balance: totalDeliveries - totalPayments,
      totalDeliveries,
      totalPayments,
    }
  }

  async create(dto: CreateSupplierDto, adminId: string, ip: string) {
    const supplier = await this.prisma.supplier.create({ data: dto })

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_CREATED', entityType: 'supplier', entityId: supplier.id,
        changes: { after: { name: dto.name, country: dto.country ?? '' } }, ipAddress: ip,
      })
    } catch {}

    return supplier
  }

  async update(id: string, dto: Partial<CreateSupplierDto>, adminId: string, ip: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Lieferant nicht gefunden')

    const updated = await this.prisma.supplier.update({ where: { id }, data: dto })

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_UPDATED', entityType: 'supplier', entityId: id,
        changes: { before: { name: existing.name }, after: { name: updated.name } }, ipAddress: ip,
      })
    } catch {}

    return updated
  }

  async remove(id: string, adminId: string, ip: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Lieferant nicht gefunden')

    await this.prisma.supplier.update({ where: { id }, data: { isActive: false } })

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_DELETED', entityType: 'supplier', entityId: id,
        changes: { before: { name: existing.name, isActive: true }, after: { isActive: false } }, ipAddress: ip,
      })
    } catch {}

    return { success: true }
  }

  // ── SKU Generator ────────────────────────────────────────────

  // Accept either the outer PrismaService or an interactive TransactionClient
  // so generators called from inside $transaction participate in its rollback.
  // If the outer tx aborts, the sequence upsert rolls back too — no gap.
  private async generateSku(client: PrismaService | Prisma.TransactionClient, color: string, size: string): Promise<string> {
    const seq = await client.skuSequence.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', lastNum: 1 },
      update: { lastNum: { increment: 1 } },
    })
    const num = String(seq.lastNum).padStart(6, '0')
    const colorPart = color ? colorCode(color) : 'STD'
    const sizePart = size || 'OS'
    return `MAL-${num}-${colorPart}-${sizePart}`
  }

  // ── Delivery Number ──────────────────────────────────────────

  private async generateDeliveryNumber(client: PrismaService | Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear()

    const seq = await client.supplierDeliverySequence.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', year, lastNum: 1 },
      update: {
        lastNum: { increment: 1 },
        ...(year !== undefined ? {} : {}),
      },
    })

    // Reset if new year
    if (seq.year !== year) {
      const reset = await client.supplierDeliverySequence.update({
        where: { id: 'singleton' },
        data: { year, lastNum: 1 },
      })
      return `WE-${year}-${String(reset.lastNum).padStart(5, '0')}`
    }

    return `WE-${year}-${String(seq.lastNum).padStart(5, '0')}`
  }

  // ── Wareneingang (Receiving) ─────────────────────────────────
  //
  // Architecture notes (Gruppe-1 hardening, 2026-04-20):
  //
  //  1. ATOMIC — the whole flow runs inside a single $transaction.
  //     Product creation, variant creation, SupplierDelivery insert,
  //     inventory updates and InventoryMovement writes either ALL
  //     commit together or ALL roll back. No partial state possible
  //     when anything throws mid-way.
  //
  //  2. VALIDATED FIRST — every incoming line is checked (supplier
  //     exists, warehouse exists + active, variants exist + active,
  //     quantity in (0, MAX_QTY_PER_DELIVERY_LINE]) BEFORE any write.
  //     A single bad line aborts the whole delivery with a structured
  //     400 error listing every invalid row — admin fixes the file
  //     and resubmits, no ghost half-bookings.
  //
  //  3. IDEMPOTENT (item-level) — each InventoryMovement stores
  //     referenceId = SupplierDeliveryItem.id. A partial unique index
  //     on (reference_id, variant_id) WHERE type='supplier_delivery'
  //     guarantees at most one movement row per deliveryItem. Any
  //     code-level accidental double-write trips P2002 and rolls back.
  //     See migration 20260420_supplier_delivery_item_unique.
  //
  //  4. RACE-SAFE — inventory updates use `{ increment }` (atomic on
  //     the DB level) and read the post-update `quantityOnHand` back
  //     from Prisma's return value for the InventoryMovement record,
  //     not a locally-computed "before + delta" that could drift under
  //     concurrent writes.

  async createDelivery(dto: CreateDeliveryDto, adminId: string, ip: string) {
    // ── 1. Supplier + warehouse (outside tx — pure reads) ────
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } })
    if (!supplier) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'SupplierNotFound',
        message: { de: 'Lieferant nicht gefunden.', en: 'Supplier not found.', ar: 'المورد غير موجود.' },
      })
    }

    const warehouse = dto.warehouseId
      ? await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } })
      : await this.prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    if (!warehouse) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'WarehouseNotFound',
        message: { de: 'Kein aktives Lager gefunden.', en: 'No active warehouse found.', ar: 'لم يتم العثور على مستودع نشط.' },
      })
    }
    if (!warehouse.isActive) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'WarehouseInactive',
        message: { de: 'Das ausgewählte Lager ist deaktiviert.', en: 'The selected warehouse is inactive.', ar: 'المستودع المحدد غير مفعّل.' },
      })
    }

    // ── 2. Pre-validate ALL lines (no writes; all-or-nothing) ────
    const newProductRows = dto.newProducts ?? []
    const existingItems = dto.existingItems ?? []
    if (newProductRows.length === 0 && existingItems.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'DeliveryEmpty',
        message: { de: 'Lieferschein enthält keine Zeilen.', en: 'Delivery has no line items.', ar: 'إذن التسليم لا يحتوي على أي عناصر.' },
      })
    }

    type LineError = { line: number; sku?: string; field: string; reason: string }
    const errors: LineError[] = []

    // 2a. New products: validate qty cap and at-least-one-positive
    for (const [pIdx, np] of newProductRows.entries()) {
      if (!np.productName?.trim()) {
        errors.push({ line: pIdx, field: 'productName', reason: 'missing' })
      }
      const colors = np.colors.length ? np.colors : ['']
      const sizes = np.sizes.length ? np.sizes : ['']
      let hasPositive = false
      for (const color of colors) {
        for (const size of sizes) {
          const variantKey = [color, size].filter(Boolean).join('/') || '(default)'
          const qty = np.quantities[[color, size].filter(Boolean).join('/')] ?? 0
          if (qty > 0) hasPositive = true
          if (qty < 0) errors.push({ line: pIdx, sku: variantKey, field: 'quantity', reason: 'negative' })
          if (qty > MAX_QTY_PER_DELIVERY_LINE) {
            errors.push({ line: pIdx, sku: variantKey, field: 'quantity', reason: `exceeds_cap_${MAX_QTY_PER_DELIVERY_LINE}` })
          }
        }
      }
      if (!hasPositive) {
        errors.push({ line: pIdx, field: 'quantities', reason: 'all_zero' })
      }
    }

    // 2b. Existing items: batch-fetch variants so we can surface ALL
    //     invalid IDs at once, not one per retry.
    const variantIds = existingItems.map((i) => i.variantId).filter(Boolean)
    const foundVariants = variantIds.length > 0
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, sku: true, isActive: true },
        })
      : []
    const variantMap = new Map(foundVariants.map((v) => [v.id, v]))

    for (const [iIdx, item] of existingItems.entries()) {
      const idx = newProductRows.length + iIdx  // line index across the whole delivery
      if (!item.variantId) {
        errors.push({ line: idx, field: 'variantId', reason: 'missing' })
        continue
      }
      const v = variantMap.get(item.variantId)
      if (!v) {
        errors.push({ line: idx, sku: item.variantId, field: 'variantId', reason: 'not_found' })
        continue
      }
      if (!v.isActive) {
        errors.push({ line: idx, sku: v.sku, field: 'variant', reason: 'inactive' })
      }
      if (item.quantity === undefined || item.quantity === null) {
        errors.push({ line: idx, sku: v.sku, field: 'quantity', reason: 'missing' })
      } else if (item.quantity <= 0) {
        errors.push({ line: idx, sku: v.sku, field: 'quantity', reason: 'non_positive' })
      } else if (item.quantity > MAX_QTY_PER_DELIVERY_LINE) {
        errors.push({ line: idx, sku: v.sku, field: 'quantity', reason: `exceeds_cap_${MAX_QTY_PER_DELIVERY_LINE}` })
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'DeliveryValidationFailed',
        message: {
          de: `Lieferschein abgelehnt: ${errors.length} ungültige Zeile(n). Bitte alle Fehler korrigieren und erneut senden.`,
          en: `Delivery rejected: ${errors.length} invalid line(s). Please correct all errors and resubmit.`,
          ar: `تم رفض إذن التسليم: ${errors.length} صف(وف) غير صالح. يرجى تصحيح جميع الأخطاء وإعادة الإرسال.`,
        },
        data: { errors, maxQuantityPerLine: MAX_QTY_PER_DELIVERY_LINE },
      })
    }

    // ── 3. Atomic write transaction ──────────────────────────
    // Timeout bumped to 30s to accommodate 50+ line deliveries. Default
    // 5s is too tight once newProducts come into play (each is a
    // product + translations + variants + inventory rows).
    let result: {
      delivery: any
      createdProducts: Array<{ id: string; name: string }>
      restockedItems: Array<{ sku: string | null; name: string; qty: number }>
      deliveryNumber: string
      totalAmount: number
      totalItemCount: number
    }
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const deliveryNumber = await this.generateDeliveryNumber(tx)

        const createdProducts: Array<{ id: string; name: string }> = []
        type PendingDeliveryItem = {
          variantId: string
          productId: string
          isNewProduct: boolean
          productName: string
          sku: string | null
          color: string | null
          size: string | null
          quantity: number
          unitCost: number
          totalCost: number
          __warehouseForInventory: string
          __isNewVariantToday: boolean
        }
        const pendingItems: PendingDeliveryItem[] = []
        let totalAmount = 0
        let totalItemCount = 0

        // 3a. Create NEW products + variants inside tx (rollback on failure)
        for (const np of newProductRows) {
          const slug = np.productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
            + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

          let categoryId = np.categoryId
          if (!categoryId) {
            const defaultCat = await tx.category.findFirst({ orderBy: { createdAt: 'asc' } })
            if (!defaultCat) {
              throw new BadRequestException({
                statusCode: 400,
                error: 'NoCategoryAvailable',
                message: {
                  de: 'Keine Kategorie vorhanden. Bitte zuerst eine Kategorie anlegen.',
                  en: 'No category available. Please create a category first.',
                  ar: 'لا توجد فئة. يرجى إنشاء فئة أولاً.',
                },
              })
            }
            categoryId = defaultCat.id
          }

          const product = await tx.product.create({
            data: {
              slug,
              categoryId,
              basePrice: np.salePrice,
              isActive: false,
              translations: {
                create: [
                  { language: 'de', name: np.productNameDe || np.productName },
                  { language: 'en', name: np.productNameDe || np.productName },
                  { language: 'ar', name: np.productName },
                ],
              },
            },
          })
          createdProducts.push({ id: product.id, name: np.productName })

          const colors = np.colors.length ? np.colors : ['']
          const sizes = np.sizes.length ? np.sizes : ['']
          for (const color of colors) {
            for (const size of sizes) {
              const variantKey = [color, size].filter(Boolean).join('/')
              const qty = np.quantities[variantKey] ?? np.quantities[`${color}/${size}`] ?? 0
              if (qty <= 0) continue  // zero-qty combos in the matrix are legitimately skipped

              const sku = await this.generateSku(tx, color, size)
              const variant = await tx.productVariant.create({
                data: {
                  productId: product.id,
                  sku,
                  barcode: ensureVariantBarcode({ sku }),
                  color: color || null,
                  colorHex: color ? (np.colorHexes?.[color] ?? null) : null,
                  size: size || null,
                  purchasePrice: np.purchasePrice,
                },
              })

              const lineCost = np.purchasePrice * qty
              totalAmount += lineCost
              totalItemCount += qty

              pendingItems.push({
                variantId: variant.id,
                productId: product.id,
                isNewProduct: true,
                productName: np.productName,
                sku,
                color: color || null,
                size: size || null,
                quantity: qty,
                unitCost: np.purchasePrice,
                totalCost: lineCost,
                __warehouseForInventory: warehouse.id,
                __isNewVariantToday: true,
              })
            }
          }
        }

        // 3b. Existing items: purchase-price refresh, name lookup,
        //     build pending list (no inventory writes yet — we need
        //     the SupplierDeliveryItem ids first for referenceId).
        const existingVariantsDetail = existingItems.length > 0
          ? await tx.productVariant.findMany({
              where: { id: { in: existingItems.map((i) => i.variantId) } },
              include: {
                product: { select: { id: true, translations: { where: { language: 'de' }, select: { name: true } } } },
              },
            })
          : []
        const vDetailMap = new Map(existingVariantsDetail.map((v) => [v.id, v]))

        for (const item of existingItems) {
          const variant = vDetailMap.get(item.variantId)
          if (!variant) continue  // pre-validation guarantees this can't happen
          const unitCost = item.purchasePrice ?? Number(variant.purchasePrice ?? 0)

          if (item.purchasePrice !== undefined) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { purchasePrice: item.purchasePrice },
            })
          }

          const lineCost = unitCost * item.quantity
          totalAmount += lineCost
          totalItemCount += item.quantity

          const productName = variant.product.translations[0]?.name ?? 'Unbekannt'
          pendingItems.push({
            variantId: item.variantId,
            productId: variant.product.id,
            isNewProduct: false,
            productName,
            sku: variant.sku,
            color: variant.color,
            size: variant.size,
            quantity: item.quantity,
            unitCost,
            totalCost: lineCost,
            __warehouseForInventory: warehouse.id,
            __isNewVariantToday: false,
          })
        }

        // 3c. Create SupplierDelivery + nested items. DB generates UUIDs
        //     for each SupplierDeliveryItem which we then thread back into
        //     the InventoryMovement writes as referenceId.
        const deliveryPayloadItems = pendingItems.map((p) => ({
          variantId: p.variantId,
          productId: p.productId,
          isNewProduct: p.isNewProduct,
          productName: p.productName,
          sku: p.sku,
          color: p.color,
          size: p.size,
          quantity: p.quantity,
          unitCost: p.unitCost,
          totalCost: p.totalCost,
        }))

        const delivery = await tx.supplierDelivery.create({
          data: {
            supplierId: dto.supplierId,
            deliveryNumber,
            totalAmount,
            itemCount: totalItemCount,
            status: 'received',
            notes: dto.notes,
            receivedBy: adminId,
            items: { create: deliveryPayloadItems },
          },
          include: { items: true },
        })

        // 3d. Pair each DB-assigned SupplierDeliveryItem.id with its
        //     original sidecar fields. Prisma preserves insertion order
        //     for nested creates, so index-based pairing is safe here.
        if (delivery.items.length !== pendingItems.length) {
          // Defensive: should never happen. If it does, throw hard so the
          // whole tx rolls back rather than writing movements against
          // mismatched items.
          throw new Error(
            `SupplierDelivery items length mismatch (expected ${pendingItems.length}, got ${delivery.items.length})`,
          )
        }

        const restockedItems: Array<{ sku: string | null; name: string; qty: number }> = []

        // 3e. Inventory updates + InventoryMovement writes per item.
        //     Each movement gets referenceId = SupplierDeliveryItem.id,
        //     protected by the partial unique index from migration
        //     20260420_supplier_delivery_item_unique. Atomic increment on
        //     inventory.update returns the post-write onHand so movements
        //     always carry the true quantityAfter.
        for (let i = 0; i < delivery.items.length; i++) {
          const deliveryItem = delivery.items[i]
          const ctx = pendingItems[i]
          const variantId = deliveryItem.variantId!
          const warehouseId = ctx.__warehouseForInventory
          const qty = deliveryItem.quantity

          let beforeQty: number
          let afterQty: number

          if (ctx.__isNewVariantToday) {
            await tx.inventory.create({
              data: { variantId, warehouseId, quantityOnHand: qty },
            })
            beforeQty = 0
            afterQty = qty
          } else {
            let inv = await tx.inventory.findFirst({ where: { variantId, warehouseId } })
            if (!inv) {
              inv = await tx.inventory.create({
                data: { variantId, warehouseId, quantityOnHand: 0 },
              })
            }
            beforeQty = inv.quantityOnHand
            const updated = await tx.inventory.update({
              where: { id: inv.id },
              data: { quantityOnHand: { increment: qty } },
            })
            afterQty = updated.quantityOnHand
            restockedItems.push({ sku: ctx.sku, name: ctx.productName, qty })
          }

          await tx.inventoryMovement.create({
            data: {
              variantId,
              warehouseId,
              type: 'supplier_delivery',
              quantity: qty,
              quantityBefore: beforeQty,
              quantityAfter: afterQty,
              referenceId: deliveryItem.id,
              notes: `Wareneingang ${deliveryNumber} von ${supplier.name}`,
              createdBy: adminId,
            },
          })
        }

        return {
          delivery,
          createdProducts,
          restockedItems,
          deliveryNumber,
          totalAmount,
          totalItemCount,
        }
      }, { timeout: 30000, maxWait: 10000 })
    } catch (e: unknown) {
      // Partial unique-index violation on (reference_id, variant_id)
      // WHERE type='supplier_delivery' — translates to "this item has
      // already been booked via this delivery line". With the current
      // write path this can only surface if an upstream retry or an
      // internal bug attempts to re-process the same SupplierDeliveryItem
      // within a single service call. Never raised for legitimate separate
      // deliveries (each generates fresh item UUIDs). Translate to a 409
      // so the admin sees a clear explanation and the transaction's
      // rollback is already guaranteed by Prisma.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          statusCode: 409,
          error: 'SupplierDeliveryItemAlreadyBooked',
          message: {
            de: 'Diese Lieferschein-Zeile wurde bereits gebucht. Bitte die Übersicht neu laden und den Bestand prüfen.',
            en: 'This delivery line has already been booked. Please reload the overview and verify stock.',
            ar: 'تم حجز هذه السطر بالفعل. يرجى إعادة تحميل النظرة العامة والتحقق من المخزون.',
          },
        })
      }
      throw e
    }

    // ── 4. Audit log (outside tx — best-effort, must not roll back) ──
    try {
      await this.audit.log({
        adminId,
        action: 'SUPPLIER_DELIVERY_RECEIVED',
        entityType: 'supplier_delivery',
        entityId: result.delivery.id,
        changes: {
          after: {
            deliveryNumber: result.deliveryNumber,
            supplier: supplier.name,
            totalAmount: result.totalAmount,
            itemCount: result.totalItemCount,
            newProducts: result.createdProducts.length,
            restockedItems: result.restockedItems.length,
          },
        },
        ipAddress: ip,
      })
    } catch {}

    return {
      delivery: result.delivery,
      createdProducts: result.createdProducts,
      restockedItems: result.restockedItems,
      summary: {
        deliveryNumber: result.deliveryNumber,
        totalAmount: result.totalAmount,
        totalItemCount: result.totalItemCount,
        newProductsCreated: result.createdProducts.length,
        existingProductsRestocked: result.restockedItems.length,
      },
    }
  }

  // ── Supplier Deliveries ──────────────────────────────────────

  async getDeliveries(supplierId: string, limit = 50, offset = 0) {
    const [deliveries, total] = await Promise.all([
      this.prisma.supplierDelivery.findMany({
        where: { supplierId },
        include: { items: true },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.supplierDelivery.count({ where: { supplierId } }),
    ])

    // Enrich items with product images (color-matched)
    const productIds = [...new Set(deliveries.flatMap((d) => d.items.map((i) => i.productId).filter(Boolean)))]
    const products = productIds.length > 0 ? await this.prisma.product.findMany({
      where: { id: { in: productIds as string[] } },
      select: {
        id: true,
        images: { select: { url: true, colorName: true }, orderBy: { sortOrder: 'asc' } },
      },
    }) : []
    // Map: productId → { colorName → url, default → first image url }
    const imageMap = new Map<string, { byColor: Map<string, string>; fallback: string | null }>()
    for (const p of products) {
      const byColor = new Map<string, string>()
      for (const img of p.images) {
        if (img.colorName && !byColor.has(img.colorName)) byColor.set(img.colorName, img.url)
      }
      imageMap.set(p.id, { byColor, fallback: p.images[0]?.url ?? null })
    }

    const enriched = deliveries.map((d) => ({
      ...d,
      items: d.items.map((item) => {
        const imgs = item.productId ? imageMap.get(item.productId) : null
        const image = imgs
          ? (item.color && imgs.byColor.get(item.color)) || imgs.fallback
          : null
        return { ...item, image }
      }),
    }))

    return { data: enriched, meta: { total, limit, offset } }
  }

  async getDeliveryDetail(deliveryId: string) {
    const delivery = await this.prisma.supplierDelivery.findUnique({
      where: { id: deliveryId },
      include: { supplier: true, items: true },
    })
    if (!delivery) throw new NotFoundException('Lieferung nicht gefunden')
    return delivery
  }

  async cancelDelivery(deliveryId: string, adminId: string, ip: string) {
    const delivery = await this.prisma.supplierDelivery.findUnique({
      where: { id: deliveryId },
      include: { supplier: true, items: true },
    })
    if (!delivery) throw new NotFoundException('Lieferung nicht gefunden')
    if (delivery.status === 'cancelled') throw new BadRequestException('Lieferung ist bereits storniert')

    // Revert stock for each item
    const reverted: { sku: string; quantity: number }[] = []
    for (const item of delivery.items) {
      if (!item.variantId || item.quantity <= 0) continue

      // Find inventory with highest stock for this variant
      const inv = await this.prisma.inventory.findFirst({
        where: { variantId: item.variantId },
        orderBy: { quantityOnHand: 'desc' },
      })
      if (!inv) continue

      const before = inv.quantityOnHand
      const after = Math.max(0, before - item.quantity)

      await this.prisma.inventory.update({
        where: { id: inv.id },
        data: { quantityOnHand: after },
      })

      await this.prisma.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          warehouseId: inv.warehouseId,
          type: 'stocktake_adjustment',
          quantity: -(item.quantity),
          quantityBefore: before,
          quantityAfter: after,
          notes: `Storno Lieferung ${delivery.deliveryNumber}`,
          createdBy: adminId,
        },
      })

      reverted.push({ sku: item.sku ?? 'unknown', quantity: item.quantity })
    }

    // Mark delivery as cancelled
    await this.prisma.supplierDelivery.update({
      where: { id: deliveryId },
      data: { status: 'cancelled' },
    })

    // Recalculate supplier delivery statuses
    await this.updateDeliveryStatuses(delivery.supplierId)

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_DELIVERY_CANCELLED', entityType: 'supplier_delivery', entityId: deliveryId,
        changes: {
          after: {
            deliveryNumber: delivery.deliveryNumber,
            supplier: delivery.supplier.name,
            totalAmount: Number(delivery.totalAmount),
            itemsReverted: reverted.length,
          },
        },
        ipAddress: ip,
      })
    } catch {}

    return {
      cancelled: true,
      deliveryNumber: delivery.deliveryNumber,
      itemsReverted: reverted.length,
      totalReverted: reverted.reduce((s, r) => s + r.quantity, 0),
    }
  }

  // ── Payments ─────────────────────────────────────────────────

  async createPayment(dto: CreatePaymentDto, adminId: string, ip: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } })
    if (!supplier) throw new NotFoundException('Lieferant nicht gefunden')

    if (dto.amount <= 0) throw new BadRequestException('Betrag muss größer als 0 sein')

    const payment = await this.prisma.supplierPayment.create({
      data: {
        supplierId: dto.supplierId,
        amount: dto.amount,
        method: dto.method,
        notes: dto.notes,
        paidAt: dto.paidAt ?? new Date(),
        recordedBy: adminId,
      },
    })

    // Update delivery statuses
    await this.updateDeliveryStatuses(dto.supplierId)

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_PAYMENT', entityType: 'supplier', entityId: dto.supplierId,
        changes: { after: { amount: dto.amount, method: dto.method, supplier: supplier.name } },
        ipAddress: ip,
      })
    } catch {}

    return payment
  }

  async getPayments(supplierId: string, limit = 50, offset = 0) {
    const [payments, total] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where: { supplierId },
        orderBy: { paidAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.supplierPayment.count({ where: { supplierId } }),
    ])
    return { data: payments, meta: { total, limit, offset } }
  }

  async updatePayment(paymentId: string, dto: { amount?: number; method?: string; notes?: string; paidAt?: string }, adminId: string, ip: string) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId }, include: { supplier: { select: { name: true } } } })
    if (!payment) throw new NotFoundException('Zahlung nicht gefunden')

    const updated = await this.prisma.supplierPayment.update({
      where: { id: paymentId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.method ? { method: dto.method } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.paidAt ? { paidAt: new Date(dto.paidAt) } : {}),
      },
    })

    await this.updateDeliveryStatuses(payment.supplierId)

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_PAYMENT_UPDATED', entityType: 'supplier', entityId: payment.supplierId,
        changes: { before: { amount: Number(payment.amount), method: payment.method }, after: { amount: dto.amount ?? Number(payment.amount), method: dto.method ?? payment.method } },
        ipAddress: ip,
      })
    } catch {}

    return updated
  }

  async deletePayment(paymentId: string, adminId: string, ip: string) {
    const payment = await this.prisma.supplierPayment.findUnique({ where: { id: paymentId }, include: { supplier: { select: { name: true } } } })
    if (!payment) throw new NotFoundException('Zahlung nicht gefunden')

    await this.prisma.supplierPayment.delete({ where: { id: paymentId } })
    await this.updateDeliveryStatuses(payment.supplierId)

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_PAYMENT_DELETED', entityType: 'supplier', entityId: payment.supplierId,
        changes: { before: { amount: Number(payment.amount), method: payment.method, supplier: payment.supplier.name } },
        ipAddress: ip,
      })
    } catch {}

    return { deleted: true }
  }

  // ── Timeline (Lieferungen + Zahlungen chronologisch) ────────

  async getTimeline(supplierId: string) {
    const [deliveries, payments] = await Promise.all([
      this.prisma.supplierDelivery.findMany({
        where: { supplierId },
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true, deliveryNumber: true, totalAmount: true, itemCount: true, status: true, receivedAt: true,
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: { supplierId },
        orderBy: { paidAt: 'desc' },
        select: { id: true, amount: true, method: true, notes: true, paidAt: true },
      }),
    ])

    const timeline = [
      ...deliveries.map((d) => ({
        type: 'delivery' as const,
        id: d.id,
        date: d.receivedAt,
        amount: Number(d.totalAmount),
        label: d.deliveryNumber,
        detail: `${d.itemCount} Artikel`,
        status: d.status,
      })),
      ...payments.map((p) => ({
        type: 'payment' as const,
        id: p.id,
        date: p.paidAt,
        amount: -Number(p.amount),
        label: p.method === 'cash' ? 'Barzahlung' : 'Überweisung',
        detail: p.notes ?? '',
        status: 'paid',
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Running balance
    let balance = 0
    const withBalance = [...timeline].reverse().map((entry) => {
      balance += entry.amount
      return { ...entry, runningBalance: balance }
    }).reverse()

    return withBalance
  }

  // ── Overdue Warnings ─────────────────────────────────────────

  async getOverdueWarnings() {
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      include: {
        deliveries: {
          where: { status: { not: 'paid' } },
          orderBy: { receivedAt: 'asc' },
          take: 1,
          select: { receivedAt: true, totalAmount: true },
        },
      },
    })

    const warnings: any[] = []
    const now = new Date()

    for (const s of suppliers) {
      if (!s.deliveries.length) continue

      const [deliveryAgg, paymentAgg] = await Promise.all([
        this.prisma.supplierDelivery.aggregate({ where: { supplierId: s.id, status: { not: 'cancelled' } }, _sum: { totalAmount: true } }),
        this.prisma.supplierPayment.aggregate({ where: { supplierId: s.id }, _sum: { amount: true } }),
      ])

      const balance = Number(deliveryAgg._sum.totalAmount ?? 0) - Number(paymentAgg._sum.amount ?? 0)
      if (balance <= 0) continue

      const oldestUnpaid = s.deliveries[0].receivedAt
      const daysSince = Math.floor((now.getTime() - oldestUnpaid.getTime()) / (1000 * 60 * 60 * 24))

      if (daysSince >= 30) {
        warnings.push({
          supplierId: s.id,
          supplierName: s.name,
          balance,
          daysSince,
          level: daysSince >= 60 ? 'critical' : 'warning',
          oldestUnpaidDate: oldestUnpaid,
        })
      }
    }

    return warnings.sort((a, b) => b.daysSince - a.daysSince)
  }

  // ── Stats ────────────────────────────────────────────────────

  async getStats() {
    const [supplierCount, totalDeliveries, totalPayments, pendingProducts] = await Promise.all([
      this.prisma.supplier.count({ where: { isActive: true } }),
      this.prisma.supplierDelivery.aggregate({ where: { status: { not: 'cancelled' } }, _sum: { totalAmount: true }, _count: true }),
      this.prisma.supplierPayment.aggregate({ _sum: { amount: true } }),
      this.prisma.product.count({ where: { isActive: false } }),
    ])

    const totalOwed = Number(totalDeliveries._sum.totalAmount ?? 0) - Number(totalPayments._sum.amount ?? 0)

    return {
      supplierCount,
      totalDeliveryCount: totalDeliveries._count,
      totalDeliveryAmount: Number(totalDeliveries._sum.totalAmount ?? 0),
      totalPaymentAmount: Number(totalPayments._sum.amount ?? 0),
      totalOwed: Math.max(0, totalOwed),
      pendingProducts,
    }
  }

  // ── Product search for receiving ─────────────────────────────

  async searchProducts(query: string, lang: string = 'de', warehouseId?: string) {
    // Load the requested language + German as a fallback so Arabic
    // and English admins don't see "Unbekannt" when a product has
    // no AR/EN translation yet. The frontend picks the right one
    // from the returned productName string.
    const locale = (['de', 'en', 'ar'] as const).includes(lang as any) ? (lang as 'de' | 'en' | 'ar') : 'de'
    // Inventory filter: when warehouseId is provided (transfer flow,
    // goods receiving into a specific warehouse), only load the stock
    // row for that warehouse so the returned `stock` field is the
    // warehouse-specific count — not the total across all locations.
    // Without this filter, the transfer page's "Bestand" column was
    // summing Hamburg + Marzahn + Außenlager, so an admin transferring
    // 5 units from Hamburg saw a misleading 36 instead of the actual
    // Hamburg inventory.
    const variants = await this.prisma.productVariant.findMany({
      where: {
        product: { deletedAt: null },
        OR: [
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
          { product: { deletedAt: null, translations: { some: { name: { contains: query, mode: 'insensitive' } } } } },
        ],
      },
      include: {
        product: {
          select: {
            id: true, basePrice: true, isActive: true,
            translations: { select: { language: true, name: true } },
            images: { select: { url: true }, take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
        inventory: {
          select: { quantityOnHand: true, quantityReserved: true, warehouseId: true },
          ...(warehouseId ? { where: { warehouseId } } : {}),
        },
      },
      take: 20,
    })

    return variants.map((v) => {
      // Prefer the requested locale, fall back to German, then any
      // translation, then 'Unbekannt'.
      const localeName = v.product.translations.find((t) => t.language === locale)?.name
      const germanName = v.product.translations.find((t) => t.language === 'de')?.name
      const anyName = v.product.translations[0]?.name
      // When warehouseId was passed, v.inventory contains at most one row
      // (the target warehouse) so the reduce degenerates to that row's
      // available stock. When not passed, it sums everything as before.
      // Available stock = onHand - reserved (don't count already-reserved
      // units as transferable — you can't move goods that belong to an
      // active order).
      const stock = v.inventory.reduce(
        (s, i) => s + Math.max(0, i.quantityOnHand - (i.quantityReserved ?? 0)),
        0,
      )
      return {
        variantId: v.id,
        productId: v.product.id,
        sku: v.sku,
        barcode: v.barcode,
        productName: localeName ?? germanName ?? anyName ?? 'Unbekannt',
        color: v.color,
        size: v.size,
        purchasePrice: v.purchasePrice ? Number(v.purchasePrice) : null,
        salePrice: Number(v.product.basePrice),
        stock,
        image: v.product.images[0]?.url ?? null,
      }
    })
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async updateDeliveryStatuses(supplierId: string) {
    const [deliveryAgg, paymentAgg] = await Promise.all([
      this.prisma.supplierDelivery.aggregate({ where: { supplierId, status: { not: 'cancelled' } }, _sum: { totalAmount: true } }),
      this.prisma.supplierPayment.aggregate({ where: { supplierId }, _sum: { amount: true } }),
    ])

    const totalDebt = Number(deliveryAgg._sum.totalAmount ?? 0)
    const totalPaid = Number(paymentAgg._sum.amount ?? 0)

    if (totalPaid >= totalDebt) {
      await this.prisma.supplierDelivery.updateMany({
        where: { supplierId, status: { notIn: ['paid', 'cancelled'] } },
        data: { status: 'paid' },
      })
    } else if (totalPaid > 0) {
      // Mark oldest deliveries as paid until we run out of payment
      const deliveries = await this.prisma.supplierDelivery.findMany({
        where: { supplierId, status: { not: 'cancelled' } },
        orderBy: { receivedAt: 'asc' },
      })

      let remaining = totalPaid
      for (const d of deliveries) {
        const dAmount = Number(d.totalAmount)
        if (remaining >= dAmount) {
          await this.prisma.supplierDelivery.update({ where: { id: d.id }, data: { status: 'paid' } })
          remaining -= dAmount
        } else if (remaining > 0) {
          await this.prisma.supplierDelivery.update({ where: { id: d.id }, data: { status: 'partially_paid' } })
          remaining = 0
        } else {
          await this.prisma.supplierDelivery.update({ where: { id: d.id }, data: { status: 'received' } })
        }
      }
    }
  }

  // ── Countries list ───────────────────────────────────────────

  async getCountries() {
    const result = await this.prisma.supplier.findMany({
      where: { country: { not: null }, isActive: true },
      select: { country: true },
      distinct: ['country'],
      orderBy: { country: 'asc' },
    })
    return result.map((r) => r.country).filter(Boolean)
  }
}
