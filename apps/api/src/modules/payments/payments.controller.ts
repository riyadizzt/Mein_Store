import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Headers,
  Logger,
} from '@nestjs/common'
import { Response } from 'express'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { JwtOptionalGuard } from '../../common/guards/jwt-optional.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaymentsService } from './payments.service'
import { InvoiceService } from './invoice.service'
import { VorkasseProvider } from './providers/vorkasse.provider'
import { SumUpProvider } from './providers/sumup.provider'
import { PayPalProvider } from './providers/paypal.provider'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { CreateRefundDto } from './dto/create-refund.dto'

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name)

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly invoiceService: InvoiceService,
    private readonly vorkasseProvider: VorkasseProvider,
    private readonly sumupProvider: SumUpProvider,
    private readonly paypalProvider: PayPalProvider,
  ) {}

  @Post()
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.CREATED)
  createPayment(
    @Body() dto: CreatePaymentDto,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.paymentsService.createPayment(dto, req.user?.id ?? null, correlationId ?? 'no-corr')
  }

  @Post(':orderId/confirm')
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.OK)
  async confirmPayment(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.paymentsService.markAsCaptured(orderId)
  }

  @Post('refunds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.CREATED)
  createRefund(
    @Body() dto: CreateRefundDto,
    @Req() req: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    return this.paymentsService.createRefund(dto, req.user.id, correlationId ?? 'no-corr')
  }

  // ── Admin: Confirm Vorkasse Payment ──────────────────────
  @Post(':orderId/confirm-vorkasse')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async confirmVorkassePayment(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() req: any,
  ) {
    return this.paymentsService.confirmVorkassePayment(orderId, req.user.id)
  }

  // ── SumUp: Verify checkout status before confirming ─────
  @Post(':orderId/verify-sumup')
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.OK)
  async verifySumup(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const payment = await this.paymentsService.findByOrderId(orderId)
    if (!payment || payment.provider !== 'SUMUP' || !payment.providerPaymentId) {
      return { paid: false, reason: 'Not a SumUp payment' }
    }

    // Check SumUp checkout status via API
    const apiKey = process.env.SUMUP_API_KEY
    if (!apiKey) {
      this.logger.error(
        `SUMUP_API_KEY missing — cannot verify SumUp payment for order ${orderId}. ` +
        `Configure SUMUP_API_KEY in environment.`,
      )
      return { paid: false, reason: 'SumUp not configured' }
    }

    try {
      const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${payment.providerPaymentId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        this.logger.warn(
          `SumUp verify returned HTTP ${res.status} for order ${orderId}: ${text.slice(0, 200)}`,
        )
        return { paid: false, reason: `SumUp API HTTP ${res.status}` }
      }
      const data: any = await res.json()

      if (data.status === 'PAID') {
        // Save SumUp transaction_id for refunds (different from checkout_id!)
        const transactionId = data.transaction_id || data.transaction_code || ''
        if (transactionId) {
          await this.paymentsService.updateProviderRefundId(payment.id, transactionId)
        }
        await this.paymentsService.markAsCaptured(orderId)
        return { paid: true, status: data.status, transactionId }
      }

      return { paid: false, status: data.status ?? 'UNKNOWN' }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`SumUp verify failed for order ${orderId}: ${msg}`)
      return { paid: false, reason: msg }
    }
  }

  // ── Retry Payment (for pending/failed orders) ─────────
  @Post(':orderId/retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async retryPayment(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body('method') newMethod?: string,
  ) {
    return this.paymentsService.retryPayment(orderId, newMethod)
  }

  // ── PayPal: Capture after redirect ──────────────────────
  @Post(':orderId/capture-paypal')
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.OK)
  async capturePaypal(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const payment = await this.paymentsService.findByOrderId(orderId)
    if (!payment || payment.provider !== 'PAYPAL') {
      throw new Error('Not a PayPal payment')
    }
    const result = await this.paypalProvider.captureOrder(payment.providerPaymentId!)
    if (result.status === 'COMPLETED') {
      return this.paymentsService.markAsCaptured(orderId)
    }
    return { status: result.status }
  }

  // ── Abort: cancel a pending order when the user backs out at the gateway.
  // Called by the checkout page when it sees ?cancelled=<orderId> in the URL
  // (e.g. PayPal "Abbrechen und zurück zu Malak Bekleidung"). This avoids
  // leaving orphan pending_payment orders sitting around for the 30-min cron
  // to clean up — the customer sees an immediate, clean state.
  @Post(':orderId/abort')
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.OK)
  async abortPendingOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.paymentsService.abortPendingOrder(orderId)
  }

  // ── Public: Available payment methods ───────────────────
  @Get('methods')
  async getAvailableMethods() {
    // Check admin toggles from ShopSettings
    const settings = await this.paymentsService.getPaymentToggles()
    const vorkasseConfigured = settings.vorkasse && await this.vorkasseProvider.isConfigured()
    const sumupConfigured = settings.sumup && this.sumupProvider.isConfigured()
    const paypalConfigured = settings.paypal && this.paypalProvider.isConfigured()
    const klarnaConfigured = settings.klarna && !!process.env.KLARNA_USERNAME

    return {
      stripe: settings.stripe,
      klarna: klarnaConfigured,
      paypal: paypalConfigured,
      vorkasse: vorkasseConfigured,
      sumup: sumupConfigured,
      vorkasseBankDetails: vorkasseConfigured ? await this.vorkasseProvider.getBankDetails() : null,
    }
  }

  // ── Invoice PDF Download (streams actual PDF) ────────────
  @Get('orders/:orderId/invoice')
  @UseGuards(JwtAuthGuard)
  async getInvoice(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.invoiceService.getOrGenerateInvoice(orderId, req.user.id)

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Rechnung-${orderId.slice(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    })
    res.end(pdfBuffer)
  }
}
