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

MARKENNAME (wichtig):
- Auf Deutsch/Englisch/Latin-Sprachen: "Malak Bekleidung"
- Auf Arabisch lautet der Name exakt: ملبوسات ملك
- "ملبوسات ملك" ist ein fester Eigenname, KEINE wörtliche Übersetzung von "Bekleidung". Nicht Wort-für-Wort ins Arabische übersetzen.
- Standard: Nenne den Markennamen nur wenn der Kunde explizit danach fragt. Die meisten Antworten brauchen den Shopnamen nicht.

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
- Antworte IMMER in der Sprache des Kunden. Erkenne die Sprache automatisch und antworte in derselben.
- Du sprichst ALLE Sprachen: Deutsch, Englisch, Arabisch, Türkisch, Französisch, Spanisch, Russisch, Polnisch, Italienisch, und jede andere Sprache die der Kunde benutzt.
- Sage NIEMALS "Ich kann nur X Sprachen". Antworte einfach in der Sprache des Kunden.
- ARABISCHE DIALEKTE: Kopiere EXAKT den Stil des Kunden:
  - "شو" → Syrisch/Levantinisch
  - "ايش" → Khaliji/Golf
  - "عايز" → Ägyptisch
  - Hocharabisch → Hocharabisch
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

Regeln:
- Schreibe ehrlich und realistisch — beschreibe NUR was du siehst oder weißt
- KEINE Übertreibungen, KEINE Floskeln wie "Premium", "unverzichtbar", "zeitlos", "außergewöhnlich"
- 2-3 kurze, konkrete Sätze pro Sprache
- Beschreibe: Material, Passform, wofür geeignet, wie kombinierbar
- ALLE DREI Sprachen müssen befüllt sein: Deutsch, Arabisch, Englisch — nicht eine leer lassen
- META_TITLE max 60 Zeichen, META_DESC max 155 Zeichen

WICHTIG: Antworte NUR mit einem gültigen JSON-Objekt. Kein Markdown, kein Code-Fence, kein Fließtext davor oder dahinter. Exakt diese Struktur:

