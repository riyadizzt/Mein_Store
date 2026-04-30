import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { NotificationService } from './notification.service'
import { AuditService } from './audit.service'
import { EmailService } from '../../email/email.service'
import { DHLProvider } from '../../shipments/providers/dhl.provider'
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service'
import { buildReturnPayloadBase } from '../../webhooks/payload-builders/return'
import type { WebhookEventType } from '../../webhooks/events'
import { calculateProportionalRefund } from '../../../common/helpers/refund-calc'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

// ── Types ────────────────────────────────────────────────────

interface ReturnFindAllQuery {
  status?: string
  search?: string
  reason?: string
  limit?: number
  offset?: number
}

interface InspectItemInput {
  itemId: string
  condition: 'ok' | 'damaged'
  // Optional admin-override for the target warehouse. If not set,
  // restockItem() runs through a fallback chain:
  //   1. Scanner-movement warehouse (derived from 'Return scan: <RET-NR>' notes)
  //   2. Last reservation warehouse for (orderId, variantId)
  //   3. Default warehouse (isDefault=true)
  // When the admin explicitly picks a warehouse in the inspect UI, that wins.
  warehouseId?: string
}

interface ReturnItemJson {
  itemId: string
  sku?: string
  name?: string
  quantity: number
  unitPrice: number
  variantId?: string
  condition?: string
  productId?: string
}

// ── Valid Status Transitions (STRICT) ────────────────────────
//
// requested  → label_sent (approve) OR rejected
// label_sent → in_transit OR received (skip transit)
// in_transit → received
// received   → inspected
// inspected  → refunded (processRefund) OR rejected
//

const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ['in_transit', 'label_sent', 'rejected'],
  label_sent: ['in_transit', 'received'],
  in_transit: ['received'],
  received: ['inspected'],
  inspected: ['refunded', 'rejected'],
}

