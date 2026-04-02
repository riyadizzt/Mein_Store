import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Headers,
  NotFoundException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { ShipmentsService } from './shipments.service'
import { CreateShipmentDto } from './dto/create-shipment.dto'
import { CreateReturnRequestDto } from './dto/return-request.dto'
import { DHLProvider } from './providers/dhl.provider'
import { PrismaService } from '../../prisma/prisma.service'

@Controller()
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly dhlProvider: DHLProvider,
    private readonly prisma: PrismaService,
  ) {}

  // Admin: create shipment (generate label + tracking)
  @Post('shipments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @HttpCode(HttpStatus.CREATED)
  createShipment(
    @Body() dto: CreateShipmentDto,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.shipmentsService.createShipment(dto, req.user.id, correlationId ?? 'no-corr')
  }

  // Customer: request return (14-Tage Widerruf)
  @Post('orders/:id/return-request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  createReturnRequest(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReturnRequestDto,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.shipmentsService.createReturnRequest(orderId, dto, req.user.id, correlationId ?? 'no-corr')
  }

  // Admin: mark return as received → auto refund
  @Post('returns/:id/received')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @HttpCode(HttpStatus.OK)
  markReturnReceived(
    @Param('id', ParseUUIDPipe) returnId: string,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.shipmentsService.markReturnReceived(returnId, req.user.id, correlationId ?? 'no-corr')
  }

  // DHL Tracking Webhook — signature verified via shared secret
  @Post('shipments/webhooks/dhl')
  @HttpCode(HttpStatus.OK)
  async dhlTrackingWebhook(
    @Body() body: any,
    @Headers('x-dhl-signature') dhlSignature: string,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    // Verify DHL webhook signature (shared secret HMAC)
    const secret = process.env.DHL_WEBHOOK_SECRET
    if (secret) {
      const crypto = await import('crypto')
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex')
      if (dhlSignature !== expected) {
        return { received: false, error: 'Invalid signature' }
      }
    }

    const trackingNumber = body?.shipmentNo ?? body?.trackingNumber
    const status = body?.status ?? body?.event?.statusCode
    if (trackingNumber && status) {
      await this.shipmentsService.updateTrackingStatus(
        trackingNumber,
        status,
        correlationId ?? 'wh-dhl',
      )
    }
    return { received: true }
  }

  // ── Public Tracking (no auth) ─────────────────────────
  @Get('tracking')
  async getPublicTracking(@Query('nr') trackingNumber: string) {
    if (!trackingNumber) throw new NotFoundException('Tracking number required')

    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNumber },
      include: {
        order: {
          select: {
            orderNumber: true, status: true, createdAt: true,
            items: {
              select: {
                snapshotName: true, snapshotSku: true, quantity: true,
                variant: { select: { color: true, size: true, product: { select: { images: { select: { url: true }, take: 1 } } } } },
              },
            },
          },
        },
      },
    })
    if (!shipment) throw new NotFoundException('Shipment not found')

    return {
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      carrier: shipment.carrier,
      status: shipment.status,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
      estimatedDelivery: shipment.estimatedDelivery,
      orderNumber: shipment.order.orderNumber,
      orderStatus: shipment.order.status,
      orderedAt: shipment.order.createdAt,
      items: shipment.order.items.map((item) => ({
        name: item.snapshotName,
        sku: item.snapshotSku,
        quantity: item.quantity,
        color: item.variant?.color,
        size: item.variant?.size,
        imageUrl: item.variant?.product?.images?.[0]?.url,
      })),
    }
  }

  // ── DHL API Status Check ──────────────────────────────
  @Post('shipments/validate-address')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @HttpCode(HttpStatus.OK)
  async validateAddress(@Body() body: { street: string; houseNumber?: string; postalCode: string; city: string; country: string }) {
    return this.dhlProvider.validateAddress(body)
  }

  @Get('shipments/dhl-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  getDhlStatus() {
    return {
      isConfigured: this.dhlProvider.isApiAvailable,
      mode: this.dhlProvider.isApiAvailable ? 'automatic' : 'manual',
      message: this.dhlProvider.isApiAvailable
        ? 'DHL API aktiv — Labels werden automatisch erstellt.'
        : 'DHL API nicht konfiguriert — Labels bitte manuell im DHL Geschäftskundenportal erstellen.',
    }
  }

  // ── Manual Label Upload ───────────────────────────────
  @Patch('shipments/:id/label')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new Error('Nur PDF-Dateien erlaubt'), false)
        }
        cb(null, true)
      },
    }),
  )
  async uploadManualLabel(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body('trackingNumber') trackingNumber: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.shipmentsService.uploadManualLabel(
      shipmentId,
      trackingNumber,
      file,
      req.user.id,
      correlationId ?? 'no-corr',
    )
  }
}
