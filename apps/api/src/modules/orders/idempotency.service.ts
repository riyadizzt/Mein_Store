import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHash } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'

export interface CachedResponse {
  responseBody: unknown
  statusCode: number
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name)
  private readonly TTL_HOURS = 24

  constructor(private readonly prisma: PrismaService) {}

  /** SHA-256 Hash des Request-Body für Collision-Detection */
  hashBody(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex')
  }

  /** Prüft ob ein Key bereits existiert und eine Response hat */
  async get(
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<CachedResponse | null> {
    const record = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    })

    if (!record) return null

    // Abgelaufener Key → ignorieren
    if (record.expiresAt < new Date()) return null

    // Gleicher Endpoint + gleicher Body → gecachte Antwort zurückgeben
    if (record.endpoint === endpoint && record.requestHash === requestHash) {
      if (record.responseBody && record.statusCode) {
        return { responseBody: record.responseBody, statusCode: record.statusCode }
      }
      // Key existiert aber Response noch nicht → Request läuft noch → 409 via Caller
      return { responseBody: null, statusCode: 102 } // 102 = Processing
    }

    // Gleicher Key, anderer Body → Missbrauch, ignorieren (idempotency gilt nur für identische Requests)
    return null
  }

  /** Speichert Key + Response nach erfolgreichem Request */
  async save(
    key: string,
    endpoint: string,
    requestHash: string,
    responseBody: unknown,
    statusCode: number,
    userId?: string,
  ): Promise<void> {
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + this.TTL_HOURS)

    await this.prisma.idempotencyKey.upsert({
      where: { key },
      create: {
        key,
        userId,
        endpoint,
        requestHash,
        responseBody: responseBody as any,
        statusCode,
        expiresAt,
      },
      update: {
        responseBody: responseBody as any,
        statusCode,
      },
    })
  }

  /** Erstellt einen leeren Eintrag (Key reservieren während Request läuft) */
  async reserve(
    key: string,
    endpoint: string,
    requestHash: string,
    userId?: string,
  ): Promise<void> {
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + this.TTL_HOURS)

    await this.prisma.idempotencyKey.create({
      data: { key, userId, endpoint, requestHash, expiresAt },
    })
  }

  // ── Cron: abgelaufene Keys täglich um 03:00 löschen ──────────

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredKeys() {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    if (result.count > 0) {
      this.logger.log(`Idempotency cleanup: ${result.count} abgelaufene Keys gelöscht`)
    }
  }
}