{
  "de": "deutsche Beschreibung hier",
  "ar": "الوصف بالعربية هنا",
  "en": "english description here",
  "metaTitleDe": "deutscher SEO-Titel",
  "metaTitleAr": "عنوان SEO بالعربية",
  "metaTitleEn": "english SEO title",
  "metaDescDe": "deutsche SEO-Beschreibung",
  "metaDescAr": "وصف SEO بالعربية",
  "metaDescEn": "english SEO description"
}`

    const response = await this.ai.adminChat([
      { role: 'system', content: 'Du bist ein Produkttexter für einen Online-Modeshop. Schreibe ehrlich, realistisch und sachlich — KEINE Übertreibungen, KEINE Marketingfloskeln wie "Premium", "unverzichtbar", "außergewöhnlich". Beschreibe NUR was du wirklich siehst und weißt. Kurz und konkret. Keine Sternchen (**) im Text. Antworte IMMER mit einem einzelnen JSON-Objekt, nichts anderes.' },
      { role: 'user', content: prompt },
    ], 1200, req.user?.id, 'de')

    // Primary parser: extract the first JSON object block and JSON.parse it.
    // Fallback: the old DE:/AR:/EN: regex scheme, in case the model returns
    // the legacy line-based format for some reason (keeps backwards compat).
    const text = response.content
    let de = ''
    let ar = ''
    let en = ''
    let metaTitleDe = ''
    let metaTitleAr = ''
    let metaTitleEn = ''
    let metaDescDe = ''
    let metaDescAr = ''
    let metaDescEn = ''

    // Strip markdown code fences like ```json ... ``` before extracting.
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    let parsedOk = false
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0])
        de = (obj.de ?? '').toString().trim()
        ar = (obj.ar ?? '').toString().trim()
        en = (obj.en ?? '').toString().trim()
        metaTitleDe = (obj.metaTitleDe ?? '').toString().trim()
        metaTitleAr = (obj.metaTitleAr ?? '').toString().trim()
        metaTitleEn = (obj.metaTitleEn ?? '').toString().trim()
        metaDescDe = (obj.metaDescDe ?? '').toString().trim()
        metaDescAr = (obj.metaDescAr ?? '').toString().trim()
        metaDescEn = (obj.metaDescEn ?? '').toString().trim()
        parsedOk = !!(de || ar || en)
      } catch {
        // fall through to regex fallback
      }
    }

    if (!parsedOk) {
      // Legacy DE:/AR:/EN: format. Pre-strip bold/headers so markdown-wrapped
      // markers still match.
      const raw = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')
      de = raw.match(/DE:\s*(.*?)(?=\bAR:|$)/is)?.[1]?.trim() ?? ''
      ar = raw.match(/AR:\s*(.*?)(?=\bEN:|$)/is)?.[1]?.trim() ?? ''
      en = raw.match(/EN:\s*(.*?)(?=\bMETA_TITLE_DE:|$)/is)?.[1]?.trim() ?? ''
      metaTitleDe = raw.match(/META_TITLE_DE:\s*(.*?)(?=\bMETA_TITLE_AR:|$)/is)?.[1]?.trim() ?? ''
      metaTitleAr = raw.match(/META_TITLE_AR:\s*(.*?)(?=\bMETA_TITLE_EN:|$)/is)?.[1]?.trim() ?? ''
      metaTitleEn = raw.match(/META_TITLE_EN:\s*(.*?)(?=\bMETA_DESC_DE:|$)/is)?.[1]?.trim() ?? ''
      metaDescDe = raw.match(/META_DESC_DE:\s*(.*?)(?=\bMETA_DESC_AR:|$)/is)?.[1]?.trim() ?? ''
      metaDescAr = raw.match(/META_DESC_AR:\s*(.*?)(?=\bMETA_DESC_EN:|$)/is)?.[1]?.trim() ?? ''
      metaDescEn = raw.match(/META_DESC_EN:\s*(.*?)$/is)?.[1]?.trim() ?? ''
    }

    // Defensive logging: if any language came back empty after BOTH parsers,
    // log the raw response so we can see what the model actually returned.
    // eslint-disable-next-line no-console
    if (!de || !ar || !en) {
      console.error('[ai/generate-product-description] incomplete languages', {
        de: de.length,
        ar: ar.length,
        en: en.length,
        parsedOk,
        provider: response.provider,
        rawPreview: text.slice(0, 500),
      })
    }

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
  async inventorySuggestions(@Req() req: any, @Body() body?: { lang?: string }) {
    if (!(await this.ai.isEnabled('inventory_suggestions'))) throw new ForbiddenException('Inventory AI is disabled')
    const lang = body?.lang || 'de'

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

    const systemPrompts: Record<string, string> = {
      de: 'Du bist ein Inventar-Berater für einen Modeshop. Gib konkrete, actionable Empfehlungen auf Deutsch.',
      en: 'You are an inventory advisor for a fashion shop. Give concrete, actionable recommendations in English.',
      ar: 'أنت مستشار مخزون لمتجر أزياء. قدّم توصيات عملية وملموسة باللغة العربية.',
    }
    const userPrompts: Record<string, string> = {
      de: 'Analysiere diese Bestandsdaten und gib Empfehlungen:',
      en: 'Analyze this inventory data and give recommendations:',
      ar: 'حلّل بيانات المخزون التالية وقدّم توصيات:',
    }
    const response = await this.ai.adminChat([
      { role: 'system', content: systemPrompts[lang] ?? systemPrompts.de },
      { role: 'user', content: `${userPrompts[lang] ?? userPrompts.de}\n\n${dataContext}` },
    ], 800, req.user?.id, lang)

    return { suggestions: response.content, data: { lowStock: lowStock.length, topSellers: topSellers.length, slowMovers: slowMovers.length }, provider: response.provider }
  }

  // ── Marketing Text Generator ────────────────────────────────

  @Post('admin/ai/generate-marketing-text')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async generateMarketingText(
    @Body() body: {
      occasion: string
      // v2 params — all optional for backwards compatibility
      format?: 'hero' | 'popup' | 'bar' | 'newsletter' | 'social'
      target?: string
      tone?: 'elegant' | 'playful' | 'urgent' | 'luxury' | 'seasonal'
      discount?: string
      validUntil?: string
      languages?: Array<'de' | 'en' | 'ar'>
      variants?: number
    },
    @Req() req: any,
  ) {
    if (!body.occasion) throw new BadRequestException('Occasion required')
    if (!(await this.ai.isEnabled('marketing_text'))) throw new ForbiddenException('Marketing AI is disabled')

    // ── Legacy path: no `format` → preserve old endpoint behavior exactly ──
    if (!body.format) {
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

    // ── v2 path: structured marketing studio ───────────────────────────
    const format = body.format
    const languages = (body.languages && body.languages.length > 0 ? body.languages : ['de', 'en', 'ar']) as Array<'de' | 'en' | 'ar'>
    const variantCount = Math.min(Math.max(body.variants ?? 3, 1), 3)
    const tone = body.tone ?? 'elegant'

    const LANG_NAME: Record<'de' | 'en' | 'ar', string> = {
      de: 'German',
      en: 'English',
      ar: 'Arabic',
    }

    // Per-format field schema — tells AI exactly which labels to emit AND
    // gives the parser what to look for. Char limits are hints; AI treats
    // them as soft targets.
    const FORMAT_SCHEMA: Record<string, Array<{ key: string; label: string; maxChars?: number }>> = {
      hero: [
        { key: 'headline', label: 'HEADLINE', maxChars: 60 },
        { key: 'subtitle', label: 'SUBTITLE', maxChars: 120 },
        { key: 'cta', label: 'CTA', maxChars: 25 },
      ],
      popup: [
        { key: 'headline', label: 'HEADLINE', maxChars: 50 },
        { key: 'description', label: 'DESCRIPTION', maxChars: 150 },
        { key: 'cta', label: 'CTA', maxChars: 25 },
      ],
      bar: [
        { key: 'text', label: 'TEXT', maxChars: 80 },
      ],
      newsletter: [
        { key: 'subject', label: 'SUBJECT', maxChars: 70 },
        { key: 'preheader', label: 'PREHEADER', maxChars: 100 },
        { key: 'body', label: 'BODY', maxChars: 400 },
      ],
      social: [
        { key: 'caption', label: 'CAPTION', maxChars: 300 },
        { key: 'hashtags', label: 'HASHTAGS', maxChars: 150 },
      ],
    }

    const schema = FORMAT_SCHEMA[format]
    if (!schema) throw new BadRequestException(`Invalid format: ${format}`)

    const fieldList = schema.map(f => `${f.label}${f.maxChars ? ` (max ${f.maxChars} chars)` : ''}`).join(', ')

    const toneDescription: Record<string, string> = {
      elegant: 'elegant, refined, premium — like a luxury boutique',
      playful: 'playful, warm, friendly — with a smile',
      urgent: 'urgent, action-driving — creates FOMO',
      luxury: 'exclusive, aspirational, sophisticated',
      seasonal: 'seasonal, atmospheric, evocative of the time of year',
    }

    const systemPrompt = `You are a senior copywriter for a premium fashion brand from Berlin. You produce concise, brand-consistent marketing copy in multiple languages. You ALWAYS follow the requested output format exactly.

