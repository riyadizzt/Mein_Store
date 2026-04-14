import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Headers,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common'
import { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import * as fs from 'fs'
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
  private readonly logger = new Logger(ShipmentsController.name)

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

  // PUBLIC guest return — no JWT, auth via order.notes.confirmationToken.
  // The link in the shipped/delivered email lands here. Guarantees that
  // stub-user guests (no password set) can still exercise their 14-day
  // withdrawal right under §355 BGB without being forced to create an
  // account first.
  @Get('public/orders/:id/return-info')
  @HttpCode(HttpStatus.OK)
  getPublicReturnInfo(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Query('token') token: string,
  ) {
    return this.shipmentsService.getReturnPreFillByToken(orderId, token)
  }

  @Post('public/orders/:id/return-request')
  @HttpCode(HttpStatus.CREATED)
  createPublicReturnRequest(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Query('token') token: string,
    @Body() dto: CreateReturnRequestDto,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.shipmentsService.createReturnRequestByToken(
      orderId,
      dto,
      token,
      correlationId ?? 'no-corr',
    )
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
    if (!secret) {
      // Hard fail in production — webhook must be signed.
      // In development it's acceptable to run without a signature, but we log a loud warning.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          `[${correlationId}] DHL_WEBHOOK_SECRET is not configured — rejecting webhook for security`,
        )
        throw new UnauthorizedException('Webhook signing secret is not configured')
      }
      this.logger.warn(
        `[${correlationId}] DHL_WEBHOOK_SECRET missing — signature verification skipped (dev only)`,
      )
    } else {
      const crypto = await import('crypto')
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex')
      if (dhlSignature !== expected) {
        this.logger.warn(
          `[${correlationId}] DHL webhook signature mismatch — rejecting request`,
        )
        throw new UnauthorizedException('Invalid webhook signature')
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

  // ── Download Shipping Label PDF ───────────────────────
  @Get('shipments/labels/:trackingNumber')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  async downloadLabel(
    @Param('trackingNumber') trackingNumber: string,
    @Res() res: Response,
  ) {
    // Check if it's a return label request
    const isReturn = trackingNumber.startsWith('RET-')
    const actualTn = isReturn ? trackingNumber.replace('RET-', '') : trackingNumber

    const labelPath = isReturn
      ? this.shipmentsService.getReturnLabelPdfPath(actualTn)
      : this.shipmentsService.getLabelPdfPath(trackingNumber)

    if (!labelPath) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'LabelNotFound',
        message: {
          de: 'Versandlabel nicht gefunden.',
          en: 'Shipping label not found.',
          ar: 'بطاقة الشحن غير موجودة.',
        },
      })
    }

    const fileStream = fs.createReadStream(labelPath)
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="label-${trackingNumber}.pdf"`,
    })
    fileStream.pipe(res)
  }

  // ── Public Address Validation (no auth, for checkout) ──
  @Post('address/validate')
  @HttpCode(HttpStatus.OK)
  async validateAddressPublic(@Body() body: {
    street: string; houseNumber?: string; postalCode: string; city: string; country?: string
  }) {
    const country = (body.country ?? 'DE').toUpperCase()

    // Step 1: Basic format validation (always works, even without DHL API)
    const warnings: string[] = []
    if (!body.street || body.street.trim().length < 3) warnings.push('street_too_short')
    if (country === 'DE' && body.postalCode && !/^\d{5}$/.test(body.postalCode.trim())) warnings.push('plz_invalid')
    if (country === 'DE' && !body.houseNumber?.trim()) warnings.push('house_number_missing')
    if (!body.city || body.city.trim().length < 2) warnings.push('city_too_short')

    // Step 2: DHL address validation — only if basic checks passed (no point calling DHL with garbage)
    let dhlValid: boolean | null = null
    if (warnings.length === 0 && this.dhlProvider.isApiAvailable) {
      try {
        const result = await this.dhlProvider.validateAddress({
          street: body.street,
          houseNumber: body.houseNumber ?? '',
          postalCode: body.postalCode,
          city: body.city,
          country,
        })
        dhlValid = result.valid
        if (!result.valid) {
          warnings.push('dhl_address_not_verified')
        }
      } catch {
        // DHL API error — skip, basic validation is enough
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
      dhlChecked: dhlValid !== null,
    }
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
        : 'DHL API nicht konfiguriert — Labels bitte manuell im DHL Geschaeftskundenportal erstellen.',
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
