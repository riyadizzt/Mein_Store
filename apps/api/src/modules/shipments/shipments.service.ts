import {
  Injectable,
  Logger,
  Optional,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { IShipmentProvider, SHIPMENT_PROVIDERS } from './shipment-provider.interface'
import { KlarnaProvider } from '../payments/providers/klarna.provider'
import { PaymentsService } from '../payments/payments.service'
import { EmailService } from '../email/email.service'
import { DHLProvider } from './providers/dhl.provider'
import { CreateShipmentDto } from './dto/create-shipment.dto'
import { CreateReturnRequestDto } from './dto/return-request.dto'
import { ORDER_EVENTS, OrderStatusChangedEvent } from '../orders/events/order.events'
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service'
import { buildReturnPayloadBase } from '../webhooks/payload-builders/return'

const WITHDRAWAL_DAYS = 14 // deutsches Widerrufsrecht

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name)
  private readonly providerMap: Map<string, IShipmentProvider>

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly klarnaProvider: KlarnaProvider,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly dhlProvider: DHLProvider,
    @Inject(SHIPMENT_PROVIDERS) providers: IShipmentProvider[],
    // Optional webhook wiring — null-safe, never required.
    @Optional() private readonly webhookDispatcher?: WebhookDispatcherService,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.providerMap = new Map(providers.map((p) => [p.providerName, p]))
  }

  // ── CREATE SHIPMENT ────────────────────────────────────────

  async createShipment(dto: CreateShipmentDto, performedBy: string, correlationId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, deletedAt: null },
      include: {
        shippingAddress: true,
        shipment: true,
        payment: true,
        items: {
          include: { variant: { select: { weightGrams: true } } },
        },
        user: { select: { id: true, email: true, firstName: true, preferredLang: true } },
      },
    })

    if (!order) throw this.notFound('Order')
    if (order.shipment) {
      throw new ConflictException({
        statusCode: 409,
        error: 'ShipmentAlreadyExists',
        message: {
          de: 'Sendung wurde bereits erstellt.',
          en: 'Shipment already exists.',
          ar: 'تم إنشاء الشحنة بالفعل.',
        },
      })
    }

    if (!['confirmed', 'processing'].includes(order.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidOrderState',
        message: {
          de: `Versand nicht moeglich fuer Status: ${order.status}`,
          en: `Shipment not possible for status: ${order.status}`,
          ar: `لا يمكن الشحن للحالة: ${order.status}`,
        },
      })
    }

    if (!order.shippingAddress) throw this.notFound('ShippingAddress')

    const provider = this.providerMap.get(dto.carrier)
    if (!provider) throw new BadRequestException(`Carrier ${dto.carrier} not configured`)

    // Calculate total weight
    const totalWeight = order.items.reduce(
      (sum, item) => sum + (item.variant.weightGrams ?? 500) * item.quantity,
      0,
    )

    // Validate address before creating shipment (non-blocking)
    let addressWarnings: string[] = []
    try {
      if (provider.providerName === 'dhl' && (provider as any).validateAddress) {
        const validation = await (provider as any).validateAddress({
          street: order.shippingAddress.street,
          houseNumber: order.shippingAddress.houseNumber,
          postalCode: order.shippingAddress.postalCode,
          city: order.shippingAddress.city,
          country: order.shippingAddress.country,
        })
        if (!validation.valid) addressWarnings = validation.warnings
      }
    } catch {}

    // Try to create shipment via provider API
    let trackingNumber: string | null = null
    let trackingUrl: string | null = null
    let labelUrl: string | null = null
    let providerShipmentId: string | null = null
    let isManualMode = false

    try {
      const result = await provider.createShipment({
        recipientName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
        street: order.shippingAddress.street,
        houseNumber: order.shippingAddress.houseNumber,
        postalCode: order.shippingAddress.postalCode,
        city: order.shippingAddress.city,
        country: order.shippingAddress.country,
        weight: totalWeight,
        orderId: order.id,
        orderNumber: order.orderNumber,
      })
      trackingNumber = result.trackingNumber
      trackingUrl = result.trackingUrl
      providerShipmentId = result.providerShipmentId
      // Label URL points to our API endpoint that serves the stored PDF
      labelUrl = `/api/v1/shipments/labels/${result.trackingNumber}`
    } catch (err: any) {
      if (err?.response?.isManualMode) {
        // DHL API not configured — create shipment record for manual label upload
        isManualMode = true
        this.logger.log(`[${correlationId}] Manual mode: shipment for ${order.orderNumber} needs manual label`)
      } else {
        throw err
      }
    }

    // Persist shipment (with or without tracking data)
    const shipment = await this.prisma.shipment.create({
      data: {
        orderId: order.id,
        carrier: dto.carrier,
        status: isManualMode ? 'pending' : 'label_created',
        providerShipmentId,
        trackingNumber,
        trackingUrl,
        labelUrl,
        shippedAt: isManualMode ? undefined : new Date(),
      },
    })

    // Only update order to shipped if label was created automatically
    if (!isManualMode) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'shipped' },
      })
    } else {
      // Keep order in processing state until label is uploaded
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'processing' },
      })
    }

    const newStatus = isManualMode ? 'processing' : 'shipped'

    await this.prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status as any,
        toStatus: newStatus as any,
        source: 'admin',
        referenceId: shipment.id,
        notes: isManualMode
          ? 'Manuelles Label benoetigt'
          : `DHL Label erstellt: ${trackingNumber}`,
        createdBy: performedBy,
      },
    })

    // Klarna: Capture payment on shipment (NOT before! And only if label created)
    if (!isManualMode && order.payment?.provider === 'KLARNA' && order.payment.status === 'authorized') {
      try {
        const amountCents = Math.round(Number(order.totalAmount) * 100)
        await this.klarnaProvider.capturePayment(order.payment.providerPaymentId!, amountCents)

        await this.prisma.payment.update({
          where: { id: order.payment.id },
          data: { status: 'captured', paidAt: new Date() },
        })
        this.logger.log(`[${correlationId}] Klarna captured on shipment: ${order.payment.providerPaymentId}`)
      } catch (err) {
        this.logger.error(`[${correlationId}] Klarna capture FAILED — shipment created but payment not captured`, err)
      }
    }

    // Emit status changed event → triggers shipping confirmation email
    if (!isManualMode) {
      this.eventEmitter.emit(
        ORDER_EVENTS.STATUS_CHANGED,
        new OrderStatusChangedEvent(order.id, order.status, 'shipped', 'admin', correlationId),
      )

      // Shipping email is handled by order-email.listener via STATUS_CHANGED event
      // The listener sends order-status email with tracking info when status becomes 'shipped'
    }

    this.logger.log(
      `[${correlationId}] Shipment created: ${shipment.id} | tracking=${trackingNumber ?? 'MANUAL'} | carrier=${dto.carrier} | order=${order.orderNumber} | manual=${isManualMode}`,
    )

    return {
      shipmentId: shipment.id,
      trackingNumber,
      trackingUrl,
      labelUrl,
      isManualMode,
      addressWarnings: addressWarnings.length > 0 ? addressWarnings : undefined,
      message: isManualMode
        ? 'Sendung erstellt — bitte Label manuell im DHL Geschaeftskundenportal erstellen und hier hochladen.'
        : addressWarnings.length > 0
        ? 'Sendung erstellt — Adresse konnte nicht von DHL verifiziert werden. Bitte pruefen.'
        : undefined,
    }
  }

  // ── UPDATE TRACKING STATUS ─────────────────────────────────

  async updateTrackingStatus(
    trackingNumber: string,
    dhlStatus: string,
    correlationId: string,
  ): Promise<void> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNumber },
      include: { order: { select: { id: true, status: true, orderNumber: true } } },
    })

    if (!shipment) return

    const statusMap: Record<string, { shipment: string; order: string }> = {
      'pre-transit': { shipment: 'label_created', order: 'shipped' },
      'transit': { shipment: 'in_transit', order: 'shipped' },
      'in-transit': { shipment: 'in_transit', order: 'shipped' },
      'out-for-delivery': { shipment: 'out_for_delivery', order: 'shipped' },
      'delivered': { shipment: 'delivered', order: 'delivered' },
      'failure': { shipment: 'failed_attempt', order: 'shipped' },
      'returned': { shipment: 'returned_to_sender', order: 'returned' },
    }

    const mapped = statusMap[dhlStatus.toLowerCase()]
    if (!mapped) return

    if (shipment.status === mapped.shipment) return // already up-to-date

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: mapped.shipment as any,
        ...(mapped.shipment === 'delivered' && { deliveredAt: new Date() }),
        ...(mapped.shipment === 'in_transit' && !shipment.shippedAt && { shippedAt: new Date() }),
      },
    })

    // Update order status if it needs to change
    if (shipment.order.status !== mapped.order) {
      await this.prisma.order.update({
        where: { id: shipment.order.id },
        data: { status: mapped.order as any },
      })

      await this.prisma.orderStatusHistory.create({
        data: {
          orderId: shipment.order.id,
          fromStatus: shipment.order.status as any,
          toStatus: mapped.order as any,
          source: 'dhl_tracking',
          referenceId: trackingNumber,
          createdBy: 'system',
        },
      })

      this.eventEmitter.emit(
        ORDER_EVENTS.STATUS_CHANGED,
        new OrderStatusChangedEvent(
          shipment.order.id,
          shipment.order.status,
          mapped.order,
          'dhl_tracking',
          correlationId,
        ),
      )
    }

    this.logger.log(
      `[${correlationId}] Tracking update: ${trackingNumber} -> ${mapped.shipment} | order=${shipment.order.orderNumber}`,
    )
  }

  // ── RETURN REQUEST (14-Tage Widerruf) ─────────────────────

  // Shared include used by both the logged-in and the public token flow.
  // Private helper so the two entry points cannot drift apart.
  private readonly RETURN_ORDER_INCLUDE = {
    shipment: true,
    returns: { where: { status: { not: 'refunded' as any } } },
    shippingAddress: true,
    items: { select: { variantId: true, snapshotName: true, snapshotSku: true, quantity: true, unitPrice: true } },
    user: { select: { email: true, firstName: true, preferredLang: true } },
  } as const

  /**
   * Public entry point — authenticated by a one-time token stored in
   * order.notes.confirmationToken. Used by the guest-return page so
   * customers without an account (stub users) can still exercise their
   * 14-day withdrawal right under §355 BGB.
   */
  async createReturnRequestByToken(
    orderId: string,
    dto: CreateReturnRequestDto,
    token: string,
    correlationId: string,
  ) {
    if (!token) throw this.notFound('Token')
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: this.RETURN_ORDER_INCLUDE,
    })
    if (!order) throw this.notFound('Order')

    // Validate token against notes.confirmationToken (set in handlePaymentSuccess)
    let notes: any = {}
    try { notes = JSON.parse(order.notes ?? '{}') } catch {}
    if (!notes.confirmationToken || notes.confirmationToken !== token) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'InvalidReturnToken',
        message: {
          de: 'Ungueltiger Retouren-Link.',
          en: 'Invalid return link.',
          ar: 'رابط الإرجاع غير صالح.',
        },
      })
    }

    return this.processReturnRequest(order, dto, correlationId)
  }

  /**
   * Read-only endpoint for the public return page. Returns just enough
   * data to pre-fill the form (items, deadline, delivery date) without
   * leaking sensitive fields.
   */
  async getReturnPreFillByToken(orderId: string, token: string) {
    if (!token) throw this.notFound('Token')
    const order: any = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        shipment: { select: { deliveredAt: true, status: true } },
        items: {
          select: {
            variantId: true,
            snapshotName: true,
            snapshotSku: true,
            quantity: true,
            unitPrice: true,
            variant: { select: { color: true, size: true, product: { select: { images: { where: { isPrimary: true }, select: { url: true }, take: 1 } } } } },
          },
        },
        returns: { select: { status: true } },
      },
    })
    if (!order) throw this.notFound('Order')

    let notes: any = {}
    try { notes = JSON.parse(order.notes ?? '{}') } catch {}
    if (!notes.confirmationToken || notes.confirmationToken !== token) {
      throw new UnauthorizedException('Invalid return link')
    }

    const deliveredAt = order.shipment?.deliveredAt ?? null
    const deadline = deliveredAt
      ? new Date(deliveredAt.getTime() + WITHDRAWAL_DAYS * 24 * 60 * 60 * 1000)
      : null
    const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0
    const hasActiveReturn = order.returns.some((r: any) => r.status !== 'refunded' && r.status !== 'rejected')

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      deliveredAt: deliveredAt?.toISOString() ?? null,
      deadline: deadline?.toISOString() ?? null,
      daysLeft,
      canReturn: order.status === 'delivered' && !hasActiveReturn && daysLeft > 0,
      hasActiveReturn,
      items: order.items.map((it: any) => ({
        variantId: it.variantId,
        name: it.snapshotName,
        sku: it.snapshotSku,
        color: it.variant?.color,
        size: it.variant?.size,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        imageUrl: it.variant?.product?.images?.[0]?.url ?? null,
      })),
    }
  }

  async createReturnRequest(
    orderId: string,
    dto: CreateReturnRequestDto,
    userId: string,
    correlationId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      include: this.RETURN_ORDER_INCLUDE,
    })

    if (!order) throw this.notFound('Order')
    return this.processReturnRequest(order, dto, correlationId)
  }

  private async processReturnRequest(order: any, dto: CreateReturnRequestDto, correlationId: string) {
    if (!order.shipment) throw this.notFound('Shipment')

    // Guard: only delivered orders
    if (order.status !== 'delivered') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OrderNotDelivered',
        message: {
          de: 'Ruecksendung nur fuer zugestellte Bestellungen moeglich.',
          en: 'Returns are only possible for delivered orders.',
          ar: 'الإرجاع ممكن فقط للطلبات المسلمة.',
        },
      })
    }

    // Guard: only 1 active return per order
    if (order.returns.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'ReturnAlreadyExists',
        message: {
          de: 'Es gibt bereits eine aktive Ruecksendung fuer diese Bestellung.',
          en: 'A return request already exists for this order.',
          ar: 'يوجد طلب إرجاع نشط بالفعل لهذا الطلب.',
        },
      })
    }

    // Guard: 14-day deadline check
    const deliveredAt = order.shipment.deliveredAt
    if (!deliveredAt) throw this.notFound('DeliveryDate')

    const deadline = new Date(deliveredAt.getTime() + WITHDRAWAL_DAYS * 24 * 60 * 60 * 1000)
    if (new Date() > deadline) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'WithdrawalExpired',
        message: {
          de: `Die 14-taegige Widerrufsfrist ist am ${deadline.toLocaleDateString('de-DE')} abgelaufen.`,
          en: `The 14-day withdrawal period expired on ${deadline.toLocaleDateString('en-GB')}.`,
          ar: `انتهت فترة الانسحاب البالغة 14 يومًا في ${deadline.toLocaleDateString('ar')}.`,
        },
      })
    }

    // Generate return label via carrier
    // Return always starts as 'requested' — admin decides shipping cost + label in approve step

    // Generate return number (RET-YYYY-NNNNN)
    const year = new Date().getFullYear()
    const lastReturn = await this.prisma.return.findFirst({ orderBy: { createdAt: 'desc' }, select: { returnNumber: true } })
    const lastSeq = lastReturn?.returnNumber ? parseInt(lastReturn.returnNumber.split('-').pop() ?? '0') : 0
    const returnNumber = `RET-${year}-${String(lastSeq + 1).padStart(5, '0')}`

    // Build returnItems JSON with quantities
    const returnItemsJson = dto.items?.map(i => {
      const orderItem = order.items.find((oi: any) => oi.variantId === i.variantId)
      return {
        variantId: i.variantId,
        name: orderItem?.snapshotName ?? '',
        sku: orderItem?.snapshotSku ?? '',
        quantity: i.quantity ?? orderItem?.quantity ?? 1,
        maxQuantity: orderItem?.quantity ?? 1,
        unitPrice: orderItem ? Number(orderItem.unitPrice) : 0,
        reason: i.reason,
      }
    }) ?? []

    const returnRequest = await this.prisma.return.create({
      data: {
        returnNumber,
        orderId: order.id,
        shipmentId: order.shipment.id,
        reason: dto.reason,
        status: 'requested',
        notes: dto.notes,
        deadline,
        returnItems: returnItemsJson.length > 0 ? returnItemsJson : undefined,
        refundAmount: returnItemsJson.length > 0
          ? returnItemsJson.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
          : undefined,
      },
    })

    // NOTE: Order status stays as-is (typically 'delivered') at this point.
    // It only moves to 'returned' when the refund is actually processed.
    // Previously this set status='returned' immediately on request, which
    // was wrong — a rejected return left the order stuck in 'returned'.

    // Send return confirmation email
    if (order.user?.email) {
      const lang = order.user.preferredLang ?? 'de'
      await this.emailService.enqueue({
        to: order.user.email,
        type: 'return-confirmation',
        lang,
        data: {
          firstName: order.user.firstName,
          orderNumber: order.orderNumber,
        },
      }).catch(() => {})
    }

    // Emit event for admin notifications
    this.eventEmitter.emit('return.submitted', {
      returnId: returnRequest.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      reason: dto.reason,
      itemCount: dto.items?.length ?? 0,
    })

    // Fire-and-forget outbound webhook — return.requested.
    if (this.webhookDispatcher) {
      const appUrl = this.config?.get<string>('APP_URL', 'https://malak-bekleidung.com') ?? 'https://malak-bekleidung.com'
      buildReturnPayloadBase(this.prisma, returnRequest.id, appUrl)
        .then((payload) =>
          payload ? this.webhookDispatcher!.emit('return.requested', payload) : undefined,
        )
        .catch((err) => this.logger.warn(`return.requested webhook failed: ${err?.message ?? err}`))
    }

    this.logger.log(
      `[${correlationId}] Return request: ${returnRequest.id} | order=${order.orderNumber} | reason=${dto.reason}`,
    )

    return {
      returnId: returnRequest.id,
      status: returnRequest.status,
      returnNumber: returnRequest.returnNumber,
      deadline: deadline.toISOString(),
    }
  }

  // ── MARK RETURN RECEIVED → auto refund + restock ──────────

  async markReturnReceived(returnId: string, performedBy: string, correlationId: string) {
    const returnReq = await this.prisma.return.findFirst({
      where: { id: returnId },
      include: {
        order: {
          include: { payment: true },
        },
      },
    })

    if (!returnReq) throw this.notFound('Return')
    if (returnReq.status === 'refunded') return returnReq

    await this.prisma.return.update({
      where: { id: returnId },
      data: { status: 'received', receivedAt: new Date() },
    })

    // Auto-refund via Payments Module
    if (returnReq.order.payment && returnReq.order.payment.status === 'captured') {
      try {
        const refundAmount = Math.round(Number(returnReq.order.payment.amount) * 100)
        await this.paymentsService.createRefund(
          { paymentId: returnReq.order.payment.id, amount: refundAmount, reason: `return:${returnReq.reason}` },
          performedBy,
          correlationId,
        )

        await this.prisma.return.update({
          where: { id: returnId },
          data: {
            status: 'refunded',
            refundedAt: new Date(),
            refundAmount: returnReq.order.payment.amount,
          },
        })

        this.logger.log(`[${correlationId}] Return ${returnId} -> refund processed`)
      } catch (err) {
        this.logger.error(`[${correlationId}] Auto-refund failed for return ${returnId}`, err)
      }
    }

    return this.prisma.return.findFirst({ where: { id: returnId } })
  }

  // ── CANCEL SHIPMENT (before handover) ─────────────────────

  async cancelShipment(orderId: string, correlationId: string): Promise<void> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId },
    })

    if (!shipment) return

    if (!['pending', 'label_created'].includes(shipment.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ShipmentAlreadyShipped',
        message: {
          de: 'Sendung kann nicht mehr storniert werden — bereits versendet.',
          en: 'Shipment cannot be cancelled — already shipped.',
          ar: 'لا يمكن إلغاء الشحنة — تم الشحن بالفعل.',
        },
      })
    }

    const provider = this.providerMap.get(shipment.carrier)
    if (provider && shipment.providerShipmentId) {
      try {
        await provider.deleteShipment(shipment.providerShipmentId)
      } catch (err) {
        this.logger.error(`[${correlationId}] Cancel shipment at provider failed`, err)
      }
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'cancelled' },
    })

    this.logger.log(`[${correlationId}] Shipment cancelled: ${shipment.id}`)
  }

  // ── DHL Tracking Polling (Cron: every 2 hours) ────────────
  // Polls DHL Tracking API for active shipments and updates status

  @Cron('0 */2 * * *') // Every 2 hours
  async pollTrackingUpdates(): Promise<void> {
    const activeShipments = await this.prisma.shipment.findMany({
      where: {
        carrier: 'dhl',
        status: { in: ['label_created', 'picked_up', 'in_transit', 'out_for_delivery'] },
        trackingNumber: { not: null },
      },
      select: { trackingNumber: true, id: true },
      take: 50,
      orderBy: { updatedAt: 'asc' }, // oldest-updated first
    })

    if (activeShipments.length === 0) return

    this.logger.log(`Polling DHL tracking for ${activeShipments.length} shipment(s)`)

    for (const shipment of activeShipments) {
      if (!shipment.trackingNumber) continue

      try {
        const result = await this.dhlProvider.getTrackingStatus(shipment.trackingNumber)
        if (!result) continue

        // Map DHL status codes to our internal statuses
        const dhlStatusMap: Record<string, string> = {
          'pre-transit': 'pre-transit',
          'transit': 'transit',
          'delivered': 'delivered',
          'failure': 'failure',
          'returned': 'returned',
          'unknown': '',
        }

        const mappedStatus = dhlStatusMap[result.status.toLowerCase()] ?? ''
        if (mappedStatus) {
          await this.updateTrackingStatus(
            shipment.trackingNumber,
            mappedStatus,
            `cron-poll-${shipment.id}`,
          )
        }

        // Update estimated delivery if available
        if (result.estimatedDelivery) {
          await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: { estimatedDelivery: new Date(result.estimatedDelivery) },
          }).catch(() => {})
        }
      } catch (err) {
        this.logger.warn(`Tracking poll failed for ${shipment.trackingNumber}: ${err}`)
      }

      // Rate limit: 200ms between requests to avoid DHL API throttling
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    this.logger.log(`DHL tracking poll completed for ${activeShipments.length} shipment(s)`)
  }

  // ── MANUAL LABEL UPLOAD ─────────────────────────────────

  async uploadManualLabel(
    shipmentId: string,
    trackingNumber: string,
    _file: Express.Multer.File,
    performedBy: string,
    correlationId: string,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId },
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true },
          include: { user: { select: { email: true, firstName: true, preferredLang: true } } } as any,
        },
      },
    })

    if (!shipment) throw this.notFound('Shipment')

    const labelUrl = `/api/v1/shipments/labels/${trackingNumber}`
    const trackingUrl = `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${trackingNumber}`

    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        trackingNumber,
        trackingUrl,
        labelUrl,
        status: 'label_created',
        shippedAt: new Date(),
      },
    })

    // Update order to shipped if still in confirmed/processing
    if (['confirmed', 'processing'].includes(shipment.order.status)) {
      await this.prisma.order.update({
        where: { id: shipment.order.id },
        data: { status: 'shipped' },
      })

      await this.prisma.orderStatusHistory.create({
        data: {
          orderId: shipment.order.id,
          fromStatus: shipment.order.status as any,
          toStatus: 'shipped',
          source: 'admin',
          notes: 'Manuelles Label hochgeladen',
          referenceId: trackingNumber,
          createdBy: performedBy,
        },
      })

      this.eventEmitter.emit(
        ORDER_EVENTS.STATUS_CHANGED,
        new OrderStatusChangedEvent(shipment.order.id, shipment.order.status, 'shipped', 'admin', correlationId),
      )
    }

    this.logger.log(
      `[${correlationId}] Manual label uploaded: shipment=${shipmentId} tracking=${trackingNumber} by=${performedBy}`,
    )

    return {
      shipmentId: updated.id,
      trackingNumber,
      trackingUrl,
      labelUrl,
      status: updated.status,
    }
  }

  // ── GET LABEL PDF ─────────────────────────────────────────

  getLabelPdfPath(trackingNumber: string): string | null {
    return this.dhlProvider.getLabelPath(trackingNumber)
  }

  getReturnLabelPdfPath(trackingNumber: string): string | null {
    return this.dhlProvider.getReturnLabelPath(trackingNumber)
  }

  // ── Helpers ────────────────────────────────────────────────

  private notFound(entity: string) {
    return new NotFoundException({
      statusCode: 404,
      error: `${entity}NotFound`,
      message: {
        de: `${entity} nicht gefunden.`,
        en: `${entity} not found.`,
        ar: `${entity} غير موجود.`,
      },
    })
  }
}
