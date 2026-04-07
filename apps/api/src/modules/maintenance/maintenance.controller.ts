import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { MaintenanceService } from './maintenance.service'

@Controller()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  // Public — check if maintenance mode is on + get display settings
  @Get('maintenance/status')
  async getStatus() {
    return this.maintenance.getPublicSettings()
  }

  // Public — collect email during maintenance
  @Post('maintenance/subscribe')
  @HttpCode(HttpStatus.OK)
  async subscribe(@Body('email') email: string, @Body('locale') locale: string) {
    if (!email || !email.includes('@')) return { success: false }
    await this.maintenance.trackView()
    return { success: await this.maintenance.collectEmail(email, locale ?? 'de') }
  }

  // Public — track page view
  @Post('maintenance/view')
  @HttpCode(HttpStatus.OK)
  async trackView() {
    await this.maintenance.trackView()
    return { ok: true }
  }

  // Admin — get collected emails
  @Get('admin/maintenance/emails')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getEmails() {
    return this.maintenance.getCollectedEmails()
  }

  // Admin — get stats
  @Get('admin/maintenance/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getStats() {
    const settings = await this.maintenance.getSettings()
    const emailCount = await this.maintenance.getEmailCount()
    return {
      enabled: settings.maintenance_enabled === 'true',
      views: Number(settings.maintenance_views ?? 0),
      emails: emailCount,
      activeSince: settings.maintenance_activated_at ?? null,
    }
  }
}
