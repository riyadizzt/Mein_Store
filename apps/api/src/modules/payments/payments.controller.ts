import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Headers,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { JwtOptionalGuard } from '../../common/guards/jwt-optional.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaymentsService } from './payments.service'
import { InvoiceService } from './invoice.service'
import { CreatePaymentDto } from './dto/create-payment.dto'
import { CreateRefundDto } from './dto/create-refund.dto'

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly invoiceService: InvoiceService,
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

  @Get('orders/:orderId/invoice')
  @UseGuards(JwtAuthGuard)
  async getInvoice(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() req: any,
  ) {
    return this.invoiceService.getOrGenerateInvoice(orderId, req.user.id)
  }
}
