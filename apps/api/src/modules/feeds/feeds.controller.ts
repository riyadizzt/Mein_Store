import { Controller, Get, Query, Req, Res, ForbiddenException, UseGuards, Post, HttpCode, HttpStatus, Ip } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { Response, Request } from 'express'
import { FeedsService } from './feeds.service'
import { Throttle } from '@nestjs/throttler'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../admin/services/audit.service'

@Controller()
export class FeedsController {
  constructor(
    private readonly feeds: FeedsService,
    private readonly prisma: PrismaService,
    // AuditService reaches us via FeedsModule -> AdminModule import.
    // Admin-triggered actions (token regen, cache clear) write an
    // audit row so "wer hat was wann getan" is traceable. External
    // crawler hits stay in accessLog (volume-appropriate).
    private readonly audit: AuditService,
  ) {}

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

  // Hard-fail response shape: 503 Service Unavailable with a minimal
  // body the crawler can read but nothing sensitive leaked. FeedsService
  // already logged + Sentry'd + (if email wired) alerted the admin.
  private sendHardFail(res: Response, contentType: string, body: string): void {
    res.status(HttpStatus.SERVICE_UNAVAILABLE)
    res.set('Content-Type', contentType)
    res.set('Retry-After', '60')
    res.send(body)
  }

  @Get('feeds/facebook')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async facebookFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateTokenForChannel('facebook', token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('facebook'))) {
      res.set('Content-Type', 'application/xml; charset=utf-8')
      return res.send('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed paused</title></channel></rss>')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'facebook')
    try {
      const { xml } = await this.feeds.getFacebookFeed(lang || 'de', force === 'true')
      res.set('Content-Type', 'application/xml; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=1800')
      return res.send(xml)
    } catch {
      return this.sendHardFail(res, 'application/xml; charset=utf-8',
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed temporarily unavailable</title></channel></rss>')
    }
  }

  @Get('feeds/tiktok')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async tiktokFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateTokenForChannel('tiktok', token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('tiktok'))) {
      res.set('Content-Type', 'text/tab-separated-values; charset=utf-8')
      return res.send('sku_id\ttitle\tdescription\tavailability\tcondition\tprice\tlink\timage_link\tbrand\tcolor\tsize\n')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'tiktok')
    try {
      const { csv } = await this.feeds.getTikTokFeed(lang || 'de', force === 'true')
      res.set('Content-Type', 'text/tab-separated-values; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=1800')
      return res.send(csv)
    } catch {
      return this.sendHardFail(res, 'text/tab-separated-values; charset=utf-8',
        'sku_id\ttitle\tdescription\tavailability\tcondition\tprice\tlink\timage_link\tbrand\tcolor\tsize\n')
    }
  }

  @Get('feeds/google')
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  async googleFeed(@Query('token') token: string, @Query('lang') lang: string, @Query('force') force: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.feeds.validateTokenForChannel('google', token))) throw new ForbiddenException('Invalid feed token')
    if (!(await this.isChannelEnabled('google'))) {
      res.set('Content-Type', 'application/xml; charset=utf-8')
      return res.send('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed paused</title></channel></rss>')
    }
    this.feeds.logAccess(req.ip ?? '::1', 'google')
    try {
      const { xml } = await this.feeds.getGoogleFeed(lang || 'de', force === 'true')
      res.set('Content-Type', 'application/xml; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=1800')
      return res.send(xml)
    } catch {
      return this.sendHardFail(res, 'application/xml; charset=utf-8',
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Feed temporarily unavailable</title></channel></rss>')
    }
  }

  // C7 — WhatsApp Catalog feed removed. Replaced by the
  // WhatsAppShareButton admin-tool in the product editor (manual
  // copy-paste workflow). Endpoint returns 410 Gone with a JSON
  // body explaining the replacement, so Meta's URL checkers and
  // curl-based probes get a clean stable response.
  @Get('feeds/whatsapp')
  async whatsappFeedGone(@Res() res: Response) {
    res.status(HttpStatus.GONE)
    res.set('Content-Type', 'application/json; charset=utf-8')
    return res.send(JSON.stringify({
      error: 'gone',
      message: 'WhatsApp catalog feed removed, use the smart-link admin tool',
    }))
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
  async getToken(@Query('channel') channel?: string) {
    // Per-channel tokens (C6). When the admin UI calls this without
    // a channel param (legacy behaviour) we return all 4 — lets the
    // UI show per-card tokens on the channels page in a single fetch.
    if (!channel) {
      const [facebook, tiktok, google, whatsapp] = await Promise.all([
        this.feeds.getFeedTokenForChannel('facebook'),
        this.feeds.getFeedTokenForChannel('tiktok'),
        this.feeds.getFeedTokenForChannel('google'),
        this.feeds.getFeedTokenForChannel('whatsapp'),
      ])
      return { tokens: { facebook, tiktok, google, whatsapp } }
    }
    const validChannels = ['facebook', 'tiktok', 'google', 'whatsapp'] as const
    if (!(validChannels as readonly string[]).includes(channel)) {
      throw new ForbiddenException('Invalid channel')
    }
    return { token: await this.feeds.getFeedTokenForChannel(channel as any) }
  }

  @Post('admin/feeds/token/regenerate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async regenerateToken(@Query('channel') channel: string, @Req() req: any, @Ip() ip: string) {
    const validChannels = ['facebook', 'tiktok', 'google', 'whatsapp'] as const
    if (!channel || !(validChannels as readonly string[]).includes(channel)) {
      throw new ForbiddenException('channel query parameter is required and must be one of: facebook|tiktok|google|whatsapp')
    }
    const token = await this.feeds.regenerateTokenForChannel(channel as any)
    // Security-sensitive admin action — leave an audit trail.
    // We do NOT store the token value itself (that would defeat the
    // point of rotating it); just the fact-of-rotation + actor + when.
    await this.audit.log({
      adminId: req.user?.id,
      action: 'FEED_TOKEN_REGENERATED',
      entityType: 'settings',
      changes: { after: { key: 'feed_token', rotated: true } },
      ipAddress: ip,
    }).catch(() => { /* audit failures never block the rotation */ })
    return { token }
  }

  @Post('admin/feeds/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async refreshFeeds(@Req() req: any, @Ip() ip: string) {
    this.feeds.clearCache()
    await this.audit.log({
      adminId: req.user?.id,
      action: 'FEED_CACHE_CLEARED',
      entityType: 'settings',
      changes: { after: { key: 'feed_cache', cleared: true } },
      ipAddress: ip,
    }).catch(() => { /* audit failures never block the clear */ })
    return { cleared: true }
  }

  @Get('admin/feeds/log')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getAccessLog() {
    return this.feeds.getAccessLog()
  }
}
