import { Injectable, Logger, Inject, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import * as Handlebars from 'handlebars'
import * as path from 'path'
import * as fs from 'fs'
import { EmailType, EMAIL_SUBJECTS, EMAIL_FROM_MAP } from './email.constants'
import { IEmailProvider, EMAIL_PROVIDER } from './email-provider.interface'
import { EmailRateLimiter } from './rate-limit/email-rate-limiter'
import { PrismaService } from '../../prisma/prisma.service'

// ── Job payload (goes into BullMQ EMAIL_QUEUE) ────────────────

export interface EmailAttachmentPayload {
  filename: string
  contentBase64: string // PDF as base64 (for JSON serialization in BullMQ)
  contentType?: string
}

export interface EmailJobPayload {
  to: string
  type: EmailType
  lang: string
  data: Record<string, unknown>
  attachments?: EmailAttachmentPayload[]
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private readonly templateCache = new Map<string, Handlebars.TemplateDelegate>()
  private layoutDe!: Handlebars.TemplateDelegate
  private layoutEn!: Handlebars.TemplateDelegate
  private layoutAr!: Handlebars.TemplateDelegate
  private readonly templatesDir: string

  constructor(
    private readonly config: ConfigService,
    @Inject('EMAIL_QUEUE') private readonly emailQueue: Queue,
    @Inject(EMAIL_PROVIDER) @Optional() private readonly directProvider: IEmailProvider | null,
    private readonly rateLimiter: EmailRateLimiter,
    private readonly prisma: PrismaService,
  ) {
    // Try __dirname first (production), fall back to source path (dev)
    const dirnamePath = path.join(__dirname, 'templates')
    const srcPath = path.join(process.cwd(), 'src', 'modules', 'email', 'templates')
    this.templatesDir = fs.existsSync(dirnamePath) ? dirnamePath : srcPath
    this.preloadLayouts()
    this.loadDbSettings().catch(() => {})

    // Register Handlebars helpers
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b)
  }

  // ── Public API: enqueue email (non-blocking) ─────────────────

  async enqueue(payload: EmailJobPayload): Promise<void> {
    // Direct send mode: bypass queue, send immediately (useful for dev or when worker is down)
    if (this.config.get('EMAIL_SEND_DIRECT') === 'true' && this.directProvider) {
      try {
        const { html, subject, from } = this.renderEmail(payload.type, payload.lang, payload.data)
        await this.directProvider.send({
          to: payload.to,
          from,
          subject,
          html,
          tags: [{ name: 'type', value: payload.type }, { name: 'lang', value: payload.lang }],
          attachments: payload.attachments?.map((a) => ({
            filename: a.filename,
            content: a.contentBase64,
            contentType: a.contentType ?? 'application/pdf',
          })),
        })
        this.logger.log(`Email SENT directly: ${payload.type} → ${payload.to}`)
        return
      } catch (err: any) {
        this.logger.error(`Direct email send failed: ${err.message}`)
      }
    }

    // Queue mode: add to BullMQ for async processing
    await this.emailQueue.add('send-email', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    })
    this.logger.debug(`Email queued: ${payload.type} → ${payload.to}`)
  }

  // ── Convenience methods ──────────────────────────────────────

  async queueWelcome(to: string, lang: string, firstName: string): Promise<void> {
    await this.enqueue({
      to,
      type: 'welcome',
      lang,
      data: {
        firstName,
        loginUrl: `${this.config.get('APP_URL', 'https://malak-bekleidung.com')}/login`,
      },
    })
  }

  async queueEmailVerification(to: string, lang: string, firstName: string, verifyUrl: string): Promise<void> {
    await this.enqueue({
      to,
      type: 'email-verification',
      lang,
      data: { firstName, verificationUrl: verifyUrl, expiresIn: '24 Stunden' },
    })
  }

  async queueEmailChange(to: string, lang: string, firstName: string, token: string): Promise<void> {
    const confirmUrl = `${this.config.get('APP_URL', 'https://malak-bekleidung.com')}/confirm-email-change?token=${token}`
    await this.enqueue({
      to,
      type: 'email-change',
      lang,
      data: { firstName, confirmUrl, expiresIn: '24 Stunden' },
    })
  }

  async queuePasswordReset(to: string, lang: string, firstName: string, userId: string, token: string): Promise<boolean> {
    // Rate limit: max 3 per hour per user
    const allowed = await this.rateLimiter.check(`pwd-reset:${userId}`, 3, 3600)
    if (!allowed) {
      this.logger.warn(`Password reset rate limited for user ${userId}`)
      return false
    }

    const resetUrl = `${this.config.get('APP_URL', 'https://malak-bekleidung.com')}/reset-password?token=${token}`
    await this.enqueue({
      to,
      type: 'password-reset',
      lang,
      data: { firstName, resetUrl, expiresIn: '15 Minuten' },
    })
    return true
  }

  async queueOrderConfirmation(to: string, lang: string, data: Record<string, unknown>): Promise<void> {
    await this.enqueue({ to, type: 'order-confirmation', lang, data })
  }

  async queueInvoiceEmail(to: string, lang: string, data: Record<string, unknown>, pdfBuffer: Buffer, invoiceNumber: string): Promise<void> {
    await this.enqueue({
      to,
      type: 'invoice',
      lang,
      data,
      attachments: [{
        filename: `${invoiceNumber}.pdf`,
        contentBase64: pdfBuffer.toString('base64'),
        contentType: 'application/pdf',
      }],
    })
  }

  async queueOrderStatus(to: string, lang: string, data: Record<string, unknown>): Promise<void> {
    await this.enqueue({ to, type: 'order-status', lang, data })
  }

  async queueOrderCancellation(to: string, lang: string, data: Record<string, unknown>): Promise<void> {
    await this.enqueue({ to, type: 'order-cancellation', lang, data })
  }

  async queueGuestInvite(to: string, lang: string, data: Record<string, unknown>): Promise<void> {
    await this.enqueue({ to, type: 'guest-invite' as any, lang, data })
  }

  async queueAdminAlert(to: string, lang: string, message: string): Promise<void> {
    await this.enqueue({ to, type: 'admin-alert' as any, lang, data: { message, timestamp: new Date().toISOString() } })
  }

  // ── Render full HTML email ───────────────────────────────────

  renderEmail(type: EmailType, lang: string, data: Record<string, unknown>): { html: string; subject: string; from: string } {
    // In dev mode, clear file cache so template changes are picked up
    if (process.env.NODE_ENV !== 'production') this.templateCache.clear()
    const effectiveLang = this.hasTemplate(type, lang) ? lang : 'de'

    // Render content template
    const contentTemplate = this.loadTemplate(type, effectiveLang)
    const content = contentTemplate(data)

    // Render layout with content injected
    const layout = effectiveLang === 'ar' ? this.layoutAr : effectiveLang === 'en' ? this.layoutEn : this.layoutDe
    const companyData = this.getCompanyData()
    const html = layout({ ...companyData, content, ...data })

    // Resolve subject (replace #{orderNumber} etc.)
    let subject = EMAIL_SUBJECTS[type]?.[effectiveLang] ?? EMAIL_SUBJECTS[type]?.de ?? type
    subject = subject.replace(/#\{(\w+)\}/g, (_, key) => String(data[key] ?? ''))

    // Resolve from address
    const fromEnvKey = EMAIL_FROM_MAP[type] ?? 'EMAIL_FROM_NOREPLY'
    const fromEmail = this.config.get(fromEnvKey, 'noreply@malak-bekleidung.com')
    const displayName = this.config.get('EMAIL_DISPLAY_NAME', 'Malak Shop')
    const from = `${displayName} <${fromEmail}>`

    return { html, subject, from }
  }

  // ── Template loading ─────────────────────────────────────────

  private preloadLayouts(): void {
    try {
      this.layoutDe = this.loadTemplate('layout', 'de')
      this.layoutEn = this.loadTemplate('layout', 'en')
      this.layoutAr = this.loadTemplate('layout', 'ar')
    } catch {
      this.logger.warn('Email templates not found — templates will be loaded on demand')
    }
  }

  private loadTemplate(name: string, lang: string): Handlebars.TemplateDelegate {
    const cacheKey = `${lang}/${name}`
    if (this.templateCache.has(cacheKey)) return this.templateCache.get(cacheKey)!

    const filePath = path.join(this.templatesDir, lang, `${name}.hbs`)
    const source = fs.readFileSync(filePath, 'utf-8')
    const compiled = Handlebars.compile(source)
    this.templateCache.set(cacheKey, compiled)
    return compiled
  }

  templateExists(name: string, lang: string): boolean {
    return this.hasTemplate(name, lang)
  }

  private hasTemplate(name: string, lang: string): boolean {
    const filePath = path.join(this.templatesDir, lang, `${name}.hbs`)
    return fs.existsSync(filePath)
  }

  private dbSettingsCache: Record<string, string> | null = null
  private dbSettingsCacheTime = 0

  private async loadDbSettings(): Promise<Record<string, string>> {
    // Cache for 5 min
    if (this.dbSettingsCache && Date.now() - this.dbSettingsCacheTime < 300000) return this.dbSettingsCache
    try {
      const rows = await this.prisma.shopSetting.findMany()
      const s: Record<string, string> = {}
      for (const r of rows) s[r.key] = r.value
      this.dbSettingsCache = s
      this.dbSettingsCacheTime = Date.now()
      return s
    } catch { return {} }
  }

  private getCompanyData(): Record<string, string> {
    const db = this.dbSettingsCache ?? {}
    return {
      companyName: db.companyName || this.config.get('COMPANY_NAME', 'Malak Bekleidung'),
      companyAddress: db.companyAddress || this.config.get('COMPANY_ADDRESS', ''),
      companyVatId: db.companyVatId || this.config.get('COMPANY_VAT_ID', ''),
      companyCeo: db.companyCeo || this.config.get('COMPANY_CEO', ''),
      companyRegister: db.companyRegister || this.config.get('COMPANY_REGISTER', ''),
      companyPhone: db.companyPhone || this.config.get('COMPANY_PHONE', ''),
      companyEmail: db.companyEmail || this.config.get('COMPANY_CONTACT_EMAIL', 'info@malak-bekleidung.com'),
      logoUrl: db.logoUrl || this.config.get('COMPANY_LOGO_URL', 'https://placehold.co/200x60/1a1a2e/ffffff?text=Malak'),
      currentYear: new Date().getFullYear().toString(),
      shopUrl: this.config.get('APP_URL', 'https://malak-bekleidung.com'),
    }
  }
}
