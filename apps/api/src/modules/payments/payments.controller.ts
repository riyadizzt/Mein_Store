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
    if (!apiKey) return { paid: false, reason: 'SumUp not configured' }

    try {
      const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${payment.providerPaymentId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      const data: any = await res.json()

      if (data.status === 'PAID') {
        // Actually paid — now confirm
        await this.paymentsService.markAsCaptured(orderId)
        return { paid: true, status: data.status }
      }

      return { paid: false, status: data.status ?? 'UNKNOWN' }
    } catch (err: any) {
      return { paid: false, reason: err.message }
    }
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

  // ── Public: Available payment methods ───────────────────
  @Get('methods')
  async getAvailableMethods() {
    const vorkasseConfigured = await this.vorkasseProvider.isConfigured()
    const sumupConfigured = this.sumupProvider.isConfigured()
    const paypalConfigured = this.paypalProvider.isConfigured()

    return {
      stripe: true,
      klarna: !!process.env.KLARNA_USERNAME,
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
