import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseBoolPipe,
} from '@nestjs/common'
import { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ProfileService } from './profile.service'
import { AddressService } from './address.service'
import { WishlistService } from './wishlist.service'
import { SessionService } from './session.service'
import { GdprService } from './gdpr.service'
import { UserOrdersService } from './user-orders.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ChangeEmailDto } from './dto/change-email.dto'
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto'
import { OrderHistoryQueryDto } from './dto/order-history.dto'
import { DeleteAccountDto } from './dto/delete-account.dto'

@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly addressService: AddressService,
    private readonly wishlistService: WishlistService,
    private readonly sessionService: SessionService,
    private readonly gdprService: GdprService,
    private readonly userOrdersService: UserOrdersService,
  ) {}

  // ── Profile ───────────────────────────────────────────────────

  @Get()
  getProfile(@Req() req: any) {
    return this.profileService.findMe(req.user.id)
  }

  @Patch()
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.id, dto)
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Only image files are allowed'), false)
        }
        cb(null, true)
      },
    }),
  )
  uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.profileService.uploadProfileImage(req.user.id, file)
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.profileService.changePassword(req.user.id, dto)
  }

  @Post('email/change')
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailChange(@Req() req: any, @Body() dto: ChangeEmailDto) {
    return this.profileService.requestEmailChange(req.user.id, dto)
  }

  // ── Addresses ─────────────────────────────────────────────────

  @Get('addresses')
  getAddresses(@Req() req: any) {
    return this.addressService.findAll(req.user.id)
  }

  @Post('addresses')
  @HttpCode(HttpStatus.CREATED)
  createAddress(@Req() req: any, @Body() dto: CreateAddressDto) {
    return this.addressService.create(req.user.id, dto)
  }

  @Patch('addresses/:id')
  updateAddress(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.update(req.user.id, id, dto)
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAddress(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressService.softDelete(req.user.id, id)
  }

  // ── Order History ─────────────────────────────────────────────

  @Get('orders')
  getOrders(@Req() req: any, @Query() query: OrderHistoryQueryDto) {
    return this.userOrdersService.getOrderHistory(req.user.id, query)
  }

  @Get('orders/:id')
  getOrder(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.userOrdersService.findOne(req.user.id, id)
  }

  @Post('orders/:id/reorder')
  @HttpCode(HttpStatus.OK)
  reorder(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.userOrdersService.reorder(req.user.id, id)
  }

  @Get('orders/:id/invoice')
  getInvoice(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.userOrdersService.getInvoiceUrl(req.user.id, id)
  }

  @Get('orders/:orderId/return-label')
  async getReturnLabel(@Req() req: any, @Param('orderId', ParseUUIDPipe) orderId: string, @Query('type') type: string, @Res() res: Response) {
    const buffer = await this.userOrdersService.getReturnLabelPdf(req.user.id, orderId, type ?? 'internal')
    const filename = type === 'dhl' ? 'DHL-Ruecksendeetikett.pdf' : 'Retourenetikett.pdf'
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Length': buffer.length.toString() })
    res.end(buffer)
  }

  // ── Wishlist ──────────────────────────────────────────────────

  @Get('wishlist')
  getWishlist(@Req() req: any) {
    return this.wishlistService.findAll(req.user.id)
  }

  @Post('wishlist/:productId')
  @HttpCode(HttpStatus.CREATED)
  addToWishlist(
    @Req() req: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('notify', new ParseBoolPipe({ optional: true })) notify: boolean = false,
  ) {
    return this.wishlistService.add(req.user.id, productId, notify)
  }

  @Delete('wishlist/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFromWishlist(@Req() req: any, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.wishlistService.remove(req.user.id, productId)
  }

  @Patch('wishlist/:productId/notify')
  toggleWishlistNotify(
    @Req() req: any,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('enabled', ParseBoolPipe) enabled: boolean,
  ) {
    return this.wishlistService.toggleNotify(req.user.id, productId, enabled)
  }

  // ── Sessions ──────────────────────────────────────────────────

  @Get('sessions')
  getSessions(@Req() req: any) {
    return this.sessionService.listSessions(req.user.id)
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessionService.revokeSession(req.user.id, id)
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeAllSessions(@Req() req: any) {
    return this.sessionService.revokeAllSessions(req.user.id)
  }

  // ── GDPR ──────────────────────────────────────────────────────

  @Get('gdpr/consents')
  getConsents(@Req() req: any) {
    return this.gdprService.getConsents(req.user.id)
  }

  @Post('gdpr/data-export')
  @HttpCode(HttpStatus.ACCEPTED)
  requestDataExport(@Req() req: any) {
    return this.gdprService.requestDataExport(req.user.id)
  }

  @Post('gdpr/delete-account')
  @HttpCode(HttpStatus.ACCEPTED)
  scheduleAccountDeletion(@Req() req: any, @Body() dto: DeleteAccountDto) {
    return this.gdprService.scheduleAccountDeletion(req.user.id, dto.password)
  }

  @Delete('gdpr/delete-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelAccountDeletion(@Req() req: any) {
    return this.gdprService.cancelAccountDeletion(req.user.id)
  }
}
