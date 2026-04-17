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

    let refundAmount = 0
    const inspectionResults: Array<{
      itemId: string
      condition: string
      restocked: boolean
      amount: number
    }> = []

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
        // Restock: increment quantityOnHand + create InventoryMovement
        refundAmount += itemTotal

        if (orderItem.variantId) {
          await this.restockItem(
            orderItem.variantId,
            returnQty,
            ret.orderId,
            ret.returnNumber ?? id,
          )
        }

        inspectionResults.push({
          itemId: input.itemId,
          condition: 'ok',
          restocked: true,
          amount: itemTotal,
        })
      } else {
        // Damaged: create InventoryMovement type 'damaged', do NOT restock
        if (orderItem.variantId) {
          await this.createDamagedMovement(
            orderItem.variantId,
            returnQty,
            ret.orderId,
            ret.returnNumber ?? id,
          )
        }

        inspectionResults.push({
          itemId: input.itemId,
          condition: 'damaged',
          restocked: false,
          amount: 0,
        })
      }
    }

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
        returnItems: updatedReturnItems as unknown as undefined,
      },
    })

    try { this.eventEmitter.emit('return.status_changed', { returnId: id, orderId: ret.orderId, orderNumber: ret.order.orderNumber, status: 'inspected', adminId, refundAmount }) } catch (e: any) { this.logger.error(`Event: ${e.message}`) }

    try { await this.audit.log({ adminId, action: 'RETURN_INSPECTED', entityType: 'return', entityId: id, changes: { before: { status: ret.status }, after: { status: 'inspected', refundAmount } }, ipAddress: ip }) } catch (e: any) { this.logger.error(`Audit: ${e.message}`) }

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

    // Calculate amount — recalculate from returnItems if refundAmount is 0
    let refundAmountEur = Number(ret.refundAmount ?? 0)
    if (refundAmountEur <= 0) {
      const returnItems = (ret.returnItems as any[] | null) ?? []
      refundAmountEur = returnItems.reduce((sum: number, ri: any) => sum + (Number(ri.unitPrice) || 0) * (ri.quantity || 1), 0)
      // Persist the recalculated amount
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
      this.logger.error(`Return refund failed for ${returnNumber}: ${e.message}`)
      try {
        await this.notificationService.create({
          type: 'refund_failed',
          title: `⚠ Retoure-Erstattung fehlgeschlagen: ${returnNumber}`,
          body: `Retoure genehmigt, aber Erstattung von €${(amountCents / 100).toFixed(2)} konnte nicht durchgeführt werden. Bitte manuell erstatten. Fehler: ${e.message?.slice(0, 100)}`,
          entityType: 'return', entityId: id, channel: 'admin',
          data: {
            kind: 'return',
            returnNumber,
            returnId: id,
            orderNumber: ret.order.orderNumber,
            orderId: ret.orderId,
            amount: amountCents / 100,
            error: (e.message ?? '').slice(0, 100),
          },
        })
      } catch {}
      // Don't block the return status update — the return is approved, refund can be retried manually
    }

    // Update return status
    const updated = await this.prisma.return.update({
      where: { id },
      data: {
        status: 'refunded',
        refundedAt: new Date(),
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

  private async restockItem(
    variantId: string,
    quantity: number,
    orderId: string,
    returnNumber: string,
  ): Promise<void> {
    // Find inventory for this variant in default warehouse
    const inv = await this.prisma.inventory.findFirst({
      where: { variantId },
      orderBy: { warehouse: { isDefault: 'desc' } },
    })

    if (!inv) {
      this.logger.warn(`No inventory record found for variant ${variantId} — skipping restock`)
      return
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
  }

  private async createDamagedMovement(
    variantId: string,
    quantity: number,
    orderId: string,
    returnNumber: string,
  ): Promise<void> {
    const inv = await this.prisma.inventory.findFirst({
      where: { variantId },
      orderBy: { warehouse: { isDefault: 'desc' } },
    })

    if (!inv) {
      this.logger.warn(`No inventory record found for variant ${variantId} — skipping damaged movement`)
      return
    }

    await this.prisma.inventoryMovement.create({
      data: {
        variantId,
        warehouseId: inv.warehouseId,
        type: 'damaged',
        quantity: -quantity, // Documented as loss
        quantityBefore: inv.quantityOnHand,
        quantityAfter: inv.quantityOnHand,
        referenceId: orderId,
        notes: `Return damaged: ${returnNumber}`,
      },
    })
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
