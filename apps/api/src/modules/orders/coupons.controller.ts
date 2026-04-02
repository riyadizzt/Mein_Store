import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common'
import { JwtOptionalGuard } from '../../common/guards/jwt-optional.guard'
import { AdminMarketingService } from '../admin/services/admin-marketing.service'

@Controller('coupons')
export class CouponsController {
  constructor(private readonly marketing: AdminMarketingService) {}

  @Post('validate')
  @UseGuards(JwtOptionalGuard)
  @HttpCode(HttpStatus.OK)
  async validate(
    @Body() body: { code: string; subtotal?: number; email?: string },
    @Req() req: any,
  ) {
    return this.marketing.validateCoupon(body.code, {
      userId: req.user?.id,
      email: body.email ?? req.user?.email,
      subtotal: body.subtotal,
    })
  }
}
