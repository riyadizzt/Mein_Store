import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AiService } from '../ai/ai.service'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name)
  private readonly token: string
  private readonly phoneNumberId: string
  private readonly appUrl: string

  // Rate limiting: max 20 messages per hour per phone number
  private rateLimitMap = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {
    this.token = this.config.get('WHATSAPP_TOKEN', '')
    this.phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', '')
    this.appUrl = this.config.get('APP_URL', 'https://malak-bekleidung.com')
  }

  get isConfigured(): boolean {
    return !!(this.token && this.phoneNumberId)
  }

  async isEnabled(): Promise<boolean> {
    const setting = await this.prisma.shopSetting.findUnique({ where: { key: 'whatsapp_ai_enabled' } })
    return setting?.value === 'true'
  }

  // ── Rate Limiting ──────────────────────────────────────────

  private isRateLimited(phone: string): boolean {
    const now = Date.now()
    const entry = this.rateLimitMap.get(phone)
    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(phone, { count: 1, resetAt: now + 3600000 }) // 1 hour
      return false
    }
    if (entry.count >= 20) return true
    entry.count++
    return false
  }

  // ── Handle Incoming Message ────────────────────────────────

  async handleIncoming(phone: string, text: string, messageId: string): Promise<void> {
    // 1. Check if enabled
    if (!(await this.isEnabled())) {
      this.logger.log(`WhatsApp AI disabled — ignoring message from ${phone}`)
      return
    }

    if (!this.isConfigured) {
      this.logger.warn('WhatsApp not configured (missing token or phone number ID)')
      return
    }

    // 2. Rate limit
    if (this.isRateLimited(phone)) {
      this.logger.warn(`Rate limited: ${phone}`)
      return
    }

    // 3. Save inbound message
    await this.prisma.whatsappMessage.create({
      data: { phoneNumber: phone, direction: 'inbound', message: text, messageId },
    })

    // 4. Load conversation history (last 5 messages)
    const history = await this.prisma.whatsappMessage.findMany({
      where: { phoneNumber: phone },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const contextMessages = history.reverse().map((m) => ({
      role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: m.message,
    }))

    // 5. Detect language
    const lang = this.detectLanguage(text)

    // 6. Search products in DB
    const products = await this.searchProducts(text)
    const productContext = products.length > 0
      ? `\n\nPassende Produkte aus dem Shop:\n${products.map((p) => `- ${p.name} (${p.colors}) — €${p.price} — ${this.appUrl}/${lang}/products/${p.slug}`).join('\n')}`
      : ''

    // 7. AI response
    try {
      const systemPrompt = this.buildSystemPrompt(lang, productContext)
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...contextMessages.slice(-8), // last 8 messages for context
      ]

      const response = await this.ai.adminChat(messages, 400, undefined, lang)

      // 8. Send reply via WhatsApp API
      await this.sendMessage(phone, response.content)

      // 9. Save outbound message
      const productLinks = products.map((p) => ({ name: p.name, url: `${this.appUrl}/${lang}/products/${p.slug}`, price: p.price }))
      await this.prisma.whatsappMessage.create({
        data: {
          phoneNumber: phone, direction: 'outbound', message: response.content,
          language: lang, aiProvider: response.provider,
          tokensUsed: response.tokensIn + response.tokensOut,
          productLinks: productLinks.length > 0 ? productLinks : undefined,
        },
      })

      this.logger.log(`WhatsApp reply sent to ${phone} (${lang}, ${response.provider})`)
    } catch (e: any) {
      this.logger.error(`WhatsApp AI failed for ${phone}: ${e.message}`)
      // Send fallback message
      const fallback = lang === 'ar'
        ? 'شكراً لتواصلك! يمكنك زيارة متجرنا أو التواصل عبر البريد: info@malak-bekleidung.com'
        : 'Danke für Ihre Nachricht! Besuchen Sie unseren Shop oder schreiben Sie uns: info@malak-bekleidung.com'
      await this.sendMessage(phone, fallback)
    }
  }

  // ── System Prompt ──────────────────────────────────────────

  private buildSystemPrompt(lang: string, productContext: string): string {
    const shopName = lang === 'ar' ? 'ملبوسات ملك' : 'Malak Bekleidung'
    const langInstruction = lang === 'ar' ? 'Antworte NUR auf Arabisch.' : lang === 'en' ? 'Answer ONLY in English.' : 'Antworte NUR auf Deutsch.'

    return `Du bist der freundliche Kundenservice-Assistent von ${shopName}, einem Online-Modeshop für Bekleidung und Schuhe in Deutschland.

${langInstruction}

Regeln:
- Sei freundlich, hilfsbereit und kurz (max 3-4 Sätze)
- Wenn der Kunde nach Produkten fragt, empfehle passende aus der Liste unten
- Sende IMMER den Link zum Produkt wenn verfügbar
- Wenn du keine passenden Produkte findest: "Schauen Sie sich unser Sortiment an: ${this.appUrl}/${lang}/products"
- Wenn die Frage nicht zum Shop passt: höflich ablehnen und auf den Shop verweisen
- NIEMALS Preise erfinden — nur Preise aus der Produktliste nennen
- NIEMALS persönliche Daten fragen
- Bei Retouren/Beschwerden: "Bitte kontaktieren Sie uns per E-Mail: info@malak-bekleidung.com"
- Versand: Kostenlos ab €100, DHL, 2-4 Werktage
- Retouren: 14 Tage Widerrufsrecht, Kunde trägt Rücksendekosten
${productContext}`
  }

  // ── Product Search ─────────────────────────────────────────

  private async searchProducts(query: string): Promise<Array<{ name: string; slug: string; price: number; colors: string }>> {
    // Extract keywords from customer message
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    if (keywords.length === 0) return []

    try {
      const orConditions: any[] = [
        { translations: { some: { name: { contains: query, mode: 'insensitive' } } } },
        { slug: { contains: keywords[0], mode: 'insensitive' } },
      ]
      for (const kw of keywords.slice(0, 3)) {
        orConditions.push({ translations: { some: { name: { contains: kw, mode: 'insensitive' } } } })
      }

      const products = await this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true, OR: orConditions },
        include: {
          translations: { where: { language: 'de' }, select: { name: true } },
          variants: { where: { isActive: true }, select: { color: true } },
        },
        take: 5,
      })

      return products.map((p: any) => ({
        name: p.translations[0]?.name ?? p.slug,
        slug: p.slug,
        price: Number(p.salePrice ?? p.basePrice),
        colors: [...new Set((p.variants ?? []).map((v: any) => v.color).filter(Boolean))].join(', '),
      }))
    } catch {
      return []
    }
  }

  // ── Language Detection ─────────────────────────────────────

  private detectLanguage(text: string): string {
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F]/
    if (arabicRegex.test(text)) return 'ar'
    const germanWords = ['hallo', 'haben', 'gibt', 'suche', 'möchte', 'bitte', 'danke', 'preis', 'größe', 'farbe']
    const lower = text.toLowerCase()
    if (germanWords.some((w) => lower.includes(w))) return 'de'
    return 'en'
  }

  // ── Send WhatsApp Message ──────────────────────────────────

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.isConfigured) return

    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        this.logger.error(`WhatsApp send failed: ${res.status} ${err}`)
      }
    } catch (e: any) {
      this.logger.error(`WhatsApp send error: ${e.message}`)
    }
  }

  // ── Admin: Get Chat History ────────────────────────────────

  async getChatHistory(limit = 50, offset = 0) {
    const [messages, total] = await Promise.all([
      this.prisma.whatsappMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.whatsappMessage.count(),
    ])

    // Group by phone number
    const conversations = new Map<string, typeof messages>()
    for (const msg of messages) {
      const existing = conversations.get(msg.phoneNumber) ?? []
      existing.push(msg)
      conversations.set(msg.phoneNumber, existing)
    }

    return {
      conversations: [...conversations.entries()].map(([phone, msgs]) => ({
        phone,
        lastMessage: msgs[0],
        messageCount: msgs.length,
      })),
      total,
    }
  }
}
