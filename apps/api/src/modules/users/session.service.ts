import { Injectable, Logger } from '@nestjs/common'
import { NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name)

  constructor(private readonly prisma: PrismaService) {}

  async listSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceName: true,
        ipAddress: true,
        userAgent: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    })
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId, isRevoked: false },
    })
    if (!session) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'SessionNotFound',
        message: {
          de: 'Sitzung nicht gefunden.',
          en: 'Session not found.',
          ar: 'الجلسة غير موجودة.',
        },
      })
    }

    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { isRevoked: true },
    })

    this.logger.log(`Session ${sessionId} revoked for user ${userId}`)
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false,
        ...(exceptSessionId && { id: { not: exceptSessionId } }),
      },
      data: { isRevoked: true },
    })

    this.logger.log(`${result.count} sessions revoked for user ${userId}`)
    return result.count
  }
}
