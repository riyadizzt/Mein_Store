import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AiProvider, AiMessage, AiResponse } from './providers/ai-provider.interface'
import { ClaudeHaikuProvider } from './providers/claude-haiku.provider'
import { ClaudeSonnetProvider } from './providers/claude-sonnet.provider'
import { GeminiProvider } from './providers/gemini.provider'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private customerProvider: AiProvider | null = null
  private adminProvider: AiProvider | null = null
  private fallbackProvider: AiProvider | null = null
  private faqCache: Array<{ questionDe: string; questionAr: string; answerDe: string; answerAr: string; keywords: string }> = []
  private faqCacheTime = 0
  private settingsCache: Record<string, string> = {}
  private settingsCacheTime = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.initProviders()
  }

  private initProviders() {
    const claudeKey = this.config.get('ANTHROPIC_API_KEY') ?? this.config.get('CLAUDE_API_KEY')
    const geminiKey = this.config.get('GEMINI_API_KEY')

    if (claudeKey) {
      this.customerProvider = new ClaudeHaikuProvider(claudeKey)
      this.adminProvider = new ClaudeSonnetProvider(claudeKey)
      this.logger.log('AI Providers initialized: Claude Haiku (customer) + Claude Sonnet (admin)')
    }
    if (geminiKey) {
      this.fallbackProvider = new GeminiProvider(geminiKey)
      if (!this.customerProvider) {
        this.customerProvider = this.fallbackProvider
        this.adminProvider = this.fallbackProvider
      }
      this.logger.log('AI Fallback: Gemini initialized')
    }
    if (!this.customerProvider) {
      this.logger.warn('No AI provider configured — set ANTHROPIC_API_KEY or GEMINI_API_KEY')
    }
  }

  // ── Settings ────────────────────────────────────────────────

  async isEnabled(feature: string): Promise<boolean> {
    const settings = await this.getSettings()
    if (settings.ai_global_enabled !== 'true') return false
    return settings[`ai_${feature}_enabled`] === 'true'
  }

  private async getSettings(): Promise<Record<string, string>> {
    if (Date.now() - this.settingsCacheTime < 60_000) return this.settingsCache
    const rows = await this.prisma.shopSetting.findMany({
      where: { key: { startsWith: 'ai_' } },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    this.settingsCache = map
    this.settingsCacheTime = Date.now()
    return map
  }

  async getAllSettings(): Promise<Record<string, string>> {
    return this.getSettings()
  }

  // ── FAQ Cache ───────────────────────────────────────────────

  private async loadFaq() {
    if (Date.now() - this.faqCacheTime < 5 * 60_000 && this.faqCache.length > 0) return
    this.faqCache = await this.prisma.aiFaqEntry.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { questionDe: true, questionAr: true, answerDe: true, answerAr: true, keywords: true },
    })
    this.faqCacheTime = Date.now()
  }

  async matchFaq(query: string, lang: string): Promise<string | null> {
    await this.loadFaq()
    const q = query.toLowerCase().trim()
    for (const entry of this.faqCache) {
      const keywords = entry.keywords.toLowerCase().split(',').map((k) => k.trim()).filter(Boolean)
      if (keywords.some((kw) => q.includes(kw))) {
        return lang === 'ar' ? entry.answerAr : entry.answerDe
      }
      const question = lang === 'ar' ? entry.questionAr : entry.questionDe
      if (question && q.includes(question.toLowerCase().slice(0, 20))) {
        return lang === 'ar' ? entry.answerAr : entry.answerDe
      }
    }
    return null
  }

  // ── Core Chat ───────────────────────────────────────────────

  async customerChat(messages: AiMessage[], maxTokens = 300, ip?: string, lang = 'de'): Promise<AiResponse> {
    if (!this.customerProvider) throw new Error('No AI provider configured')

    const start = Date.now()
    let response: AiResponse

    try {
      response = await this.customerProvider.chat(messages, maxTokens)
    } catch (err) {
      this.logger.warn(`Customer AI failed (${this.customerProvider.name}): ${err}`)
      if (this.fallbackProvider && this.fallbackProvider !== this.customerProvider) {
        response = await this.fallbackProvider.chat(messages, maxTokens)
      } else {
        throw err
      }
    }

    // Log
    const userMsg = messages.filter((m) => m.role === 'user').pop()?.content ?? ''
    await this.log('customer_chat', response.provider, userMsg, response.content, response.tokensIn, response.tokensOut, Date.now() - start, lang, ip)

    return response
  }

  async adminChat(messages: AiMessage[], maxTokens = 1000, adminId?: string, lang = 'de'): Promise<AiResponse> {
    if (!this.adminProvider) throw new Error('No AI provider configured')

    const start = Date.now()
    let response: AiResponse

    try {
      response = await this.adminProvider.chat(messages, maxTokens)
    } catch (err) {
      this.logger.warn(`Admin AI failed (${this.adminProvider.name}): ${err}`)
      if (this.fallbackProvider && this.fallbackProvider !== this.adminProvider) {
        response = await this.fallbackProvider.chat(messages, maxTokens)
      } else {
        throw err
      }
    }

    const userMsg = messages.filter((m) => m.role === 'user').pop()?.content ?? ''
    await this.log('admin_assistant', response.provider, userMsg, response.content, response.tokensIn, response.tokensOut, Date.now() - start, lang, undefined, adminId)

    return response
  }

  // ── Logging ─────────────────────────────────────────────────

  private async log(type: string, provider: string, prompt: string, response: string, tokensIn: number, tokensOut: number, latencyMs: number, lang: string, ip?: string, adminId?: string, error?: string) {
    try {
      await this.prisma.aiLog.create({
        data: { type, provider, prompt: prompt.slice(0, 5000), response: response.slice(0, 10000), tokensIn, tokensOut, latencyMs, lang, userIp: ip, adminId, error },
      })
    } catch (e) {
      this.logger.error('Failed to log AI interaction', e)
    }
  }

  async getLogs(query: { type?: string; limit?: number; offset?: number }) {
    const limit = Math.min(query.limit ?? 50, 200)
    const where: any = {}
    if (query.type) where.type = query.type

    const [logs, total] = await Promise.all([
      this.prisma.aiLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: query.offset ?? 0,
      }),
      this.prisma.aiLog.count({ where }),
    ])
    return { data: logs, meta: { total, limit, offset: query.offset ?? 0 } }
  }

  async getStats() {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalThisMonth, byType, byProvider, tokenSum] = await Promise.all([
      this.prisma.aiLog.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.aiLog.groupBy({ by: ['type'], _count: true, where: { createdAt: { gte: monthStart } } }),
      this.prisma.aiLog.groupBy({ by: ['provider'], _count: true, _sum: { tokensIn: true, tokensOut: true }, where: { createdAt: { gte: monthStart } } }),
      this.prisma.aiLog.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { createdAt: { gte: monthStart } } }),
    ])

    const totalTokens = (tokenSum._sum.tokensIn ?? 0) + (tokenSum._sum.tokensOut ?? 0)
    // Rough cost estimate: Haiku ~$0.25/1M in, $1.25/1M out; Sonnet ~$3/1M in, $15/1M out
    const estimatedCost = byProvider.reduce((sum, p) => {
      const inT = p._sum?.tokensIn ?? 0
      const outT = p._sum?.tokensOut ?? 0
      if (p.provider.includes('haiku')) return sum + (inT * 0.25 + outT * 1.25) / 1_000_000
      if (p.provider.includes('sonnet')) return sum + (inT * 3 + outT * 15) / 1_000_000
      if (p.provider.includes('gemini')) return sum + (inT * 0.075 + outT * 0.3) / 1_000_000
      return sum
    }, 0)

    return {
      totalRequests: totalThisMonth,
      totalTokens,
      estimatedCostUsd: estimatedCost.toFixed(4),
      byType: byType.map((t) => ({ type: t.type, count: t._count })),
      byProvider: byProvider.map((p) => ({
        provider: p.provider, count: p._count,
        tokensIn: p._sum?.tokensIn ?? 0, tokensOut: p._sum?.tokensOut ?? 0,
      })),
    }
  }

  // ── FAQ CRUD ────────────────────────────────────────────────

  async getFaqEntries() {
    return this.prisma.aiFaqEntry.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  async createFaqEntry(data: { questionDe: string; questionAr: string; answerDe: string; answerAr: string; keywords?: string }) {
    const entry = await this.prisma.aiFaqEntry.create({ data: { ...data, keywords: data.keywords ?? '' } })
    this.faqCacheTime = 0 // invalidate
    return entry
  }

  async updateFaqEntry(id: string, data: { questionDe?: string; questionAr?: string; answerDe?: string; answerAr?: string; keywords?: string; isActive?: boolean }) {
    const entry = await this.prisma.aiFaqEntry.update({ where: { id }, data })
    this.faqCacheTime = 0
    return entry
  }

  async deleteFaqEntry(id: string) {
    await this.prisma.aiFaqEntry.delete({ where: { id } })
    this.faqCacheTime = 0
    return { deleted: true }
  }

  // ── Output Filter ───────────────────────────────────────────

  filterCustomerResponse(text: string): string {
    const blocked = ['einkaufspreis', 'gewinnmarge', 'api_key', 'api-key', 'apikey', 'password', 'admin_token', 'secret', 'bearer', 'jwt', '.env', 'process.env', 'prisma', 'database_url']
    const lower = text.toLowerCase()
    for (const word of blocked) {
      if (lower.includes(word)) {
        this.logger.warn(`AI output filter blocked: contained "${word}"`)
        return 'Entschuldigung, ich kann diese Frage leider nicht beantworten. Kontaktiere bitte unseren Kundenservice.'
      }
    }
    return text
  }
}
