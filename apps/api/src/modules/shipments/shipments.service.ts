import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { IShipmentProvider, SHIPMENT_PROVIDERS } from './shipment-provider.interface'
import { KlarnaProvider } from '../payments/providers/klarna.provider'
import { PaymentsService } from '../payments/payments.service'
import { EmailService } from '../email/email.service'
import { CreateShipmentDto } from './dto/create-shipment.dto'
import { CreateReturnRequestDto } from './dto/return-request.dto'
import { ORDER_EVENTS, OrderStatusChangedEvent } from '../orders/events/order.events'

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
    @Inject(SHIPMENT_PROVIDERS) providers: IShipmentProvider[],
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
        user: { select: { email: true, firstName: true, preferredLang: true } },
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
          de: `Versand nicht möglich für Status: ${order.status}`,
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
      labelUrl = `/api/v1/shipments/${result.trackingNumber}/label.pdf`
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
        notes: isManualMode ? 'Manuelles Label benötigt' : undefined,
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

    // Emit status changed event → email (only if actually shipped)
    if (!isManualMode) {
      this.eventEmitter.emit(
        ORDER_EVENTS.STATUS_CHANGED,
        new OrderStatusChangedEvent(order.id, order.status, 'shipped', 'admin', correlationId),
      )
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
      message: isManualMode
        ? 'Sendung erstellt — bitte Label manuell im DHL Geschäftskundenportal erstellen und hier hochladen.'
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
      'transit': { shipment: 'in_transit', order: 'shipped' },
      'in-transit': { shipment: 'in_transit', order: 'shipped' },
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
      `[${correlationId}] Tracking update: ${trackingNumber} → ${mapped.shipment} | order=${shipment.order.orderNumber}`,
    )
  }

  // ── RETURN REQUEST (14-Tage Widerruf) ─────────────────────

  async createReturnRequest(
    orderId: string,
    dto: CreateReturnRequestDto,
    userId: string,
    correlationId: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      include: {
        shipment: true,
        returns: { where: { status: { not: 'refunded' } } },
        shippingAddress: true,
        user: { select: { email: true, firstName: true, preferredLang: true } },
      },
    })

    if (!order) throw this.notFound('Order')
    if (!order.shipment) throw this.notFound('Shipment')

    // Guard: only delivered orders
    if (order.status !== 'delivered') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OrderNotDelivered',
        message: {
          de: 'Rücksendung nur für zugestellte Bestellungen möglich.',
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
          de: 'Es gibt bereits eine aktive Rücksendung für diese Bestellung.',
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
          de: `Die 14-tägige Widerrufsfrist ist am ${deadline.toLocaleDateString('de-DE')} abgelaufen.`,
          en: `The 14-day withdrawal period expired on ${deadline.toLocaleDateString('en-GB')}.`,
          ar: `انتهت فترة الانسحاب البالغة 14 يومًا في ${deadline.toLocaleDateString('ar')}.`,
        },
      })
    }

    // Generate return label via carrier
    let returnTrackingNumber: string | undefined
    let returnLabelUrl: string | undefined

    const provider = this.providerMap.get(order.shipment.carrier)
    if (provider && order.shippingAddress) {
      try {
        const returnResult = await provider.createReturnLabel({
          originalTrackingNumber: order.shipment.trackingNumber!,
          senderName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
          street: order.shippingAddress.street,
          houseNumber: order.shippingAddress.houseNumber,
          postalCode: order.shippingAddress.postalCode,
          city: order.shippingAddress.city,
          country: order.shippingAddress.country,
          weight: 1000, // default 1kg for returns
          orderId: order.id,
        })
        returnTrackingNumber = returnResult.returnTrackingNumber
        returnLabelUrl = `/api/v1/returns/${returnResult.returnTrackingNumber}/label.pdf`
      } catch (err) {
        this.logger.error(`Return label generation failed for order ${orderId}`, err)
      }
    }

    const returnRequest = await this.prisma.return.create({
      data: {
        orderId,
        shipmentId: order.shipment.id,
        reason: dto.reason,
        status: returnLabelUrl ? 'label_sent' : 'requested',
        notes: dto.notes,
        returnTrackingNumber,
        returnLabelUrl,
        deadline,
      },
    })

    // Update order status
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'returned' },
    })

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
          returnLabelUrl,
        },
      }).catch(() => {})
    }

    this.logger.log(
      `[${correlationId}] Return request: ${returnRequest.id} | order=${order.orderNumber} | reason=${dto.reason}`,
    )

    return {
      returnId: returnRequest.id,
      status: returnRequest.status,
      returnTrackingNumber,
      returnLabelUrl,
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

        this.logger.log(`[${correlationId}] Return ${returnId} → refund processed`)
      } catch (err) {
        this.logger.error(`[${correlationId}] Auto-refund failed for return ${returnId}`, err)
      }
    }

    // TODO: Restock inventory (emit event to InventoryModule)

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

  // ── DHL Tracking Polling (Cron) ────────────────────────────
  // Safety net: polls DHL for shipments stuck in transit

  @Cron(CronExpression.EVERY_HOUR)
  async pollTrackingUpdates(): Promise<void> {
    const activeShipments = await this.prisma.shipment.findMany({
      where: {
        carrier: 'dhl',
        status: { in: ['label_created', 'picked_up', 'in_transit', 'out_for_delivery'] },
        trackingNumber: { not: null },
      },
      select: { trackingNumber: true },
      take: 50,
    })

    if (activeShipments.length === 0) return

    this.logger.log(`Polling DHL tracking for ${activeShipments.length} shipment(s)`)

    // TODO: Implement DHL Tracking API polling
    // For each tracking number → GET /track/shipments?trackingNumber={tn}
    // Parse status → call updateTrackingStatus()
  }

  // ── MANUAL LABEL UPLOAD ─────────────────────────────────

  async uploadManualLabel(
    shipmentId: string,
    trackingNumber: string,
    _file: Express.Multer.File, // TODO: upload to Cloudinary
    performedBy: string,
    correlationId: string,
  ) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    })

    if (!shipment) throw this.notFound('Shipment')

    // TODO: Upload PDF to Cloudinary and get URL
    const labelUrl = `/api/v1/shipments/${trackingNumber}/label.pdf`
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
