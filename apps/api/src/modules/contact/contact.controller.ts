import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ContactService } from './contact.service'
import { CreateContactDto } from './dto/create-contact.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  // ── Public POST — form submission ──
  // 10 req/min per IP hard ceiling via global throttler; contact service
  // adds its own soft cap of 3/h per IP on top.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async submit(@Body() dto: CreateContactDto, @Req() req: any) {
    return this.contactService.submit(dto, {
      ipAddress: req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown',
      userAgent: req.headers['user-agent'],
    })
  }

  // ── Admin list ──
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.contactService.listForAdmin({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    })
  }

  // ── Admin unread count (bell badge) ──
  @Get('admin/unread')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async unread() {
    const count = await this.contactService.unreadCount()
    return { count }
  }

  // ── Admin mark as read ──
  @Patch('admin/:id/read')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contactService.markAsRead(id, user?.id ?? 'system')
  }

  // ── Admin status change ──
  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async setStatus(
    @Param('id') id: string,
    @Body('status') status: 'new' | 'read' | 'replied' | 'spam',
    @CurrentUser() user: any,
  ) {
    return this.contactService.updateStatus(id, status, user?.id ?? 'system')
  }

  // ── Admin single delete (hard) ──
  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async deleteOne(@Param('id') id: string) {
    return this.contactService.deleteOne(id)
  }

  // ── Admin bulk delete ──
  @Post('admin/bulk-delete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async bulkDelete(@Body('ids') ids: string[]) {
    return this.contactService.deleteMany(ids)
  }

  // ── Admin housekeeping: delete spam + old (read/replied > N days) ──
  @Post('admin/cleanup')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async cleanup(@Body('olderThanDays') olderThanDays?: number) {
    return this.contactService.deleteSpamAndOld(olderThanDays ?? 30)
  }
}
