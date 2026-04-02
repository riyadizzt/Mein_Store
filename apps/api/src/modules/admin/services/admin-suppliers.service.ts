import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'

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

  private async generateSku(color: string, size: string): Promise<string> {
    const seq = await this.prisma.skuSequence.upsert({
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

  private async generateDeliveryNumber(): Promise<string> {
    const year = new Date().getFullYear()

    const seq = await this.prisma.supplierDeliverySequence.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', year, lastNum: 1 },
      update: {
        lastNum: { increment: 1 },
        ...(year !== undefined ? {} : {}),
      },
    })

    // Reset if new year
    if (seq.year !== year) {
      const reset = await this.prisma.supplierDeliverySequence.update({
        where: { id: 'singleton' },
        data: { year, lastNum: 1 },
      })
      return `WE-${year}-${String(reset.lastNum).padStart(5, '0')}`
    }

    return `WE-${year}-${String(seq.lastNum).padStart(5, '0')}`
  }

  // ── Wareneingang (Receiving) ─────────────────────────────────

  async createDelivery(dto: CreateDeliveryDto, adminId: string, ip: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } })
    if (!supplier) throw new NotFoundException('Lieferant nicht gefunden')

    const deliveryNumber = await this.generateDeliveryNumber()
    const deliveryItems: any[] = []
    const createdProducts: any[] = []
    const restockedItems: any[] = []
    let totalAmount = 0
    let totalItemCount = 0

    // Find target warehouse: user-selected or default
    const warehouse = dto.warehouseId
      ? await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } })
      : await this.prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    if (!warehouse) throw new BadRequestException('Kein aktives Lager gefunden')

    // ── Process NEW products ──────────────────────────────────
    if (dto.newProducts?.length) {
      for (const np of dto.newProducts) {
        // Create product as INACTIVE
        const slug = np.productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') + '-' + Date.now().toString(36)

        // Get default category if none provided
        let categoryId = np.categoryId
        if (!categoryId) {
          const defaultCat = await this.prisma.category.findFirst({ orderBy: { createdAt: 'asc' } })
          if (!defaultCat) throw new BadRequestException('Keine Kategorie vorhanden. Bitte zuerst eine Kategorie anlegen.')
          categoryId = defaultCat.id
        }

        const product = await this.prisma.product.create({
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

        // Create variants for each color/size combo
        for (const color of np.colors.length ? np.colors : ['']) {
          for (const size of np.sizes.length ? np.sizes : ['']) {
            const variantKey = [color, size].filter(Boolean).join('/')
            const qty = np.quantities[variantKey] ?? np.quantities[`${color}/${size}`] ?? 0
            if (qty <= 0) continue

            const sku = await this.generateSku(color, size)

            const variant = await this.prisma.productVariant.create({
              data: {
                productId: product.id,
                sku,
                barcode: sku,
                color: color || null,
                size: size || null,
                purchasePrice: np.purchasePrice,
              },
            })

            // Create inventory
            await this.prisma.inventory.create({
              data: {
                variantId: variant.id,
                warehouseId: warehouse.id,
                quantityOnHand: qty,
              },
            })

            // Create inventory movement
            await this.prisma.inventoryMovement.create({
              data: {
                variantId: variant.id,
                warehouseId: warehouse.id,
                type: 'supplier_delivery',
                quantity: qty,
                quantityBefore: 0,
                quantityAfter: qty,
                notes: `Wareneingang ${deliveryNumber} von ${supplier.name}`,
                createdBy: adminId,
              },
            })

            const lineCost = np.purchasePrice * qty
            totalAmount += lineCost
            totalItemCount += qty

            deliveryItems.push({
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
            })
          }
        }

        createdProducts.push({ id: product.id, name: np.productName })
      }
    }

    // ── Process EXISTING products ─────────────────────────────
    if (dto.existingItems?.length) {
      for (const item of dto.existingItems) {
        const variant = await this.prisma.productVariant.findUnique({
          where: { id: item.variantId },
          include: {
            product: { select: { id: true, translations: { where: { language: 'de' }, select: { name: true } } } },
          },
        })
        if (!variant) continue

        // Update purchasePrice if provided
        if (item.purchasePrice !== undefined) {
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { purchasePrice: item.purchasePrice },
          })
        }

        const unitCost = item.purchasePrice ?? Number(variant.purchasePrice ?? 0)

        // Find inventory: in target warehouse if specified, else any with highest stock
        let inv = dto.warehouseId
          ? await this.prisma.inventory.findFirst({ where: { variantId: item.variantId, warehouseId: warehouse.id } })
          : await this.prisma.inventory.findFirst({ where: { variantId: item.variantId }, orderBy: [{ quantityOnHand: 'desc' }] })

        if (!inv) {
          inv = await this.prisma.inventory.create({
            data: { variantId: item.variantId, warehouseId: warehouse.id, quantityOnHand: 0 },
          })
        }

        const before = inv.quantityOnHand
        await this.prisma.inventory.update({
          where: { id: inv.id },
          data: { quantityOnHand: { increment: item.quantity } },
        })

        await this.prisma.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            warehouseId: inv.warehouseId,
            type: 'supplier_delivery',
            quantity: item.quantity,
            quantityBefore: before,
            quantityAfter: before + item.quantity,
            notes: `Wareneingang ${deliveryNumber} von ${supplier.name}`,
            createdBy: adminId,
          },
        })

        const lineCost = unitCost * item.quantity
        totalAmount += lineCost
        totalItemCount += item.quantity

        const productName = variant.product.translations[0]?.name ?? 'Unbekannt'
        deliveryItems.push({
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
        })

        restockedItems.push({ sku: variant.sku, name: productName, qty: item.quantity })
      }
    }

    // Create delivery record
    const delivery = await this.prisma.supplierDelivery.create({
      data: {
        supplierId: dto.supplierId,
        deliveryNumber,
        totalAmount,
        itemCount: totalItemCount,
        status: 'received',
        notes: dto.notes,
        receivedBy: adminId,
        items: { create: deliveryItems },
      },
      include: { items: true },
    })

    try {
      await this.audit.log({
        adminId, action: 'SUPPLIER_DELIVERY_RECEIVED', entityType: 'supplier_delivery', entityId: delivery.id,
        changes: {
          after: {
            deliveryNumber,
            supplier: supplier.name,
            totalAmount,
            itemCount: totalItemCount,
            newProducts: createdProducts.length,
            restockedItems: restockedItems.length,
          },
        },
        ipAddress: ip,
      })
    } catch {}

    return {
      delivery,
      createdProducts,
      restockedItems,
      summary: {
        deliveryNumber,
        totalAmount,
        totalItemCount,
        newProductsCreated: createdProducts.length,
        existingProductsRestocked: restockedItems.length,
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

  async searchProducts(query: string) {
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
            translations: { where: { language: 'de' }, select: { name: true } },
            images: { select: { url: true }, take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
        inventory: { select: { quantityOnHand: true } },
      },
      take: 20,
    })

    return variants.map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      sku: v.sku,
      barcode: v.barcode,
      productName: v.product.translations[0]?.name ?? 'Unbekannt',
      color: v.color,
      size: v.size,
      purchasePrice: v.purchasePrice ? Number(v.purchasePrice) : null,
      salePrice: Number(v.product.basePrice),
      stock: v.inventory.reduce((s, i) => s + i.quantityOnHand, 0),
      image: v.product.images[0]?.url ?? null,
    }))
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
