import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PermissionGuard } from '../../common/permissions/permission.guard'
import { RequirePermission } from '../../common/permissions/require-permission.decorator'
import { PERMISSIONS } from '../../common/permissions/permission.constants'
import { Roles } from '../../common/decorators/roles.decorator'
import {
  WebhookService,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
} from './webhook.service'
import { WebhookDispatcherService } from './webhook-dispatcher.service'

@Controller('admin/webhooks')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Roles('admin', 'super_admin')
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  // ── Subscription CRUD ────────────────────────────────────

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  list(@Query('isActive') isActive?: string) {
    const active = isActive === 'true' ? true : isActive === 'false' ? false : undefined
    return this.webhooks.list({ isActive: active })
  }

  @Get('events')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  availableEvents() {
    return { events: this.webhooks.getAvailableEvents() }
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  get(@Param('id') id: string) {
    return this.webhooks.findOne(id)
  }

  @Post()
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  create(@Body() body: CreateSubscriptionInput, @Req() req: any) {
    return this.webhooks.create({ ...body, createdBy: req.user?.id ?? null })
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  update(@Param('id') id: string, @Body() body: UpdateSubscriptionInput) {
    return this.webhooks.update(id, body)
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.webhooks.remove(id)
  }

  @Post(':id/rotate-secret')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.OK)
  rotateSecret(@Param('id') id: string) {
    return this.webhooks.rotateSecret(id)
  }

  @Post(':id/test')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.OK)
  sendTest(@Param('id') id: string) {
    return this.dispatcher.sendTestEvent(id)
  }

  // ── Delivery log (read-only for admin, retry button) ─────

  @Get('deliveries/logs')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  listLogs(
    @Query('subscriptionId') subscriptionId?: string,
    @Query('status') status?: 'pending' | 'success' | 'failed',
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.webhooks.listDeliveryLogs({
      subscriptionId,
      status,
      eventType,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    })
  }

  @Get('deliveries/logs/:id')
  @RequirePermission(PERMISSIONS.SETTINGS_VIEW)
  getLog(@Param('id') id: string) {
    return this.webhooks.getDeliveryLog(id)
  }

  @Post('deliveries/logs/:id/retry')
  @RequirePermission(PERMISSIONS.SETTINGS_EDIT)
  @HttpCode(HttpStatus.OK)
  retryLog(@Param('id') id: string) {
    return this.dispatcher.retryDelivery(id)
  }
}
