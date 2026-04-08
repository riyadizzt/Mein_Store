import { Controller, Get, Query, Req, Res, ForbiddenException, UseGuards, Post, HttpCode, HttpStatus } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { Response, Request } from 'express'
import { FeedsService } from './feeds.service'
import { Throttle } from '@nestjs/throttler'
import { PrismaService } from '../../prisma/prisma.service'

@Controller()
export class FeedsController {
  constructor(private readonly feeds: FeedsService, private readonly prisma: PrismaService) {}

  // ── Public Settings (no auth — for pixel IDs, WhatsApp config) ──

  @Get('settings/public')
  async getPublicSettings() {
    const keys = ['meta_pixel_id', 'tiktok_pixel_id', 'whatsapp_number', 'whatsapp_enabled', 'whatsapp_message_de', 'whatsapp_message_ar', 'channel_facebook_enabled', 'channel_tiktok_enabled', 'channel_google_enabled', 'channel_whatsapp_enabled', 'ai_global_enabled', 'ai_customer_chat_enabled', 'posthog_enabled', 'posthog_key', 'posthog_host', 'cookie_banner_enabled', 'returnsEnabled', 'welcomePopupEnabled']
    const settings = await this.prisma.shopSetting.findMany({ where: { key: { in: keys } } })
    const result: Record<string, string> = {}
    for (const s of settings) result[s.key] = s.value
    return result
  }

  // ── Public Feed Endpoints (Token-Protected) ──────────────────

  private async isChannelEnabled(channel: string): Promise<boolean> {
    const setting = await this.prisma.shopSetting.findFirst({ where: { key: `channel_${channel}_enabled` } })
    // Default: enabled (if setting doesn't exist yet, feed is active)
    return !setting || setting.value !== 'false'
  }

  @Get('feeds/facebook')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async facebookFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateToken(token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('facebook'))) {
      res.set('Content-Type', 'application/xml; charset=utf-8')
      return res.send('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed paused</title></channel></rss>')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'facebook')
    const { xml } = await this.feeds.getFacebookFeed(lang || 'de', force === 'true')
    res.set('Content-Type', 'application/xml; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=1800')
    return res.send(xml)
  }

  @Get('feeds/tiktok')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async tiktokFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateToken(token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('tiktok'))) {
      res.set('Content-Type', 'text/tab-separated-values; charset=utf-8')
      return res.send('sku_id\ttitle\tdescription\tavailability\tcondition\tprice\tlink\timage_link\tbrand\tcolor\tsize\n')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'tiktok')
    const { csv } = await this.feeds.getTikTokFeed(lang || 'de', force === 'true')
    res.set('Content-Type', 'text/tab-separated-values; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=1800')
    return res.send(csv)
  }

  @Get('feeds/google')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async googleFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateToken(token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('google'))) {
      res.set('Content-Type', 'application/xml; charset=utf-8')
      return res.send('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed paused</title></channel></rss>')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'google')
    const { xml } = await this.feeds.getGoogleFeed(lang || 'de', force === 'true')
    res.set('Content-Type', 'application/xml; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=1800')
    return res.send(xml)
  }

  @Get('feeds/whatsapp')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async whatsappFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateToken(token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('whatsapp'))) {
      res.set('Content-Type', 'application/json; charset=utf-8')
      return res.send(JSON.stringify({ data: [], total: 0, paused: true }))
    }
    this.feeds.logAccess(req.ip ?? '::1', 'whatsapp')
    const { json } = await this.feeds.getWhatsAppFeed(lang || 'de', force === 'true')
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=1800')
    return res.send(json)
  }

  // ── Admin Channel Settings ────────────────────────────────────

  @Get('admin/channels/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getChannelSettings() {
    const keys = [
      'meta_pixel_id', 'tiktok_pixel_id',
      'whatsapp_number', 'whatsapp_enabled', 'whatsapp_message_de', 'whatsapp_message_ar',
      'channel_facebook_enabled', 'channel_tiktok_enabled', 'channel_google_enabled', 'channel_whatsapp_enabled',
    ]
    const rows = await this.prisma.shopSetting.findMany({ where: { key: { in: keys } } })
    const result: Record<string, string> = {}
    for (const r of rows) result[r.key] = r.value
    return result
  }

  // ── Admin Endpoints ──────────────────────────────────────────

  @Get('admin/feeds/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getStats() {
    return this.feeds.getFeedStats()
  }

  @Get('admin/feeds/token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getToken() {
    return { token: await this.feeds.getFeedToken() }
  }

  @Post('admin/feeds/token/regenerate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async regenerateToken() {
    return { token: await this.feeds.regenerateToken() }
  }

  @Post('admin/feeds/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async refreshFeeds() {
    this.feeds.clearCache()
    return { cleared: true }
  }

  @Get('admin/feeds/log')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getAccessLog() {
    return this.feeds.getAccessLog()
  }
}