@Injectable()
export class AdminReturnsService {
  private readonly logger = new Logger(AdminReturnsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationService: NotificationService,
    private readonly audit: AuditService,
    private readonly emailService: EmailService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => DHLProvider)) private readonly dhlProvider: DHLProvider,
    // Optional webhook wiring — null-safe, never required.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Fire-and-forget return-webhook emit — used by approve/received/refunded.
   * Builds the base payload from the DB, merges event-specific extras, emits.
   * Never awaited, never throws.
   */
  private emitReturnWebhook(
    eventType: Extract<WebhookEventType, 'return.requested' | 'return.approved' | 'return.received' | 'return.refunded'>,
    returnId: string,
    extras: Record<string, unknown> = {},
  ): void {
    if (!this.webhookDispatcher) return
    const appUrl = this.config?.get<string>('APP_URL', 'https://malak-bekleidung.com') ?? 'https://malak-bekleidung.com'
    buildReturnPayloadBase(this.prisma, returnId, appUrl)
      .then((base) => {
        if (!base) return undefined
        return this.webhookDispatcher!.emit(eventType, { ...base, ...extras } as any)
      })
      .catch((err) => this.logger.warn(`${eventType} webhook failed: ${err?.message ?? err}`))
  }

  // ── 1. findAll ─────────────────────────────────────────────

  async findAll(query: ReturnFindAllQuery) {
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0

    const where: Record<string, unknown> = {}

    if (query.status) {
      where.status = query.status
    }

    if (query.reason) {
      where.reason = query.reason
    }

    if (query.search) {
      where.OR = [
        { returnNumber: { contains: query.search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: query.search, mode: 'insensitive' } } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        include: {
          order: {
            select: {
              orderNumber: true,
              totalAmount: true,
              createdAt: true,
              items: {
                select: {
                  id: true,
                  snapshotName: true,
                  snapshotSku: true,
                  quantity: true,
                  unitPrice: true,
                  totalPrice: true,
                  variant: { select: { id: true, color: true, size: true, product: { select: { images: { select: { url: true }, take: 1 } } } } },
                },
              },
              user: { select: { firstName: true, lastName: true, email: true } },
              payment: { select: { provider: true, method: true, status: true, providerPaymentId: true } },
            },
          },
          shipment: { select: { trackingNumber: true, carrier: true, deliveredAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ])

    return {
      data,
      meta: { total, limit, offset },
    }
  }

  // ── 2. findOne ─────────────────────────────────────────────

  async findOne(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            subtotal: true,
            shippingCost: true,
            taxAmount: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                variantId: true,
                snapshotName: true,
                snapshotSku: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                variant: { select: { id: true, color: true, size: true, sku: true } },
              },
            },
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                preferredLang: true,
              },
            },
            payment: {
              select: {
                id: true,
                provider: true,
                method: true,
                status: true,
                providerPaymentId: true,
                amount: true,
                // Refund rows are needed so the UI can render the
                // "Banküberweisung ausgeführt" button for Vorkasse refunds
                // that are still PENDING (the admin-driven manual-transfer
                // confirmation flow — see markRefundTransferred).
                refunds: {
                  select: {
                    id: true,
                    status: true,
                    amount: true,
                    processedAt: true,
                    createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
        shipment: { select: { trackingNumber: true, carrier: true, deliveredAt: true } },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    // Enrich with timeline from audit log
    const timeline = await this.audit.getByEntity('return', id)

    return { ...ret, timeline }
  }

  // ── 3. generateReturnNumber ────────────────────────────────

  async generateReturnNumber(): Promise<string> {
    const year = new Date().getFullYear().toString()
    const yearKey = `RET-${year}`

    const result = await this.prisma.$queryRaw<Array<{ seq: number }>>`
      INSERT INTO return_sequences (year_key, seq)
      VALUES (${yearKey}, 1)
      ON CONFLICT (year_key) DO UPDATE SET seq = return_sequences.seq + 1
      RETURNING seq
    `

    const seq = result[0].seq
    return `RET-${year}-${String(seq).padStart(5, '0')}`
  }

  // ── 4. approve ─────────────────────────────────────────────

  async approve(id: string, adminId: string, ip: string, sendLabel: boolean = false) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            user: { select: { email: true, firstName: true, lastName: true, preferredLang: true } },
            shippingAddress: { select: { firstName: true, lastName: true, street: true, houseNumber: true, postalCode: true, city: true, country: true } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    this.validateTransition(ret.status, 'in_transit')

    // Assign return number if not yet set
    const returnNumber = ret.returnNumber ?? await this.generateReturnNumber()

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'in_transit',
        returnNumber,
        approvedAt: new Date(),
        approvedBy: adminId,
        adminNotes: sendLabel ? 'shop_pays_shipping' : 'customer_pays_shipping',
      },
    })

    // Side effects — wrapped in try/catch to not block the main flow
    try {
      this.eventEmitter.emit('return.status_changed', {
        returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'in_transit', adminId,
      })
    } catch (e: any) { this.logger.error(`Event emit failed: ${e.message}`) }

    // Generate DHL return shipping label if shop pays, otherwise internal barcode label
    let labelPdfBuffer: Buffer | null = null
    let dhlTrackingNumber: string | null = null
    if (sendLabel) {
      try {
        const addr = ret.order.shippingAddress
        const userName = `${ret.order.user?.firstName ?? ''} ${ret.order.user?.lastName ?? ''}`.trim() || 'Kunde'
        const result = await this.dhlProvider.createReturnLabel({
          orderId: ret.orderId,
          returnNumber: returnNumber,
          originalTrackingNumber: ret.returnTrackingNumber ?? '',
          senderName: addr ? `${addr.firstName} ${addr.lastName}` : userName,
          street: addr?.street ?? '',
          houseNumber: addr?.houseNumber ?? '',
          postalCode: addr?.postalCode ?? '',
          city: addr?.city ?? '',
          country: addr?.country ?? 'DE',
          weight: 1000,
        })
        labelPdfBuffer = result.returnLabelPdf
        dhlTrackingNumber = result.returnTrackingNumber
        // Store DHL tracking number + QR code on return
        await this.prisma.return.update({
          where: { id },
          data: {
            returnTrackingNumber: dhlTrackingNumber,
            returnLabelUrl: result.qrCodeBase64 ? `qr:${result.qrCodeBase64}` : undefined,
          },
        })
        this.logger.log(`DHL return label created for ${returnNumber}: ${dhlTrackingNumber}${result.qrCodeBase64 ? ' +QR' : ''}`)
      } catch (e: any) {
        this.logger.error(`DHL return label failed: ${e.message}`)
        // Fallback: generate internal label
        try {
          labelPdfBuffer = await this.generateReturnLabel(id)
          this.logger.log(`Fallback: internal label generated for ${returnNumber}`)
        } catch (e2: any) { this.logger.error(`Internal label also failed: ${e2.message}`) }
      }
    }

    try {
      const customerEmail = ret.order.user?.email
      const lang = ret.order.user?.preferredLang ?? 'de'
      if (customerEmail) {
        const emailData: any = {
          firstName: ret.order.user?.firstName ?? '',
          returnNumber,
          orderNumber: ret.order.orderNumber,
          status: 'approved',
          returnAddress: await this.getReturnAddress(),
          message: this.getStatusMessage('label_sent', lang),
          sendLabel,
        }
        const attachments = labelPdfBuffer
          ? [{ filename: `Ruecksendeetikett-${returnNumber}.pdf`, contentBase64: labelPdfBuffer.toString('base64'), contentType: 'application/pdf' }]
          : undefined
        await this.emailService.enqueue({
          to: customerEmail, type: 'return-confirmation' as any, lang,
          data: emailData,
          attachments,
        })
      }
    } catch (e: any) { this.logger.error(`Email failed: ${e.message}`) }

    try {
      await this.notificationService.createForAllAdmins({
        type: 'return_approved', title: `Retoure ${returnNumber} genehmigt`,
        body: `Retoure für Bestellung ${ret.order.orderNumber} wurde genehmigt.`, entityType: 'return', entityId: id,
        // Data payload so the frontend bell can render the title+body in
        // the viewing admin's locale (DE title/body persisted as fallback).
        data: {
          returnId: id,
          orderId: ret.orderId,
          orderNumber: ret.order.orderNumber,
          returnNumber,
        },
      })
    } catch (e: any) { this.logger.error(`Notification failed: ${e.message}`) }

    try {
      await this.audit.log({
        adminId, action: 'RETURN_APPROVED', entityType: 'return', entityId: id,
        changes: { before: { status: ret.status }, after: { status: 'label_sent', returnNumber } }, ipAddress: ip,
      })
    } catch (e: any) { this.logger.error(`Audit failed: ${e.message}`) }

    // Fire-and-forget outbound webhook — return.approved.
    this.emitReturnWebhook('return.approved', id, {
      approvedAt: new Date().toISOString(),
      labelSent: sendLabel,
    })

    return updated
  }

  // ── 5. reject ──────────────────────────────────────────────

  async reject(id: string, reason: string, adminId: string, ip: string) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'RejectionReasonRequired',
        message: {
          de: 'Ein Ablehnungsgrund ist erforderlich.',
          en: 'A rejection reason is required.',
          ar: 'سبب الرفض مطلوب.',
        },
      })
    }

    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            user: { select: { email: true, firstName: true, preferredLang: true } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    // Can reject from 'requested' or 'inspected'
    this.validateTransition(ret.status, 'rejected')

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason: reason.trim(),
      },
    })

    // Safety: if the order was wrongly set to 'returned' at request time
    // (historical bug, fixed now), restore it to 'delivered' on rejection.
    try {
      const order = await this.prisma.order.findUnique({ where: { id: ret.orderId }, select: { status: true } })
      if (order?.status === 'returned') {
        await this.prisma.order.update({
          where: { id: ret.orderId },
          data: { status: 'delivered' },
        })
        this.logger.log(`Order ${ret.order.orderNumber} restored to 'delivered' after return rejection`)
      }
    } catch (e: any) {
      this.logger.error(`Failed to restore order status: ${e.message}`)
    }

    // Side effects (safe)
    try { this.eventEmitter.emit('return.status_changed', { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'rejected', adminId }) } catch (e: any) { this.logger.error(`Event: ${e.message}`) }
    try {
      const email = ret.order.user?.email; const lang = ret.order.user?.preferredLang ?? 'de'
      if (email) await this.emailService.enqueue({ to: email, type: 'return-confirmation' as any, lang, data: { firstName: ret.order.user?.firstName ?? '', returnNumber: ret.returnNumber ?? id.slice(0, 8), orderNumber: ret.order.orderNumber, status: 'rejected', rejectionReason: reason.trim(), message: this.getStatusMessage('rejected', lang) } })
    } catch (e: any) { this.logger.error(`Email: ${e.message}`) }
    try { await this.audit.log({ adminId, action: 'RETURN_REJECTED', entityType: 'return', entityId: id, changes: { before: { status: ret.status }, after: { status: 'rejected', rejectionReason: reason.trim() } }, ipAddress: ip }) } catch (e: any) { this.logger.error(`Audit: ${e.message}`) }

    return updated
  }

  // ── 6. markReceived ────────────────────────────────────────

  async markReceived(id: string, adminId: string, ip: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            user: { select: { email: true, firstName: true, preferredLang: true } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    this.validateTransition(ret.status, 'received')

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'received',
        receivedAt: new Date(),
      },
    })

    try { this.eventEmitter.emit('return.status_changed', { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'received', adminId }) } catch (e: any) { this.logger.error(`Event: ${e.message}`) }

    // Send email: "Paket eingetroffen, wird geprüft"
    const customerEmail = ret.order.user?.email
    const lang = ret.order.user?.preferredLang ?? 'de'

    if (customerEmail) {
      await this.emailService.enqueue({
        to: customerEmail,
        type: 'return-confirmation' as never,
        lang,
        data: {
          firstName: ret.order.user?.firstName ?? '',
          returnNumber: ret.returnNumber ?? id.slice(0, 8),
          orderNumber: ret.order.orderNumber,
          status: 'received',
          message: this.getStatusMessage('received', lang),
        },
      })
    }

    try { await this.audit.log({ adminId, action: 'RETURN_RECEIVED', entityType: 'return', entityId: id, changes: { before: { status: ret.status }, after: { status: 'received' } }, ipAddress: ip }) } catch (e: any) { this.logger.error(`Audit: ${e.message}`) }

    // Fire-and-forget outbound webhook — return.received.
    this.emitReturnWebhook('return.received', id, {
      receivedAt: new Date().toISOString(),
      // warehouseId unknown at this step — the inspect step is where the
      // scanner picks a target warehouse. We pass empty string rather than
      // null to keep the payload schema strict.
      warehouseId: '',
    })

    return updated
  }

  // ── 7. inspect ─────────────────────────────────────────────

  async inspect(
    id: string,
    items: InspectItemInput[],
    adminId: string,
    ip: string,
  ) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            // Financials needed for the proportional refund calculation.
            // The post-coupon, post-discount figures live here; items carry
            // pre-discount unitPrice × quantity snapshots that cannot be
            // blindly summed for a refund amount.
            subtotal: true,
            totalAmount: true,
            shippingCost: true,
            items: {
              select: {
                id: true,
                variantId: true,
                quantity: true,
                unitPrice: true,
                snapshotName: true,
                snapshotSku: true,
              },
            },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    this.validateTransition(ret.status, 'inspected')

    if (!items || items.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'NoItems',
        message: {
          de: 'Keine Artikel zur Prüfung angegeben.',
          en: 'No items provided for inspection.',
          ar: 'لم يتم تحديد أي عناصر للفحص.',
        },
      })
    }

    // Build maps of order items by ID AND variantId for flexible lookup
    const orderItemMap = new Map(
      ret.order.items.map((item) => [item.id, item]),
    )
    const orderItemByVariantMap = new Map(
      ret.order.items.filter((item) => item.variantId).map((item) => [item.variantId!, item]),
    )

    // Parse returnItems JSON to get return quantities
    const returnItems = (ret.returnItems as any[] | null) ?? []
    const returnQtyMap = new Map(
      returnItems.map((ri: any) => [ri.variantId, ri.quantity ?? 1]),
    )

    let dedupSkipCount = 0  // R10-B Teil 2: counts how many items had their restock skipped because the scanner already booked them
    let damagedRemovalCount = 0  // R10-B Teil 3: counts how many damaged items triggered a real onHand decrement
    const inspectionResults: Array<{
      itemId: string
      condition: string
      restocked: boolean
      amount: number
    }> = []
    // Items eligible for refund (condition='ok'). Damaged items don't flow
    // money back — the customer keeps the damaged goods' value at zero.
    const refundableItems: Array<{ unitPrice: number; quantity: number }> = []

    // Process each item
    for (const input of items) {
      // Try to find order item by ID first, then by variantId
      const orderItem = orderItemMap.get(input.itemId) ?? orderItemByVariantMap.get(input.itemId)
      if (!orderItem) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'InvalidItemId',
          message: {
            de: `Bestellposition ${input.itemId} nicht gefunden.`,
            en: `Order item ${input.itemId} not found.`,
            ar: `عنصر الطلب ${input.itemId} غير موجود.`,
          },
        })
      }

      // Use return quantity (partial return) if available, otherwise full order quantity
      const returnQty = (orderItem.variantId ? returnQtyMap.get(orderItem.variantId) : null) ?? orderItem.quantity
      const itemTotal = Number(orderItem.unitPrice) * returnQty

      if (input.condition === 'ok') {
        // Track this line for proportional refund calculation post-loop.
        // The old code summed itemTotal directly — that ignored the coupon
        // and crashed the provider refund when the sum exceeded the
        // captured amount. calculateProportionalRefund() scales by ratio.
        refundableItems.push({
          unitPrice: Number(orderItem.unitPrice),
          quantity: returnQty,
        })

        if (orderItem.variantId) {
          // R10-B Teil 2 — Dedup-Guard against double-restock.
          //
          // The state machine requires requested/in_transit → received → inspected,
          // and the Scanner-Flow (admin-inventory.service.ts:processReturnScan)
          // ALREADY restocked the item when it flipped the status to 'received'.
          // Without this guard, a condition='ok' call would create a SECOND
          // return_received movement — silently doubling onHand.
          //
          // Strategy: check if a scanner-movement exists for this (variant,
          // returnNumber) pair. If yes, the scanner has authoritative
          // inventory impact — we record the inspection (status transition)
          // but DO NOT add a second stock increment. Audit log records the
          // skip so the admin can always reconstruct what happened.
          //
          // If no scanner-movement exists (edge case: admin bypassed the
          // scanner step), restockItem() fires its usual fallback chain.
          const scannerAlreadyRestocked = await this.prisma.inventoryMovement.findFirst({
            where: {
              variantId: orderItem.variantId,
              type: 'return_received',
              notes: { startsWith: `Return scan: ${ret.returnNumber ?? id}` },
            },
            select: { id: true, warehouseId: true },
          })

          if (scannerAlreadyRestocked) {
            // Dedup wins — status transition happens below, no stock write.
            dedupSkipCount++
            this.logger.log(
              `Inspect OK for variant ${orderItem.variantId} on ${ret.returnNumber ?? id}: ` +
              `scanner already restocked in warehouse ${scannerAlreadyRestocked.warehouseId} — skipping second restock`,
            )
          } else {
            await this.restockItem(
              orderItem.variantId,
              returnQty,
              ret.orderId,
              ret.returnNumber ?? id,
              input.warehouseId,
            )
          }
        }

        inspectionResults.push({
          itemId: input.itemId,
          condition: 'ok',
          restocked: true,
          amount: itemTotal,
        })
      } else {
        // R10-B Teil 3 — Damaged-Pfad mit echtem Stock-Impact.
        //
        // Wenn der Scanner die Ware bereits eingebucht hat (normal flow),
        // wird hier aus dem Bestand dekrementiert — das spiegelt die
        // physische Realität wider: Ware kam an, wurde eingebucht, ist
        // aber defekt und verlässt den Verkaufsbestand. Kein Refund.
        //
        // Ohne Scanner-Vorbuchung bleibt das Verhalten wie vorher
        // (nur Movement-Dokumentation, kein onHand-Change).
        if (orderItem.variantId) {
          const result = await this.createDamagedMovement(
            orderItem.variantId,
            returnQty,
            ret.orderId,
            ret.returnNumber ?? id,
          )
          if (result.decremented) {
            damagedRemovalCount++
            this.logger.log(
              `Damaged removal for variant ${orderItem.variantId} on ${ret.returnNumber ?? id}: ` +
              `-${returnQty} from warehouse ${result.warehouseId}`,
            )
          }
        }

        inspectionResults.push({
          itemId: input.itemId,
          condition: 'damaged',
          restocked: false,
          amount: 0,
        })
      }
    }

    // ── Full-Return detection ────────────────────────────────────
    //
    // REGEL 1 applies (refund = totalAmount, shipping included) only when:
    //   (a) every order item is returned in full quantity (variantId match,
    //       returnQty >= orderQty), AND
    //   (b) every inspected item has condition='ok' — a damaged item means
    //       the customer keeps zero value for that line, so the refund is
    //       no longer "everything the customer paid", which is the whole
    //       point of REGEL 1, AND
    //   (c) no prior PROCESSED refund exists for this order (cancelItems,
    //       cancelWithRefund, or an earlier return would all bump us into
    //       partial mode — single-refund-per-order business assumption).
    //
    // Legacy orders without variantIds on all items fall back to partial
    // for safety — we can't prove full coverage without the variant link.
    const priorRefund = await this.prisma.refund.findFirst({
      where: { payment: { orderId: ret.orderId }, status: 'PROCESSED' },
      select: { id: true },
    })

    const allItemsCovered =
      ret.order.items.length > 0 &&
      ret.order.items.every((oi) => {
        if (!oi.variantId) return false
        const returnedQty = returnQtyMap.get(oi.variantId) ?? 0
        return returnedQty >= oi.quantity
      })

    const allInspectedOk = items.every((i) => i.condition === 'ok')

    const isFullReturn = !priorRefund && allItemsCovered && allInspectedOk

    const refundAmount = calculateProportionalRefund({
      returnedItems: refundableItems,
      order: {
        subtotal: Number(ret.order.subtotal),
        totalAmount: Number(ret.order.totalAmount),
        shippingCost: Number(ret.order.shippingCost),
      },
      isFullReturn,
    })

    // Update return with inspection data and calculated refund amount
    const existingReturnItems = (ret.returnItems as ReturnItemJson[] | null) ?? []
    const updatedReturnItems = existingReturnItems.map((ri) => {
      const inspection = items.find((i) => i.itemId === ri.itemId)
      if (inspection) {
        return { ...ri, condition: inspection.condition }
      }
      return ri
    })

    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'inspected',
        inspectedAt: new Date(),
        inspectedBy: adminId,
        refundAmount,
        // Clear any stale provider-error from a prior failed refund attempt.
        // A fresh inspection supersedes the old computation.
        refundError: null,
        returnItems: updatedReturnItems as unknown as undefined,
      },
    })

    try { this.eventEmitter.emit('return.status_changed', { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'inspected', adminId, refundAmount }) } catch (e: any) { this.logger.error(`Event: ${e.message}`) }

    try { await this.audit.log({ adminId, action: 'RETURN_INSPECTED', entityType: 'return', entityId: id, changes: { before: { status: ret.status }, after: { status: 'inspected', refundAmount, isFullReturn } }, ipAddress: ip }) } catch (e: any) { this.logger.error(`Audit: ${e.message}`) }

    // R10-B Teil 2: log a dedicated audit entry when the dedup-guard skipped a
    // second restock. This is a signal (not a failure) — it means the Scanner
    // and Inspect flows operated in the expected sequence. The entry is ONLY
    // written when items were actually skipped, so a "normal" inspect without
    // prior scanner (legacy orders / edge case) leaves no noise in the log.
    if (dedupSkipCount > 0) {
      try {
        await this.audit.log({
          adminId,
          action: 'RETURN_INSPECTED_NO_DOUBLE_RESTOCK',
          entityType: 'return',
          entityId: id,
          changes: {
            after: {
              itemsSkipped: dedupSkipCount,
              totalItems: items.length,
              reason: 'scanner_already_restocked',
            },
          },
          ipAddress: ip,
        })
      } catch (e: any) {
        this.logger.error(`Audit (dedup-skip): ${e.message}`)
      }
    }

    // R10-B Teil 3: separate audit trail for damaged-removal (real decrement).
    // Fires only when at least one damaged item was taken OUT of stock after
    // a prior scanner-restock — the compliance-relevant event from an
    // inventory-integrity standpoint.
    if (damagedRemovalCount > 0) {
      try {
        await this.audit.log({
          adminId,
          action: 'RETURN_DAMAGED_REMOVED_FROM_STOCK',
          entityType: 'return',
          entityId: id,
          changes: {
            after: {
              itemsRemoved: damagedRemovalCount,
              totalItems: items.length,
              reason: 'damaged_after_scanner_restock',
            },
          },
          ipAddress: ip,
        })
      } catch (e: any) {
        this.logger.error(`Audit (damaged-removal): ${e.message}`)
      }
    }

    return updated
  }

  // ── 8. processRefund (1-CLICK BUTTON) ──────────────────────

  async processRefund(id: string, adminId: string, ip: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            // Financials for the legacy-fallback refund recalculation
            // (see below). Inspect() already sets refundAmount correctly
            // for fresh returns; these fields are only touched when the
            // persisted amount is missing/zero.
            subtotal: true,
            totalAmount: true,
            shippingCost: true,
            items: { select: { variantId: true, quantity: true } },
            user: { select: { id: true, email: true, firstName: true, preferredLang: true } },
            payment: {
              select: {
                id: true,
                orderId: true,
                status: true,
                amount: true,
                provider: true,
              },
            },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    this.validateTransition(ret.status, 'refunded')

    // CRITICAL: Prevent double-refund
    const existingRefund = await this.prisma.refund.findFirst({
      where: {
        payment: { orderId: ret.orderId },
        status: 'PROCESSED',
      },
    })

    if (existingRefund) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'RefundAlreadyProcessed',
        message: {
          de: 'Erstattung wurde bereits verarbeitet.',
          en: 'Refund already processed.',
          ar: 'تم معالجة الاسترداد بالفعل.',
        },
      })
    }

    // Validate payment exists
    const payment = ret.order.payment
    if (!payment) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'NoPaymentFound',
        message: {
          de: 'Keine Zahlung für diese Bestellung gefunden.',
          en: 'No payment found for this order.',
          ar: 'لم يتم العثور على دفع لهذا الطلب.',
        },
      })
    }

    // Calculate amount — recalculate from returnItems if refundAmount is 0.
    //
    // This fallback path is for legacy rows inspected before the proportional
    // refund helper landed (old rows may have refundAmount=null or 0). For
    // fresh returns, inspect() stores the correctly-scaled amount and this
    // branch is a no-op.
    //
    // Conservative: isFullReturn=false here. We cannot safely re-detect
    // full-return coverage at refund-time because a prior cancellation may
    // have removed items from order.items — triggering a false-positive
    // "covers all" when the origin of the discrepancy is pre-refund cancel,
    // not an actual full return. The partial formula is money-safe in both
    // cases (it scales proportionally).
    let refundAmountEur = Number(ret.refundAmount ?? 0)
    if (refundAmountEur <= 0) {
      const returnItems = (ret.returnItems as any[] | null) ?? []
      const legacyRefundables = returnItems
        .filter((ri: any) => (ri?.condition ?? 'ok') === 'ok')
        .map((ri: any) => ({
          unitPrice: Number(ri.unitPrice) || 0,
          quantity: ri.quantity || 1,
        }))
      refundAmountEur = calculateProportionalRefund({
        returnedItems: legacyRefundables,
        order: {
          subtotal: Number(ret.order.subtotal),
          totalAmount: Number(ret.order.totalAmount),
          shippingCost: Number(ret.order.shippingCost),
        },
        isFullReturn: false,
      })
      // Persist the recalculated amount so the UI and audit align
      if (refundAmountEur > 0) {
        await this.prisma.return.update({ where: { id }, data: { refundAmount: refundAmountEur } })
      }
    }

    if (refundAmountEur <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidRefundAmount',
        message: {
          de: 'Erstattungsbetrag muss größer als 0 sein. Bitte zuerst inspizieren.',
          en: 'Refund amount must be greater than 0. Please inspect first.',
          ar: 'يجب أن يكون مبلغ الاسترداد أكبر من 0. يرجى الفحص أولاً.',
        },
      })
    }

    const amountCents = Math.round(refundAmountEur * 100)
    const returnNumber = ret.returnNumber ?? id.slice(0, 8)

    // Call PaymentsService.createRefund — this AUTOMATICALLY creates:
    // - Stripe/Klarna/PayPal refund
    // - Gutschrift (GS-XXXX credit note) via InvoiceService
    // - Updates payment status (refunded / partially_refunded)
    //
    // CRITICAL: if this throws, the return MUST stay at status='inspected'.
    // The old code swallowed the error and still flipped the return to
    // 'refunded' + the order to 'returned' — leaving the system in a state
    // where the admin UI showed "refunded" but no money had moved. The
    // caller receives a 400 with the provider error so the admin UI can
    // surface a retry button. The persisted `refundError` column feeds
    // that UI and is cleared on the next successful attempt.
    try {
      await this.paymentsService.createRefund(
        {
          paymentId: payment.id,
          amount: amountCents,
          reason: `Return ${returnNumber}`,
          idempotencyKey: ret.id,
        },
        adminId,
        `return-refund-${ret.id}`,
      )
    } catch (e: any) {
      const errMsg = String(e?.message ?? 'Unknown provider error').slice(0, 500)
      this.logger.error(`Return refund failed for ${returnNumber}: ${errMsg}`)

      // Persist the error on the return. Status stays 'inspected' — the
      // retry flow reruns this same method and will clear the error on
      // success or overwrite it on another failure.
      try {
        await this.prisma.return.update({
          where: { id },
          data: { refundError: errMsg },
        })
      } catch (persistErr: any) {
        this.logger.error(`Failed to persist refundError for ${returnNumber}: ${persistErr.message}`)
      }

      try {
        await this.notificationService.create({
          type: 'refund_failed',
          title: `⚠ Retoure-Erstattung fehlgeschlagen: ${returnNumber}`,
          body: `Retoure genehmigt, aber Erstattung von €${(amountCents / 100).toFixed(2)} konnte nicht durchgeführt werden. Bitte manuell erstatten. Fehler: ${errMsg.slice(0, 100)}`,
          entityType: 'return', entityId: id, channel: 'admin',
          data: {
            kind: 'return',
            returnNumber,
            returnId: id,
            orderNumber: ret.order.orderNumber,
            orderId: ret.orderId,
            amount: amountCents / 100,
            error: errMsg.slice(0, 100),
          },
        })
      } catch (notifErr: any) {
        this.logger.error(`Notification failed for ${returnNumber}: ${notifErr.message}`)
      }

      try {
        await this.audit.log({
          adminId,
          action: 'RETURN_REFUND_FAILED',
          entityType: 'return',
          entityId: id,
          changes: {
            after: {
              returnNumber,
              orderNumber: ret.order.orderNumber,
              amount: amountCents / 100,
              provider: payment.provider ?? 'unknown',
              error: errMsg.slice(0, 200),
            },
          },
          ipAddress: ip,
        })
      } catch (auditErr: any) {
        this.logger.error(`Audit (refund-failed) for ${returnNumber}: ${auditErr.message}`)
      }

      throw new BadRequestException({
        statusCode: 400,
        error: 'RefundFailed',
        message: {
          de: `Erstattung fehlgeschlagen: ${errMsg.slice(0, 150)}`,
          en: `Refund failed: ${errMsg.slice(0, 150)}`,
          ar: `فشل الاسترداد: ${errMsg.slice(0, 150)}`,
        },
        data: { refundError: errMsg },
      })
    }

    // Update return status — refund succeeded, clear any stale error.
    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'refunded',
        refundedAt: new Date(),
        refundError: null,
      },
    })

    // NOW move the order to 'returned' — only at this point is the return
    // truly complete (money refunded). Previously this happened at request
    // time, which was wrong.
    try {
      await this.prisma.order.update({
        where: { id: ret.orderId },
        data: { status: 'returned' },
      })
    } catch (e: any) {
      this.logger.error(`Failed to update order status to returned: ${e.message}`)
    }

    try { this.eventEmitter.emit('return.status_changed', { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'refunded', adminId, refundAmount: refundAmountEur }) } catch (e: any) { this.logger.error(`Event: ${e.message}`) }

    // Send email to customer
    const customerEmail = ret.order.user?.email
    const lang = ret.order.user?.preferredLang ?? 'de'

    if (customerEmail) {
      await this.emailService.enqueue({
        to: customerEmail,
        type: 'return-confirmation' as never,
        lang,
        data: {
          firstName: ret.order.user?.firstName ?? '',
          returnNumber,
          orderNumber: ret.order.orderNumber,
          status: 'refunded',
          refundAmount: refundAmountEur.toFixed(2),
          message: this.getStatusMessage('refunded', lang),
        },
      })
    }

    try { await this.notificationService.createForAllAdmins({ type: 'return_refunded', title: `Erstattung ${returnNumber}`, body: `${refundAmountEur.toFixed(2)} EUR erstattet für Bestellung ${ret.order.orderNumber}.`, entityType: 'return', entityId: id, data: { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, returnNumber, refundAmount: refundAmountEur } }) } catch (e: any) { this.logger.error(`Notification: ${e.message}`) }
    try { await this.audit.log({ adminId, action: 'RETURN_REFUNDED', entityType: 'return', entityId: id, changes: { before: { status: ret.status }, after: { status: 'refunded', refundAmount: refundAmountEur } }, ipAddress: ip }) } catch (e: any) { this.logger.error(`Audit: ${e.message}`) }

    // Fire-and-forget outbound webhook — return.refunded.
    this.emitReturnWebhook('return.refunded', id, {
      refundedAt: new Date().toISOString(),
      paymentProvider: ret.order.payment?.provider ?? 'unknown',
    })

    this.logger.log(
      `Return ${returnNumber} refunded: ${refundAmountEur.toFixed(2)} EUR | order=${ret.order.orderNumber} | by=${adminId}`,
    )

    return updated
  }

  // ── 8b. markRefundTransferred (Vorkasse manual bank transfer confirm) ──
  //
  // Context: Vorkasse (bank-transfer) refunds cannot be executed via an API —
  // the admin must manually wire the money from the shop account. Until that
  // happens, the Refund row sits at status='PENDING' and is INVISIBLE to the
  // finance reports (which filter on status='PROCESSED' so only actual cash-
  // out is counted). This endpoint lets the admin flip PENDING → PROCESSED
  // once the manual transfer is done, which makes the refund show up in the
  // daily/monthly/VAT reports retroactively (anchored on refund.createdAt
  // for accounting consistency with the credit-note-issue date).
  //
  // Guards: only Vorkasse refunds, only PENDING. Idempotent via the PENDING
  // guard — a second click on an already-PROCESSED refund gets a 400, never
  // double-flips. No payment.status touch (already refunded at refund-create
  // time), no side-effects on the return itself.
  async markRefundTransferred(refundId: string, adminId: string, ip: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        status: true,
        amount: true,
        processedAt: true,
        payment: {
          select: {
            provider: true,
            orderId: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    })

    if (!refund) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'RefundNotFound',
        message: {
          de: 'Erstattung nicht gefunden.',
          en: 'Refund not found.',
          ar: 'الاسترداد غير موجود.',
        },
      })
    }

    if (refund.payment?.provider !== 'VORKASSE') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OnlyVorkasseSupported',
        message: {
          de: 'Nur Vorkasse-Erstattungen können manuell bestätigt werden.',
          en: 'Only Vorkasse refunds can be manually confirmed.',
          ar: 'يمكن تأكيد استرداد التحويل المصرفي يدويًا فقط.',
        },
      })
    }

    if (refund.status !== 'PENDING') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'RefundNotPending',
        message: {
          de: `Erstattung ist bereits im Status "${refund.status}".`,
          en: `Refund is already in status "${refund.status}".`,
          ar: `الاسترداد بالفعل في حالة "${refund.status}".`,
        },
      })
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    })

    try {
      await this.audit.log({
        adminId,
        action: 'VORKASSE_REFUND_CONFIRMED',
        entityType: 'refund',
        entityId: refundId,
        changes: {
          before: { status: 'PENDING', processedAt: null },
          after: {
            status: 'PROCESSED',
            processedAt: updated.processedAt,
            amount: Number(refund.amount),
            orderNumber: refund.payment.order?.orderNumber ?? null,
          },
        },
        ipAddress: ip,
      })
    } catch (e: any) {
      this.logger.error(`Audit: ${e.message}`)
    }

    this.logger.log(
      `Vorkasse refund ${refundId} marked as transferred: ${Number(refund.amount).toFixed(2)} EUR | order=${refund.payment.order?.orderNumber ?? refund.payment.orderId} | by=${adminId}`,
    )

    return updated
  }

  // ── 8c. manualConfirmEbayRefund (C13.3 — eBay 48h-fallback) ──
  //
  // eBay's issue_refund API returns immediately with status='INITIATED'
  // and the actual money-transfer happens asynchronously. Normally
  // EbayRefundPollService.runPollTick (every 60min) flips refund.status
  // PENDING → PROCESSED automatically by polling getOrder() refund-state.
  //
  // BUT — if the poll-cron cannot determine the status (eBay API hiccup,
  // shape-drift in response, etc.) the refund stays PENDING. The poll
  // fires a 48h-fallback admin-notification ('ebay_refund_pending_48h')
  // pointing the admin to this endpoint.
  //
  // Behavior: identical to markRefundTransferred (Vorkasse variant) but
  // filtered for EBAY_MANAGED_PAYMENTS provider only.
  //
  // Guards: only EBAY_MANAGED_PAYMENTS refunds, only PENDING. Idempotent
  // via PENDING guard. Audit-action EBAY_REFUND_MANUALLY_CONFIRMED.
  async manualConfirmEbayRefund(refundId: string, adminId: string, ip: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        status: true,
        amount: true,
        processedAt: true,
        providerRefundId: true,
        payment: {
          select: {
            provider: true,
            orderId: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    })

    if (!refund) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'RefundNotFound',
        message: {
          de: 'Erstattung nicht gefunden.',
          en: 'Refund not found.',
          ar: 'الاسترداد غير موجود.',
        },
      })
    }

    if (refund.payment?.provider !== 'EBAY_MANAGED_PAYMENTS') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OnlyEbayManagedPaymentsSupported',
        message: {
          de: 'Nur eBay Managed Payments-Erstattungen können hier manuell bestätigt werden.',
          en: 'Only eBay Managed Payments refunds can be manually confirmed here.',
          ar: 'يمكن تأكيد استرداد eBay Managed Payments يدويًا هنا فقط.',
        },
      })
    }

    if (refund.status !== 'PENDING') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'RefundNotPending',
        message: {
          de: `Erstattung ist bereits im Status "${refund.status}".`,
          en: `Refund is already in status "${refund.status}".`,
          ar: `الاسترداد بالفعل في حالة "${refund.status}".`,
        },
      })
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    })

    try {
      await this.audit.log({
        adminId,
        action: 'EBAY_REFUND_MANUALLY_CONFIRMED',
        entityType: 'refund',
        entityId: refundId,
        changes: {
          before: { status: 'PENDING', processedAt: null },
          after: {
            status: 'PROCESSED',
            processedAt: updated.processedAt,
            amount: Number(refund.amount),
            providerRefundId: refund.providerRefundId,
            orderNumber: refund.payment.order?.orderNumber ?? null,
          },
        },
        ipAddress: ip,
      })
    } catch (e: any) {
      this.logger.error(`Audit: ${e.message}`)
    }

    this.logger.log(
      `eBay refund ${refundId} manually confirmed: ${Number(refund.amount).toFixed(2)} EUR | ebayRefundId=${refund.providerRefundId} | order=${refund.payment.order?.orderNumber ?? refund.payment.orderId} | by=${adminId}`,
    )

    return updated
  }

  // ── 9. getStats ────────────────────────────────────────────

  async getStats() {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Retourenquote: returns / orders (last 30 days, online channels only)
    const onlineChannels = ['website', 'mobile', 'facebook', 'instagram', 'tiktok']

    const [returnsLast30, ordersLast30] = await Promise.all([
      this.prisma.return.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          order: { channel: { in: onlineChannels as never[] } },
        },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          channel: { in: onlineChannels as never[] },
          deletedAt: null,
        },
      }),
    ])

    const returnRate = ordersLast30 > 0
      ? Number(((returnsLast30 / ordersLast30) * 100).toFixed(2))
      : 0

    // Häufigste Gründe: groupBy reason with count
    const reasonBreakdown = await this.prisma.return.groupBy({
      by: ['reason'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    })

    const topReasons = reasonBreakdown.map((r) => ({
      reason: r.reason,
      count: r._count.id,
    }))

    // Gesamtwert Erstattungen diesen Monat
    const refundsThisMonth = await this.prisma.return.aggregate({
      _sum: { refundAmount: true },
      where: {
        refundedAt: { gte: startOfMonth },
        status: 'refunded',
      },
    })

    const totalRefundsThisMonth = Number(refundsThisMonth._sum.refundAmount ?? 0)

    // Top 10 meistretournierte Produkte (from returnItems JSON)
    const recentReturns = await this.prisma.return.findMany({
      where: {
        returnItems: { not: undefined },
      },
      select: {
        returnItems: true,
      },
      take: 500,
      orderBy: { createdAt: 'desc' },
    })

    const productCounts = new Map<string, { name: string; sku: string; count: number }>()

    for (const ret of recentReturns) {
      const items = ret.returnItems as ReturnItemJson[] | null
      if (!items || !Array.isArray(items)) continue

      for (const item of items) {
        const key = item.sku ?? item.itemId
        const existing = productCounts.get(key)
        if (existing) {
          existing.count += item.quantity ?? 1
        } else {
          productCounts.set(key, {
            name: item.name ?? key,
            sku: item.sku ?? '',
            count: item.quantity ?? 1,
          })
        }
      }
    }

    const topReturnedProducts = Array.from(productCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Status breakdown
    const statusBreakdown = await this.prisma.return.groupBy({
      by: ['status'],
      _count: { id: true },
    })

    const byStatus = Object.fromEntries(
      statusBreakdown.map((s) => [s.status, s._count.id]),
    )

    return {
      returnRate,
      returnsLast30Days: returnsLast30,
      ordersLast30Days: ordersLast30,
      topReasons,
      totalRefundsThisMonth,
      topReturnedProducts,
      byStatus,
    }
  }

  // ── 10a. sendDhlLabel (nachträglich DHL Label senden) ─────

  async sendDhlLabel(id: string, adminId: string, ip: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            user: { select: { email: true, firstName: true, lastName: true, preferredLang: true } },
            shippingAddress: { select: { firstName: true, lastName: true, street: true, houseNumber: true, postalCode: true, city: true, country: true } },
          },
        },
      },
    })
    if (!ret) throw new NotFoundException({ message: { de: 'Retoure nicht gefunden.', en: 'Return not found.', ar: 'المرتجع غير موجود.' } })

    const addr = ret.order.shippingAddress
    const userName = `${ret.order.user?.firstName ?? ''} ${ret.order.user?.lastName ?? ''}`.trim() || 'Kunde'

    let labelPdfBuffer: Buffer | null = null
    let dhlTrackingNumber: string | null = null

    try {
      const result = await this.dhlProvider.createReturnLabel({
        orderId: ret.orderId,
        originalTrackingNumber: ret.returnTrackingNumber ?? '',
        senderName: addr ? `${addr.firstName} ${addr.lastName}` : userName,
        street: addr?.street ?? '',
        houseNumber: addr?.houseNumber ?? '',
        postalCode: addr?.postalCode ?? '',
        city: addr?.city ?? '',
        country: addr?.country ?? 'DE',
        weight: 1000,
      })
      labelPdfBuffer = result.returnLabelPdf
      dhlTrackingNumber = result.returnTrackingNumber
    } catch (e: any) {
      this.logger.error(`DHL return label failed: ${e.message}`)
      throw new BadRequestException({
        message: { de: `DHL-Label konnte nicht erstellt werden: ${e.message}`, en: `DHL label creation failed: ${e.message}`, ar: `فشل إنشاء ملصق DHL: ${e.message}` },
      })
    }

    // Update return
    await this.prisma.return.update({
      where: { id },
      data: { adminNotes: 'shop_pays_shipping', returnTrackingNumber: dhlTrackingNumber },
    })

    // Send label to customer
    const customerEmail = ret.order.user?.email
    const lang = ret.order.user?.preferredLang ?? 'de'
    if (customerEmail && labelPdfBuffer) {
      try {
        await this.emailService.enqueue({
          to: customerEmail, type: 'return-confirmation' as any, lang,
          data: { firstName: ret.order.user?.firstName ?? '', returnNumber: ret.returnNumber ?? id.slice(0, 8), orderNumber: ret.order.orderNumber, status: 'label_sent', sendLabel: true, message: this.getStatusMessage('label_sent', lang) },
          attachments: [{ filename: `Ruecksendeetikett-${ret.returnNumber}.pdf`, contentBase64: labelPdfBuffer.toString('base64'), contentType: 'application/pdf' }],
        })
      } catch (e: any) { this.logger.error(`Email: ${e.message}`) }
    }

    try { await this.audit.log({ adminId, action: 'RETURN_LABEL_SENT', entityType: 'return', entityId: id, changes: { after: { dhlTrackingNumber, adminNotes: 'shop_pays_shipping' } }, ipAddress: ip }) } catch {}

    return { success: true, dhlTrackingNumber }
  }

  // ── 10b. generateReturnLabel ────────────────────────────────

  async generateReturnLabel(id: string): Promise<Buffer> {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            orderNumber: true,
            items: {
              select: {
                snapshotName: true,
                snapshotSku: true,
                quantity: true,
              },
            },
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })

    if (!ret) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'ReturnNotFound',
        message: {
          de: 'Retoure nicht gefunden.',
          en: 'Return not found.',
          ar: 'المرتجع غير موجود.',
        },
      })
    }

    // Get shop return address from ShopSettings
    const returnAddress = await this.getReturnAddress()
    const returnNumber = ret.returnNumber ?? id.slice(0, 8)

    // Generate barcode image before creating PDF
    let barcodeBuffer: Buffer | null = null
    try {
      const bwipjs = require('bwip-js')
      barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: returnNumber,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
        textsize: 10,
      })
    } catch { /* fallback to text barcode */ }

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── Header ──────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('Retourenetikett / Return Label', 50, 50)

      doc.moveTo(50, 80).lineTo(545, 80).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // ── Return Number + Barcode ────────────────────
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('Retourennummer / Return Number:', 50, 100)

      // Barcode (Code128 — includes number as text below)
      if (barcodeBuffer) {
        doc.image(barcodeBuffer, 50, 125, { width: 280, height: 70 })
      } else {
        doc.fontSize(28).font('Courier-Bold').fillColor('#000000')
          .text(`*${returnNumber}*`, 50, 160, { characterSpacing: 2 })
      }

      doc.moveTo(50, 235).lineTo(545, 235).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // ── Return-To Address ───────────────────────────
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#4b5563')
        .text('Rücksendung an / Return to:', 50, 250)
      doc.fontSize(11).font('Helvetica').fillColor('#1a1a2e')
        .text(returnAddress, 50, 267, { width: 250, lineGap: 3 })

      // ── Customer ────────────────────────────────────
      const customerName = ret.order.user
        ? `${ret.order.user.firstName} ${ret.order.user.lastName}`
        : 'Kunde'

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#4b5563')
        .text('Absender / From:', 320, 250)
      doc.fontSize(11).font('Helvetica').fillColor('#1a1a2e')
        .text(customerName, 320, 267)

      // ── Order Reference ─────────────────────────────
      doc.fontSize(10).font('Helvetica').fillColor('#4b5563')
        .text(`Bestellnummer: ${ret.order.orderNumber}`, 320, 285)

      doc.moveTo(50, 320).lineTo(545, 320).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // ── Items List ──────────────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('Retoure-Artikel / Items to Return:', 50, 335)

      let y = 360
      // Table header
      doc.rect(50, y - 4, 495, 18).fill('#f3f4f6')
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#4b5563')
      doc.text('Pos.', 55, y, { width: 25 })
      doc.text('Artikel', 82, y, { width: 260 })
      doc.text('SKU', 345, y, { width: 100 })
      doc.text('Menge', 450, y, { width: 90, align: 'center' })
      y += 20

      doc.font('Helvetica').fontSize(9).fillColor('#1a1a2e')

      // Use returnItems JSON if available, otherwise fall back to order items
      const returnItems = ret.returnItems as ReturnItemJson[] | null

      // Simple table rows — NO per-item barcodes (one RET barcode at top is enough)
      const renderItem = (name: string, sku: string, qty: number, idx: number) => {
        if (idx % 2 === 1) doc.rect(50, y - 3, 495, 16).fill('#fafafa')
        doc.fillColor('#1a1a2e')
        doc.text(`${idx + 1}`, 55, y, { width: 25 })
        doc.text(name ?? '—', 82, y, { width: 260 })
        doc.text(sku ?? '—', 345, y, { width: 100 })
        doc.text(`${qty}`, 450, y, { width: 90, align: 'center' })
        y += 16
      }

      if (returnItems && Array.isArray(returnItems) && returnItems.length > 0) {
        returnItems.forEach((item, i) => renderItem(item.name ?? '—', item.sku ?? '—', item.quantity, i))
      } else {
        ret.order.items.forEach((item, i) => renderItem(item.snapshotName, item.snapshotSku, item.quantity, i))
      }

      // ── Instructions ────────────────────────────────
      y += 20
      doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
      y += 15

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#4b5563')
        .text('Hinweise / Instructions:', 50, y)
      y += 14
      doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
      doc.text('1. Bitte legen Sie dieses Etikett dem Paket bei.', 50, y, { width: 495 })
      y += 12
      doc.text('2. Verpacken Sie die Ware sicher in der Originalverpackung.', 50, y, { width: 495 })
      y += 12
      doc.text('3. Geben Sie das Paket bei einem DHL-Paketshop oder einer Filiale ab.', 50, y, { width: 495 })

      // ── Footer ──────────────────────────────────────
      doc.fontSize(7).fillColor('#9ca3af')
        .text(
          `Retourennummer: ${returnNumber} | Erstellt: ${new Date().toLocaleDateString('de-DE')}`,
          50, 780,
          { align: 'center', width: 495 },
        )

      doc.end()
    })
  }

  // ── Private Helpers ────────────────────────────────────────

  private validateTransition(currentStatus: string, targetStatus: string): void {
    const allowed = VALID_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidStatusTransition',
        message: {
          de: `Ungültiger Statuswechsel: ${currentStatus} \u2192 ${targetStatus}`,
          en: `Invalid status transition: ${currentStatus} \u2192 ${targetStatus}`,
          ar: `\u0627\u0646\u062A\u0642\u0627\u0644 \u062D\u0627\u0644\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D: ${currentStatus} \u2192 ${targetStatus}`,
        },
      })
    }
  }

  /**
   * Restock an item from a return with a 4-step warehouse fallback chain.
   *
   * Resolution order:
   *   1. explicit `targetWarehouseId` (admin picked one in the inspect UI)
   *   2. Scanner-movement warehouse: we look up the most recent
   *      inventory_movement with notes starting "Return scan: <RET-NR>"
   *      for this variant. If the Lager-Mitarbeiter already booked the
   *      return into a specific warehouse during the scan step, that's
   *      the authoritative location.
   *   3. Last reservation warehouse for (orderId, variantId) — respects
   *      admin-overridden fulfilment warehouse
   *   4. Default warehouse (isDefault=true) — legacy behaviour, stays as
   *      final fallback so existing call sites never 500 on missing data
   *
   * Returns the warehouse the restock happened in, or null if no inventory
   * row could be located / created (logged as warning).
   */
  private async restockItem(
    variantId: string,
    quantity: number,
    orderId: string,
    returnNumber: string,
    targetWarehouseId?: string,
  ): Promise<{ warehouseId: string | null; restocked: boolean }> {
    // ── Step 1-3: resolve target warehouse via fallback chain ──
    let resolvedWarehouseId: string | null = targetWarehouseId ?? null

    if (!resolvedWarehouseId) {
      const scannerMove = await this.prisma.inventoryMovement.findFirst({
        where: {
          variantId,
          notes: { startsWith: `Return scan: ${returnNumber}` },
        },
        orderBy: { createdAt: 'desc' },
        select: { warehouseId: true },
      })
      if (scannerMove) resolvedWarehouseId = scannerMove.warehouseId
    }

    if (!resolvedWarehouseId) {
      const lastReservation = await this.prisma.stockReservation.findFirst({
        where: {
          variantId,
          orderId,
          status: { in: ['RESERVED', 'CONFIRMED', 'RELEASED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { warehouseId: true },
      })
      if (lastReservation) resolvedWarehouseId = lastReservation.warehouseId
    }

    // ── Step 4: find or create inventory row at resolved warehouse ──
    let inv: any = null
    if (resolvedWarehouseId) {
      inv = await this.prisma.inventory.findFirst({
        where: { variantId, warehouseId: resolvedWarehouseId },
      })
      if (!inv) {
        // Resolved warehouse has no inventory row for this variant yet —
        // create it. This matches the processReturnScan behaviour so
        // return-restocks never fail silently on "row missing".
        inv = await this.prisma.inventory.create({
          data: {
            variantId,
            warehouseId: resolvedWarehouseId,
            quantityOnHand: 0,
            quantityReserved: 0,
            reorderPoint: 5,
          },
        })
      }
    } else {
      // Nothing resolved → legacy default-warehouse fallback
      inv = await this.prisma.inventory.findFirst({
        where: { variantId },
        orderBy: { warehouse: { isDefault: 'desc' } },
      })
    }

    if (!inv) {
      this.logger.warn(`No inventory record available for variant ${variantId} — skipping restock`)
      return { warehouseId: null, restocked: false }
    }

    await this.prisma.$transaction([
      this.prisma.inventory.update({
        where: { id: inv.id },
        data: { quantityOnHand: { increment: quantity } },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          variantId,
          warehouseId: inv.warehouseId,
          type: 'return_received',
          quantity,
          quantityBefore: inv.quantityOnHand,
          quantityAfter: inv.quantityOnHand + quantity,
          referenceId: orderId,
          notes: `Return restock: ${returnNumber}`,
        },
      }),
    ])

    return { warehouseId: inv.warehouseId, restocked: true }
  }

  /**
   * R10-B Teil 3 + R11: damaged-path with real stock impact.
   *
   * Naming convention (R11 — intentionally kept, NOT renamed):
   *   • Customers never see "damaged" as a self-selectable reason — that
   *     was removed in R10-B Teil 0 because we inspect every item before
   *     shipping, making customer-reported defects overwhelmingly false.
   *   • Admins retain the full "damaged" lifecycle for the rare real-defect
   *     case (transport damage, customer-caused damage). "Damaged" is the
   *     domain term, matches the Prisma `InventoryMovementType.damaged`
   *     enum value, and matches the Prisma `ReturnReason.damaged` enum
   *     (still present for backwards-compat with historical returns).
   *   • No rename to "defective" or "quality_issue" — `quality_issue` is
   *     a separate, less severe customer reason and must remain distinct.
   *
   * Two scenarios:
   *
   *   (a) Scanner already booked the item into a warehouse (normal flow):
   *       The Scanner-Flow did its job unconditionally — Ware kam an, Ware
   *       wurde eingebucht. Now the admin inspection determines that this
   *       specific unit is damaged. We need to take it back out of stock
   *       so the inventory reflects what's actually sellable.
   *
   *       → Decrement quantityOnHand at the Scanner-Warehouse
   *       → Movement: type='damaged', quantity=-qty, proper Before/After
   *       → Returns `decremented: true` + warehouseId for audit logging
   *
   *   (b) No scanner movement exists (edge / legacy case):
   *       The stock was never increased for this return — likely the scanner
   *       step was skipped entirely. We only document the damage for history;
   *       no inventory change.
   *
   *       → Movement: type='damaged', quantity=-qty, Before == After
   *       → Returns `decremented: false`
   *
   * Legacy tests depend on the old "documentation-only" behaviour for damaged
   * items WITHOUT a scanner movement — that path is preserved exactly.
   */
  private async createDamagedMovement(
    variantId: string,
    quantity: number,
    orderId: string,
    returnNumber: string,
  ): Promise<{ decremented: boolean; warehouseId: string | null }> {
    // Lookup the scanner movement for this specific return to decide whether
    // to decrement or just document. Uses the same key the Dedup-Guard uses
    // (notes startsWith `Return scan: <RET-NR>`) so both paths agree on the
    // authoritative warehouse.
    const scannerMovement = await this.prisma.inventoryMovement.findFirst({
      where: {
        variantId,
        type: 'return_received',
        notes: { startsWith: `Return scan: ${returnNumber}` },
      },
      select: { warehouseId: true },
    })

    if (scannerMovement) {
      // Scenario (a): real decrement at the scanner's warehouse
      const inv = await this.prisma.inventory.findFirst({
        where: { variantId, warehouseId: scannerMovement.warehouseId },
      })
      if (!inv) {
        this.logger.warn(
          `Scanner movement exists for variant ${variantId} in warehouse ${scannerMovement.warehouseId} but inventory row is gone — documenting only`,
        )
        await this.prisma.inventoryMovement.create({
          data: {
            variantId,
            warehouseId: scannerMovement.warehouseId,
            type: 'damaged',
            quantity: -quantity,
            quantityBefore: 0,
            quantityAfter: 0,
            referenceId: orderId,
            notes: `Damaged removal (inv row missing): ${returnNumber}`,
          },
        })
        return { decremented: false, warehouseId: scannerMovement.warehouseId }
      }

      await this.prisma.$transaction([
        this.prisma.inventory.update({
          where: { id: inv.id },
          data: { quantityOnHand: { decrement: quantity } },
        }),
        this.prisma.inventoryMovement.create({
          data: {
            variantId,
            warehouseId: inv.warehouseId,
            type: 'damaged',
            quantity: -quantity,
            quantityBefore: inv.quantityOnHand,
            quantityAfter: inv.quantityOnHand - quantity,
            referenceId: orderId,
            notes: `Damaged removal after scan: ${returnNumber}`,
          },
        }),
      ])

      return { decremented: true, warehouseId: inv.warehouseId }
    }

    // Scenario (b): no scanner → documentation only (legacy behaviour)
    const inv = await this.prisma.inventory.findFirst({
      where: { variantId },
      orderBy: { warehouse: { isDefault: 'desc' } },
    })

    if (!inv) {
      this.logger.warn(`No inventory record found for variant ${variantId} — skipping damaged movement`)
      return { decremented: false, warehouseId: null }
    }

    await this.prisma.inventoryMovement.create({
      data: {
        variantId,
        warehouseId: inv.warehouseId,
        type: 'damaged',
        quantity: -quantity,
        quantityBefore: inv.quantityOnHand,
        quantityAfter: inv.quantityOnHand,
        referenceId: orderId,
        notes: `Return damaged (no scan): ${returnNumber}`,
      },
    })

    return { decremented: false, warehouseId: inv.warehouseId }
  }

  private async getReturnAddress(): Promise<string> {
    try {
      const settings = await this.prisma.shopSetting.findMany({
        where: { key: { in: ['companyName', 'companyAddress', 'returnAddress'] } },
      })
      const map = new Map(settings.map((s) => [s.key, s.value]))

      // Prefer dedicated returnAddress, fall back to company address
      const returnAddr = map.get('returnAddress')
      if (returnAddr) return returnAddr

      const name = map.get('companyName') ?? 'Malak Bekleidung'
      const address = map.get('companyAddress') ?? ''
      return `${name}\n${address}`
    } catch {
      return 'Malak Bekleidung\n(Adresse nicht konfiguriert)'
    }
  }

  private getStatusMessage(
    status: string,
    lang: string,
  ): string {
    const messages: Record<string, Record<string, string>> = {
      label_sent: {
        de: 'Ihre Retoure wurde genehmigt. Bitte senden Sie die Ware an die unten angegebene Adresse.',
        en: 'Your return has been approved. Please send the items to the address below.',
        ar: '\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0625\u0631\u062C\u0627\u0639. \u064A\u0631\u062C\u0649 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0625\u0644\u0649 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u0630\u0643\u0648\u0631 \u0623\u062F\u0646\u0627\u0647.',
      },
      rejected: {
        de: 'Ihre Retoure wurde leider abgelehnt.',
        en: 'Your return has been rejected.',
        ar: '\u062A\u0645 \u0631\u0641\u0636 \u0637\u0644\u0628 \u0627\u0644\u0625\u0631\u062C\u0627\u0639.',
      },
      received: {
        de: 'Ihr Paket ist eingetroffen und wird nun gepr\u00FCft.',
        en: 'Your package has arrived and is being inspected.',
        ar: '\u0648\u0635\u0644\u062A \u0627\u0644\u0637\u0631\u062F \u0648\u064A\u062A\u0645 \u0641\u062D\u0635\u0647\u0627 \u0627\u0644\u0622\u0646.',
      },
      refunded: {
        de: 'Ihre Erstattung wurde verarbeitet. Der Betrag wird in den n\u00E4chsten Tagen auf Ihrem Konto gutgeschrieben.',
        en: 'Your refund has been processed. The amount will be credited to your account within the next few days.',
        ar: '\u062A\u0645 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F. \u0633\u064A\u062A\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0628\u0644\u063A \u0625\u0644\u0649 \u062D\u0633\u0627\u0628\u0643 \u062E\u0644\u0627\u0644 \u0627\u0644\u0623\u064A\u0627\u0645 \u0627\u0644\u0642\u0627\u062F\u0645\u0629.',
      },
    }

    return messages[status]?.[lang] ?? messages[status]?.de ?? ''
  }
}
