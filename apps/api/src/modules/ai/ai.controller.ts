import {
  Controller, Post, Get, Delete, Body, Query, Param, Req, Ip, HttpCode, HttpStatus,
  UseGuards, ForbiddenException, BadRequestException,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { AiService } from './ai.service'
import { PrismaService } from '../../prisma/prisma.service'

// ── System Prompts ────────────────────────────────────────────

const CUSTOMER_SYSTEM_PROMPT = `Du bist ein professioneller Modeberater für Malak Bekleidung, einen Online-Modeshop in Deutschland.

VERHALTEN:
- Du bist wie ein freundlicher Verkäufer in einem Geschäft. Stelle Rückfragen bevor du Produkte empfiehlst.
- Wenn der Kunde allgemein fragt (z.B. "habt ihr Hosen?"), frage zuerst: Für wen? (Herren/Damen/Kinder) Welche Größe? Welche Farbe bevorzugt?
- Erst wenn du genug Infos hast, empfehle 1-2 passende Produkte mit Name, Preis und Link.
- Wenn der Kunde spezifisch fragt (z.B. "Herren-T-Shirt Größe L in Schwarz"), antworte direkt mit dem passenden Produkt.

FORMAT:
- Antworte KURZ (max 2-3 Sätze pro Nachricht).
- Verwende KEIN Markdown (keine **, keine ##, keine - Listen). Nur normaler Text.
- Wenn du einen Produktlink hast, nenne ihn natürlich: "Hier findest du es: [Link]"

DATEN:
- Nenne NUR Produkte, Preise und Verfügbarkeiten die in den Suchergebnissen stehen.
- Erfinde KEINE Produkte, Preise oder Links.
- Nenne KEINE internen Daten (Einkaufspreise, Margen, Mitarbeiter).

SPRACHE:
- Antworte in der Sprache des Kunden. Arabisch → Arabisch. Deutsch → Deutsch.
- DIALEKT: Kopiere EXAKT den Stil des Kunden. Benutze die gleichen Wörter die er benutzt:
  - Wenn er "شو" sagt → du sagst "شو"/"في" (Syrisch/Levantinisch)
  - Wenn er "ايش" sagt → du sagst "ايش"/"ابغى" (Khaliji/Golf)
  - Wenn er "عايز" sagt → du sagst "عايز"/"كده" (Ägyptisch)
  - Wenn er Hocharabisch schreibt → antworte Hocharabisch
  - Mische NIEMALS Dialekte. Bleib bei EINEM Dialekt pro Gespräch.
- Auf Deutsch: freundlich, Du-Form, locker aber professionell.`

const ADMIN_SYSTEM_PROMPT = `Du bist der KI-Assistent für den Admin von Malak Bekleidung.
Du hast Zugriff auf Verkaufsdaten, Bestandsdaten, Kundendaten und Bestelldaten.
Antworte immer auf Basis der echten Daten die dir als Kontext mitgegeben werden.
Wenn du keine Daten hast, sage das ehrlich.
Gib konkrete Zahlen und actionable Vorschläge.
Antworte auf Deutsch.`

@Controller()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Customer Chat (Public, Rate Limited) ────────────────────

  @Post('ai/customer-chat')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async customerChat(
    @Body('message') message: string,
    @Body('lang') lang: string,
    @Body('history') history: Array<{ role: string; content: string }>,
    @Body('context') context: string,
    @Ip() ip: string,
  ) {
    if (!message || message.trim().length === 0) throw new BadRequestException('Message required')
    if (message.length > 1000) throw new BadRequestException('Message too long')

    // Sanitize: strip known prompt injection patterns
    const sanitized = message
      .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/gi, '')
      .replace(/you\s+are\s+now\s+a/gi, '')
      .replace(/system\s*prompt/gi, '')
      .trim()
    if (!sanitized) throw new BadRequestException('Invalid message')

    if (!(await this.ai.isEnabled('customer_chat'))) {
      throw new ForbiddenException('Customer chat is disabled')
    }

    const detectedLang = lang === 'ar' ? 'ar' : 'de'

    // 1. Check FAQ cache first
    const faqAnswer = await this.ai.matchFaq(message, detectedLang)
    if (faqAnswer) {
      return { response: faqAnswer, provider: 'cache', cached: true }
    }

    // 2. Search for relevant products in the database
    let productContext = ''
    try {
      // Extract search terms — use shorter stems for Arabic (first 3-4 chars of each word)
      const rawTerms = sanitized.replace(/[?!.,;:؟،٪'"]/g, '').split(/\s+/).filter((w: string) => w.length > 1).slice(0, 5)
      // Generate shorter stems for fuzzy matching (e.g., "بناطلين" → "بنا", "بناط")
      const searchTerms: string[] = []
      for (const t of rawTerms) {
        searchTerms.push(t)
        if (t.length > 3) searchTerms.push(t.slice(0, Math.min(4, t.length)))  // Arabic root ~3-4 chars
        if (t.length > 5) searchTerms.push(t.slice(0, Math.min(6, t.length)))
      }
      const uniqueTerms = [...new Set(searchTerms)].slice(0, 8)

      if (uniqueTerms.length > 0) {
        const searchOR: any[] = []
        for (const term of uniqueTerms.slice(0, 5)) {
          searchOR.push(
            { translations: { some: { name: { contains: term, mode: 'insensitive' } } } },
            { slug: { contains: term, mode: 'insensitive' } },
            { category: { translations: { some: { name: { contains: term, mode: 'insensitive' } } } } },
          )
        }
        const products = await this.prisma.product.findMany({
          where: {
            isActive: true, deletedAt: null,
            OR: searchOR,
          },
          include: {
            translations: { select: { language: true, name: true, description: true } },
            variants: { where: { isActive: true }, include: { inventory: { select: { quantityOnHand: true, quantityReserved: true } } } },
          },
          take: 5,
        })

        if (products.length > 0) {
          const appUrl = process.env.APP_URL || 'http://localhost:3000'
          const productLines = products.map((p: any) => {
            const name = p.translations.find((t: any) => t.language === detectedLang)?.name ?? p.translations[0]?.name ?? p.slug
            const price = Number(p.salePrice ?? p.basePrice).toFixed(2)
            const originalPrice = p.salePrice && Number(p.salePrice) < Number(p.basePrice) ? ` (statt €${Number(p.basePrice).toFixed(2)})` : ''
            const colors = [...new Set(p.variants.map((v: any) => v.color).filter(Boolean))].join(', ')
            const sizes = [...new Set(p.variants.map((v: any) => v.size).filter(Boolean))].join(', ')
            const totalStock = p.variants.reduce((s: number, v: any) => s + v.inventory.reduce((si: number, i: any) => si + Math.max(0, i.quantityOnHand - i.quantityReserved), 0), 0)
            const link = `${appUrl}/${detectedLang}/products/${p.slug}`
            return `- ${name}: €${price}${originalPrice}${colors ? `, Farben: ${colors}` : ''}${sizes ? `, Größen: ${sizes}` : ''}, ${totalStock > 0 ? `${totalStock} verfügbar` : 'ausverkauft'}, Link: ${link}`
          }).join('\n')
          productContext = `\n\nProdukte gefunden:\n${productLines}\n\nWICHTIG: Nenne NUR diese Preise. Wenn der Kunde nach einem Link fragt, gib den Link aus den Daten. Erfinde KEINE Links oder Preise.`
        }
      }
    } catch (e) { /* product search failed — continue without context */ }

    // Add page context if available
    if (context && typeof context === 'string') {
      const safePath = context.replace(/[^a-zA-Z0-9/\-_?=&.äöüÄÖÜ]/g, '').slice(0, 200)
      productContext += `\nAktuelle Seite des Kunden: ${safePath}`
    }

    // 3. Build messages with conversation history
    const aiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: CUSTOMER_SYSTEM_PROMPT + productContext },
    ]
    // Add last 6 messages from history (sanitized)
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h.role === 'user' || h.role === 'assistant') {
          aiMessages.push({ role: h.role as 'user' | 'assistant', content: String(h.content).slice(0, 500) })
        }
      }
    }
    aiMessages.push({ role: 'user', content: sanitized })

    // 4. Send to AI with conversation context
    const response = await this.ai.customerChat(aiMessages, 200, ip, detectedLang)

    // 4. Filter output
    const filtered = this.ai.filterCustomerResponse(response.content)

    return { response: filtered, provider: response.provider, cached: false }
  }

  // ── Admin Assistant (Auth Required) ─────────────────────────

  @Post('admin/ai/assistant')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async adminAssistant(
    @Body('message') message: string,
    @Req() req: any,
  ) {
    if (!message) throw new BadRequestException('Message required')
    if (!(await this.ai.isEnabled('admin_assistant'))) throw new ForbiddenException('Admin AI is disabled')

    // Auto-load business data from DB as context for the AI
    let businessContext = ''
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      const [todayOrders, monthOrders, pendingOrders, lowStock, topProducts, recentReturns, totalCustomers] = await Promise.all([
        this.prisma.order.aggregate({ where: { createdAt: { gte: todayStart }, status: { notIn: ['cancelled'] }, deletedAt: null }, _sum: { totalAmount: true }, _count: true }),
        this.prisma.order.aggregate({ where: { createdAt: { gte: monthStart }, status: { notIn: ['cancelled'] }, deletedAt: null }, _sum: { totalAmount: true }, _count: true }),
        this.prisma.order.count({ where: { status: { in: ['pending', 'confirmed', 'processing'] }, deletedAt: null } }),
        this.prisma.$queryRaw<any[]>`SELECT pv.sku, pt.name AS product_name, i.quantity_on_hand - i.quantity_reserved AS available FROM inventory i JOIN product_variants pv ON pv.id = i.variant_id JOIN products p ON p.id = pv.product_id LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de' WHERE p.deleted_at IS NULL AND (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point ORDER BY available ASC LIMIT 10`,
        this.prisma.$queryRaw<any[]>`SELECT pt.name, COALESCE(SUM(oi.quantity), 0) AS qty, COALESCE(SUM(CAST(oi.total_price AS DECIMAL)), 0) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN product_variants pv ON pv.id = oi.variant_id LEFT JOIN products p ON p.id = pv.product_id LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de' WHERE o.created_at >= ${monthStart} AND o.status != 'cancelled' AND o.deleted_at IS NULL GROUP BY pt.name ORDER BY revenue DESC LIMIT 10`,
        this.prisma.return.count({ where: { status: { in: ['requested', 'label_sent', 'in_transit'] } } }),
        this.prisma.user.count({ where: { role: 'customer' } }),
      ])

      businessContext = `
AKTUELLE GESCHÄFTSDATEN (${now.toLocaleDateString('de-DE')}):

Heute: ${todayOrders._count} Bestellungen, €${Number(todayOrders._sum.totalAmount ?? 0).toFixed(2)} Umsatz
Dieser Monat: ${monthOrders._count} Bestellungen, €${Number(monthOrders._sum.totalAmount ?? 0).toFixed(2)} Umsatz
Offene Bestellungen: ${pendingOrders} (warten auf Versand)
Offene Retouren: ${recentReturns}
Kunden gesamt: ${totalCustomers}

Top 10 Produkte (Monat):
${(topProducts as any[]).map((p: any, i: number) => `${i + 1}. ${p.name}: ${Number(p.qty)} verkauft, €${Number(p.revenue).toFixed(2)}`).join('\n')}

Niedrige Bestände (${(lowStock as any[]).length} Artikel):
${(lowStock as any[]).map((s: any) => `- ${s.product_name} (${s.sku}): ${Number(s.available)} Stück`).join('\n') || 'Alle Bestände OK'}
`
    } catch (e) { businessContext = '\n(Geschäftsdaten konnten nicht geladen werden)' }

    const response = await this.ai.adminChat([
      { role: 'system', content: ADMIN_SYSTEM_PROMPT + businessContext },
      { role: 'user', content: message },
    ], 1000, req.user?.id, 'de')

    return { response: response.content, provider: response.provider, tokensUsed: response.tokensIn + response.tokensOut }
  }

  // ── Product Description Generator ───────────────────────────

  @Post('admin/ai/generate-product-description')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async generateProductDescription(
    @Body() body: { name: string; category?: string; color?: string; material?: string; target?: string; colors?: string[]; sizes?: string[]; price?: number; imageUrl?: string; productId?: string },
    @Req() req: any,
  ) {
    if (!body.name) throw new BadRequestException('Product name required')
    if (!(await this.ai.isEnabled('product_description'))) throw new ForbiddenException('Product description AI is disabled')

    // If productId provided, load full product data
    let extraContext = ''
    let imageUrl = body.imageUrl
    if (body.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: body.productId },
        include: {
          translations: { select: { language: true, name: true } },
          category: { include: { translations: { select: { language: true, name: true } } } },
          variants: { where: { isActive: true }, select: { color: true, size: true, priceModifier: true } },
          images: { select: { url: true, isPrimary: true, colorName: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      if (product) {
        const colors = [...new Set(product.variants.map((v) => v.color).filter(Boolean))]
        const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))]
        const catName = product.category?.translations?.find((t) => t.language === 'de')?.name ?? ''
        if (!body.category && catName) body.category = catName
        if (colors.length) extraContext += `\nVerfügbare Farben: ${colors.join(', ')}`
        if (sizes.length) extraContext += `\nVerfügbare Größen: ${sizes.join(', ')}`
        if (!imageUrl && product.images.length) imageUrl = product.images[0].url
      }
    }

    if (body.colors?.length) extraContext += `\nFarben: ${body.colors.join(', ')}`
    if (body.sizes?.length) extraContext += `\nGrößen: ${body.sizes.join(', ')}`
    if (body.price) extraContext += `\nPreis: €${body.price.toFixed(2)}`

    const prompt = `Generiere eine professionelle Produktbeschreibung für einen Online-Modeshop.

Produkt: ${body.name}
${body.category ? `Kategorie: ${body.category}` : ''}
${body.color ? `Farbe: ${body.color}` : ''}
${body.material ? `Material: ${body.material}` : ''}
${body.target ? `Zielgruppe: ${body.target}` : ''}${extraContext}
${imageUrl ? `\n[IMAGE:${imageUrl}]\nAnalysiere das Produktbild genau: beschreibe Material, Schnitt, Stil, Kragen, Details die du siehst.` : ''}

Generiere die Beschreibung in DREI Sprachen. Regeln:
- Schreibe ehrlich und realistisch — beschreibe NUR was du siehst oder weißt
- KEINE Übertreibungen, KEINE Floskeln wie "Premium", "unverzichtbar", "zeitlos", "außergewöhnlich"
- 2-3 kurze, konkrete Sätze pro Sprache
- Beschreibe: Material, Passform, wofür geeignet, wie kombinierbar

1. DEUTSCH: Sachlich, natürlich, wie ein echter Verkäufer beschreiben würde.
2. ARABISCH: Gleicher Inhalt auf Arabisch. Natürliche Formulierung.
3. ENGLISCH: Gleicher Inhalt auf Englisch.

Format (GENAU so, jede auf eigener Zeile):
DE: [deutsche Beschreibung]
AR: [arabische Beschreibung]
EN: [englische Beschreibung]
META_TITLE_DE: [deutscher SEO-Titel, max 60 Zeichen]
META_TITLE_AR: [arabischer SEO-Titel, max 60 Zeichen]
META_TITLE_EN: [englischer SEO-Titel, max 60 Zeichen]
META_DESC_DE: [deutsche SEO-Beschreibung, max 155 Zeichen]
META_DESC_AR: [arabische SEO-Beschreibung, max 155 Zeichen]
META_DESC_EN: [englische SEO-Beschreibung, max 155 Zeichen]`

    const response = await this.ai.adminChat([
      { role: 'system', content: 'Du bist ein Produkttexter für einen Online-Modeshop. Schreibe ehrlich, realistisch und sachlich — KEINE Übertreibungen, KEINE Marketingfloskeln wie "Premium", "unverzichtbar", "außergewöhnlich". Beschreibe NUR was du wirklich siehst und weißt. Kurz und konkret. Keine Sternchen (**) im Text.' },
      { role: 'user', content: prompt },
    ], 800, req.user?.id, 'de')

    // Parse descriptions + SEO meta tags
    const text = response.content
    const de = text.match(/DE:\s*(.*?)(?=AR:|$)/s)?.[1]?.trim() ?? text
    const ar = text.match(/AR:\s*(.*?)(?=EN:|$)/s)?.[1]?.trim() ?? ''
    const en = text.match(/EN:\s*(.*?)(?=META_TITLE_DE:|$)/s)?.[1]?.trim() ?? ''

    const metaTitleDe = text.match(/META_TITLE_DE:\s*(.*?)(?=META_TITLE_AR:|$)/s)?.[1]?.trim() ?? ''
    const metaTitleAr = text.match(/META_TITLE_AR:\s*(.*?)(?=META_TITLE_EN:|$)/s)?.[1]?.trim() ?? ''
    const metaTitleEn = text.match(/META_TITLE_EN:\s*(.*?)(?=META_DESC_DE:|$)/s)?.[1]?.trim() ?? ''
    const metaDescDe = text.match(/META_DESC_DE:\s*(.*?)(?=META_DESC_AR:|$)/s)?.[1]?.trim() ?? ''
    const metaDescAr = text.match(/META_DESC_AR:\s*(.*?)(?=META_DESC_EN:|$)/s)?.[1]?.trim() ?? ''
    const metaDescEn = text.match(/META_DESC_EN:\s*(.*?)$/s)?.[1]?.trim() ?? ''

    return {
      de, ar, en,
      seo: { metaTitleDe, metaTitleAr, metaTitleEn, metaDescDe, metaDescAr, metaDescEn },
      raw: text, provider: response.provider,
    }
  }

  // ── Inventory Suggestions ───────────────────────────────────

  @Post('admin/ai/inventory-suggestions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async inventorySuggestions(@Req() req: any) {
    if (!(await this.ai.isEnabled('inventory_suggestions'))) throw new ForbiddenException('Inventory AI is disabled')

    // Gather data
    const [lowStock, topSellers, slowMovers] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT pv.sku, pt.name AS product_name, i.quantity_on_hand - i.quantity_reserved AS available
        FROM inventory i
        JOIN product_variants pv ON pv.id = i.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de'
        WHERE p.deleted_at IS NULL AND p.is_active = true
          AND (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
        ORDER BY available ASC LIMIT 15`,
      this.prisma.$queryRaw<any[]>`
        SELECT pt.name, SUM(oi.quantity) AS qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de'
        WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status != 'cancelled' AND o.deleted_at IS NULL
        GROUP BY pt.name ORDER BY qty DESC LIMIT 10`,
      this.prisma.$queryRaw<any[]>`
        SELECT pt.name, COALESCE(SUM(oi.quantity), 0) AS qty
        FROM products p
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de'
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        LEFT JOIN order_items oi ON oi.variant_id = pv.id
        LEFT JOIN orders o ON o.id = oi.order_id AND o.created_at >= NOW() - INTERVAL '30 days'
        WHERE p.deleted_at IS NULL AND p.is_active = true
        GROUP BY p.id, pt.name HAVING COALESCE(SUM(oi.quantity), 0) = 0
        LIMIT 10`,
    ])

    const dataContext = `Niedrige Bestände:\n${lowStock.map((r: any) => `- ${r.product_name}: ${Number(r.available)} Stück`).join('\n')}
\nTop-Seller (letzte 30 Tage):\n${topSellers.map((r: any) => `- ${r.name}: ${Number(r.qty)} verkauft`).join('\n')}
\nLangsame Produkte (0 Verkäufe in 30 Tagen):\n${slowMovers.map((r: any) => `- ${r.name}`).join('\n')}`

    const response = await this.ai.adminChat([
      { role: 'system', content: 'Du bist ein Inventar-Berater für einen Modeshop. Gib konkrete, actionable Empfehlungen auf Deutsch.' },
      { role: 'user', content: `Analysiere diese Bestandsdaten und gib Empfehlungen:\n\n${dataContext}` },
    ], 800, req.user?.id, 'de')

    return { suggestions: response.content, data: { lowStock: lowStock.length, topSellers: topSellers.length, slowMovers: slowMovers.length }, provider: response.provider }
  }

  // ── Marketing Text Generator ────────────────────────────────

  @Post('admin/ai/generate-marketing-text')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async generateMarketingText(
    @Body() body: { occasion: string; target?: string; discount?: string },
    @Req() req: any,
  ) {
    if (!body.occasion) throw new BadRequestException('Occasion required')
    if (!(await this.ai.isEnabled('marketing_text'))) throw new ForbiddenException('Marketing AI is disabled')

    const prompt = `Generiere einen Marketing-Text für Malak Bekleidung.

Anlass: ${body.occasion}
${body.target ? `Zielgruppe: ${body.target}` : ''}
${body.discount ? `Rabatt: ${body.discount}` : ''}

Generiere:
1. E-Mail Betreff (DE): kurz, clickbait-frei, professionell
2. E-Mail Betreff (AR): gleicher Inhalt auf Arabisch
3. E-Mail Body (DE): 3-4 Sätze, verkaufsfördernd, mit CTA
4. E-Mail Body (AR): gleicher Inhalt auf Arabisch

Format:
BETREFF_DE: [...]
BETREFF_AR: [...]
BODY_DE: [...]
BODY_AR: [...]`

    const response = await this.ai.adminChat([
      { role: 'system', content: 'Du bist ein E-Mail-Marketing-Experte für einen Premium-Modeshop.' },
      { role: 'user', content: prompt },
    ], 600, req.user?.id, 'de')

    const text = response.content
    return {
      subjectDe: text.match(/BETREFF_DE:\s*(.*?)(?=BETREFF_AR:|$)/s)?.[1]?.trim() ?? '',
      subjectAr: text.match(/BETREFF_AR:\s*(.*?)(?=BODY_DE:|$)/s)?.[1]?.trim() ?? '',
      bodyDe: text.match(/BODY_DE:\s*(.*?)(?=BODY_AR:|$)/s)?.[1]?.trim() ?? '',
      bodyAr: text.match(/BODY_AR:\s*(.*?)$/s)?.[1]?.trim() ?? '',
      raw: text,
      provider: response.provider,
    }
  }

  // ── Social Media Reply Helper ───────────────────────────────

  @Post('admin/ai/social-reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async socialReply(
    @Body() body: { customerMessage: string; platform: string; lang?: string },
    @Req() req: any,
  ) {
    if (!body.customerMessage) throw new BadRequestException('Customer message required')
    if (!(await this.ai.isEnabled('social_reply'))) throw new ForbiddenException('Social reply AI is disabled')

    const lang = body.lang ?? 'de'
    const prompt = `Ein Kunde hat auf ${body.platform} folgende Nachricht geschrieben:

"${body.customerMessage}"

Generiere eine professionelle, freundliche Antwort auf ${lang === 'ar' ? 'Arabisch' : 'Deutsch'}.
Die Antwort soll:
- Höflich und hilfreich sein
- Zum Stil von Malak Bekleidung passen (Premium-Modeshop)
- Kurz sein (1-3 Sätze, passend für Social Media)
- Keine internen Informationen preisgeben`

    const response = await this.ai.adminChat([
      { role: 'system', content: 'Du bist ein Social-Media-Manager für einen Premium-Modeshop. Deine Antworten sind professionell, freundlich und markenkonform.' },
      { role: 'user', content: prompt },
    ], 300, req.user?.id, lang)

    return { reply: response.content, platform: body.platform, provider: response.provider }
  }

  // ── Admin: Logs & Stats ─────────────────────────────────────

  @Get('admin/ai/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  getLogs(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.ai.getLogs({ type, limit: limit ? +limit : 50, offset: offset ? +offset : 0 })
  }

  @Get('admin/ai/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  getStats() {
    return this.ai.getStats()
  }

  @Delete('admin/ai/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async clearLogs() {
    const { count } = await this.prisma.aiLog.deleteMany()
    return { deleted: count }
  }

  @Delete('admin/ai/logs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async deleteLog(@Param('id') id: string) {
    await this.prisma.aiLog.delete({ where: { id } })
    return { deleted: true }
  }

  @Get('admin/ai/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  getAiSettings() {
    return this.ai.getAllSettings()
  }

  // ── FAQ CRUD ────────────────────────────────────────────────

  @Get('admin/ai/faq')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  getFaq() {
    return this.ai.getFaqEntries()
  }

  @Post('admin/ai/faq')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.CREATED)
  createFaq(@Body() body: { questionDe: string; questionAr: string; answerDe: string; answerAr: string; keywords?: string }) {
    return this.ai.createFaqEntry(body)
  }
}