BRAND:
- Name in German/English/Latin: "Malak Bekleidung"
- Name in Arabic: ملبوسات ملك (fixed proper noun, never translated word-by-word)
- Tone: premium but approachable, never tacky or salesy

RULES:
- No ALL-CAPS spam.
- No clickbait ("YOU WON'T BELIEVE!").
- No false urgency unless validUntil is provided.
- Character limits are soft — stay close to them.
- Match the customer's dialect in Arabic only if Arabic is requested (default: clear Modern Standard Arabic).`

    const userPrompt = `Generate ${variantCount} marketing copy variant${variantCount > 1 ? 's' : ''} for the following context:

Occasion: ${body.occasion}
Format: ${format}
Tone: ${toneDescription[tone] ?? toneDescription.elegant}
${body.target ? `Target audience: ${body.target}` : ''}
${body.discount ? `Discount: ${body.discount}` : ''}
${body.validUntil ? `Valid until: ${body.validUntil}` : ''}

Languages: ${languages.map(l => LANG_NAME[l]).join(', ')}

Fields per language: ${fieldList}

OUTPUT FORMAT (strict — use these exact labels; one label per line; value immediately after colon):
${Array.from({ length: variantCount }, (_, i) => {
  const v = i + 1
  return languages.map(lang => {
    const langLabel = lang.toUpperCase()
    return schema.map(f => `VARIANT_${v}_${langLabel}_${f.label}: <text in ${LANG_NAME[lang]}>`).join('\n')
  }).join('\n')
}).join('\n')}`.trim()

    const response = await this.ai.adminChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 1500, req.user?.id, 'de')

    const text = response.content

    // Parse the flat label output into a structured shape:
    // variants: [{ de: { headline, subtitle, cta }, en: {...}, ar: {...} }, ...]
    const variants: Array<Record<string, Record<string, string>>> = []
    for (let v = 1; v <= variantCount; v++) {
      const variantObj: Record<string, Record<string, string>> = {}
      for (const lang of languages) {
        const langLabel = lang.toUpperCase()
        const langObj: Record<string, string> = {}
        for (const f of schema) {
          const re = new RegExp(`VARIANT_${v}_${langLabel}_${f.label}:\\s*([\\s\\S]*?)(?=\\n*VARIANT_|$)`, 'i')
          const m = text.match(re)
          langObj[f.key] = (m?.[1] ?? '').trim()
        }
        variantObj[lang] = langObj
      }
      variants.push(variantObj)
    }

    return {
      format,
      languages,
      tone,
      variants,
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
    @Body() body: {
      customerMessage: string
      platform: string
      // 'auto' = AI detects customer message language and replies in same language.
      // Explicit BCP-47 codes (de, en, ar, fr, tr, es, it, nl, ru, ...) work too.
      lang?: 'auto' | string
      tone?: 'friendly' | 'professional' | 'apologetic' | 'grateful'
      variants?: number
    },
    @Req() req: any,
  ) {
    if (!body.customerMessage) throw new BadRequestException('Customer message required')
    if (!(await this.ai.isEnabled('social_reply'))) throw new ForbiddenException('Social reply AI is disabled')

    const lang = body.lang ?? 'auto'
    const tone = body.tone ?? 'friendly'
    const variants = Math.min(Math.max(body.variants ?? 1, 1), 3)

    // ── Fetch active shop categories so the AI can suggest the right
    //    category link when the customer asks about a product type.
    //    One query, lightweight: parents + children, translations only.
    //    Silently falls back to empty list if the DB is slow/unavailable —
    //    the reply still works, just without category links.
    //
    // IMPORTANT: for social media replies we MUST use the production domain.
    // APP_URL may be http://localhost:3000 in dev — posting that as a reply
    // would send real customers to dead links. Use SHOP_PUBLIC_URL (new,
    // explicitly for public-facing links) and fall back to the hardcoded
    // production domain. Never allow localhost here.
    const rawUrl = process.env.SHOP_PUBLIC_URL ?? process.env.APP_URL ?? ''
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(rawUrl)
    const appUrl = (isLocal || !rawUrl) ? 'https://malak-bekleidung.com' : rawUrl.replace(/\/$/, '')
    let categoryContext = ''
    try {
      const parents = await this.prisma.category.findMany({
        where: { isActive: true, parentId: null },
        include: {
          translations: true,
          children: { where: { isActive: true }, include: { translations: true } },
        },
        orderBy: { sortOrder: 'asc' },
      })

      const nameFor = (translations: Array<{ language: string; name: string }>): { de: string; en?: string; ar?: string } => {
        const de = translations.find(t => t.language === 'de')?.name
        const en = translations.find(t => t.language === 'en')?.name
        const ar = translations.find(t => t.language === 'ar')?.name
        return { de: de ?? '', en, ar }
      }

      // Build a compact, ASCII-cheap reference the model can match against.
      // Format per line:  SLUG | DE / EN / AR | URL
      const lines: string[] = []
      for (const p of parents) {
        const pn = nameFor(p.translations as any)
        const pUrl = `${appUrl}/de/products?department=${p.slug}`
        lines.push(`- ${p.slug} | ${pn.de}${pn.en ? ' / ' + pn.en : ''}${pn.ar ? ' / ' + pn.ar : ''} → ${pUrl}`)
        for (const c of (p.children as any[])) {
          const cn = nameFor(c.translations)
          const cUrl = `${appUrl}/de/products?department=${p.slug}&category=${c.slug}`
          lines.push(`  - ${c.slug} | ${cn.de}${cn.en ? ' / ' + cn.en : ''}${cn.ar ? ' / ' + cn.ar : ''} → ${cUrl}`)
        }
      }
      if (lines.length > 0) {
        categoryContext = `\n\nSHOP CATEGORIES (use ONLY these exact URLs — never invent links):\n${lines.join('\n')}\n\nGeneral shop link: ${appUrl}/de/products`
      }
    } catch {
      // ignore — reply still works without links
    }

    // Map common BCP-47 codes to full English language names for the AI prompt.
    // For unknown codes we pass the code through — most LLMs understand ISO codes.
    const LANG_NAMES: Record<string, string> = {
      de: 'German', en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish',
      it: 'Italian', tr: 'Turkish', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian',
      pl: 'Polish', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
    }
    const langName = lang === 'auto' ? null : (LANG_NAMES[lang.toLowerCase()] ?? lang)
    const languageInstruction = lang === 'auto'
      ? 'Detect the language of the customer message and write your reply in EXACTLY that same language. If the customer wrote in German, reply in German. If Arabic, reply in Arabic. If French, reply in French. Match their language precisely.'
      : `Write your reply in ${langName}. Do NOT use any other language. Even if the customer wrote in a different language, your reply MUST be in ${langName}.`

    const toneLabel: Record<string, string> = {
      friendly: 'friendly and approachable',
      professional: 'professional and formal',
      apologetic: 'apologetic and understanding',
      grateful: 'grateful and appreciative',
    }

    // System prompt — brand name baked in strongly, no negative examples
    // (those can paradoxically prime the model to use them).
    const systemPrompt = `You are a social media manager for a premium fashion shop from Berlin. You ALWAYS follow the response format exactly and you ALWAYS reply in the language requested by the user.

BRAND:
- The shop is called "Malak Bekleidung" in German, English, and all Latin-script languages.
- In Arabic the shop's name is EXACTLY: ملبوسات ملك
- "ملبوسات ملك" is a FIXED proper noun, not a translation of "Bekleidung". Do not translate word-by-word.
- Default behavior: do NOT mention the brand name in replies unless the customer explicitly asks about the brand. Most social media replies are better without mentioning the shop name — just answer the customer.

ARABIC DIALECT MATCHING:
- If the customer writes in an Arabic dialect, reply in EXACTLY the same dialect. Do not default to Modern Standard Arabic (فصحى).
- Dialect signals:
  - "شو / هلأ / منيح / كتير" → Syrian / Levantine
  - "ايش / وش / زين / كذا" → Gulf / Khaleeji
  - "عايز / ازيك / ايه الاخبار / يلا" → Egyptian
  - "واش / بزاف / كيداير" → Maghrebi (Moroccan/Algerian)
  - "ماكو / شكو / زين" → Iraqi
  - Formal/no dialect markers → Modern Standard Arabic
- Stay in ONE dialect per reply. Do not mix.`

    const userPrompt = `A customer wrote the following message on ${body.platform}:

"${body.customerMessage}"

LANGUAGE REQUIREMENT (MANDATORY):
${languageInstruction}
${categoryContext}

CATEGORY LINK RULE:
- If the customer asks about a specific product type/category (e.g. "pyjamas", "suits", "dresses"),
  include EXACTLY ONE matching category URL in the variant, integrated naturally (e.g. "hier findest du sie: URL" — not raw pasted).
- Include a link in AT LEAST 2 of the 3 variants when the customer asks about a product type.
  The third variant may be purely conversational without a link.
- Pick the MOST SPECIFIC category that fits (subcategory beats parent). If the customer's group is
  unclear (e.g. "Pyjamas" — could be men/women/kids), pick ONE best guess per variant or use
  the general /products link.
- If you are genuinely unsure which category fits → use the general shop link instead of guessing wrong.
- If customer is NOT asking about a product (general praise, shipping question, complaint, returns),
  do NOT include any link in any variant.
- NEVER invent, shorten, truncate, or modify URLs. Use them EXACTLY as listed above, character-for-character.
- NEVER use URLs that contain "localhost", "127.0.0.1", or any development/test domain.
  All URLs must start with "https://malak-bekleidung.com" or the domain shown in the list above.
- Maximum: 1 link per variant.

TASK 1 — Sentiment analysis:
Classify the customer message as exactly one of: "positive" | "neutral" | "negative" | "question"

TASK 2 — Generate ${variants} different reply variant${variants > 1 ? 's' : ''}:
Tone: ${toneLabel[tone]}.
Each reply must:
- Sound like a real person, not a corporate template
- Be short (1–3 sentences, suitable for social media; slightly longer if a link is included)
- NOT mention the brand name unless absolutely needed
- Match the customer's dialect/register exactly (see ARABIC DIALECT MATCHING in system prompt)
- Not reveal internal information
- Not make concrete promises (prices, delivery dates) that cannot be kept

OUTPUT FORMAT (strict — use these exact English labels, content in the target language):
SENTIMENT: <positive|neutral|negative|question>
VARIANTE_1: <reply in target language>
${variants >= 2 ? 'VARIANTE_2: <reply in target language>' : ''}
${variants >= 3 ? 'VARIANTE_3: <reply in target language>' : ''}`.trim()

    const response = await this.ai.adminChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 600, req.user?.id, lang === 'auto' ? 'de' : lang)

    const text = response.content
    const sentimentMatch = text.match(/SENTIMENT:\s*(positive|neutral|negative|question)/i)
    const sentiment = (sentimentMatch?.[1]?.toLowerCase() as 'positive' | 'neutral' | 'negative' | 'question' | undefined) ?? 'neutral'

    const parsedVariants: string[] = []
    for (let i = 1; i <= variants; i++) {
      const m = text.match(new RegExp(`VARIANTE_${i}:\\s*([\\s\\S]*?)(?=\\nVARIANTE_|$)`, 'i'))
      const v = m?.[1]?.trim()
      if (v) parsedVariants.push(v)
    }

    // Fallback: if parser failed entirely, return whole text as single variant
    // so old callers still get SOMETHING back.
    const finalVariants = parsedVariants.length > 0 ? parsedVariants : [text.trim()]

    return {
      reply: finalVariants[0],
      variants: finalVariants,
      sentiment,
      platform: body.platform,
      tone,
      lang,
      provider: response.provider,
    }
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
