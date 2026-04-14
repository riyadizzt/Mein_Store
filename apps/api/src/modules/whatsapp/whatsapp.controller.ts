import { Controller, Get, Post, Query, Req, Res, HttpCode, HttpStatus, Logger, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request, Response } from 'express'
import { WhatsappService } from './whatsapp.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name)
  private readonly verifyToken: string

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
  ) {
    this.verifyToken = this.config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'malak-whatsapp-verify-2026')
  }

  // ── Webhook Verification (Meta sends GET to verify) ────────

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('WhatsApp webhook verified')
      return res.status(200).send(challenge)
    }
    this.logger.warn('WhatsApp webhook verification failed')
    return res.status(403).send('Forbidden')
  }

  // ── Webhook — Incoming Messages ────────────────────────────

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: Request) {
    const body = req.body as any

    // Meta sends different event types — we only care about messages
    if (body?.object !== 'whatsapp_business_account') return { status: 'ignored' }

    const entries = body.entry ?? []
    for (const entry of entries) {
      const changes = entry.changes ?? []
      for (const change of changes) {
        if (change.field !== 'messages') continue
        const messages = change.value?.messages ?? []
        for (const msg of messages) {
          if (msg.type !== 'text') continue // Only handle text messages for now
          const phone = msg.from // sender phone number
          const text = msg.text?.body ?? ''
          const messageId = msg.id

          if (!phone || !text) continue

          // Process async — don't block webhook response
          this.whatsapp.handleIncoming(phone, text, messageId).catch((e) => {
            this.logger.error(`Failed to process WhatsApp message from ${phone}: ${e.message}`)
          })
        }
      }
    }

    return { status: 'ok' }
  }

  // ── Admin: Chat History ────────────────────────────────────

  @Get('admin/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getHistory(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.whatsapp.getChatHistory(limit ? +limit : 50, offset ? +offset : 0)
  }

  // ── Admin: Status ──────────────────────────────────────────

  @Get('admin/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getStatus() {
    const enabled = await this.whatsapp.isEnabled()
    return {
      enabled,
      configured: this.whatsapp.isConfigured,
    }
  }
}
