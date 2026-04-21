import {
  Controller, Get, Post, Param, UseGuards, HttpCode, HttpStatus,
  ParseUUIDPipe, Req, NotFoundException,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { BackupService } from './backup.service'
import { BackupR2Client } from './backup-r2.client'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Admin backup management endpoints.
 *
 * Gate: super_admin ONLY. Per the Basic-Level spec there are no
 * fine-grained permission checks — any super_admin may view, trigger,
 * and download. Restore is deliberately NOT exposed (manual via SSH).
 */
@Controller('admin/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly r2: BackupR2Client,
    private readonly prisma: PrismaService,
  ) {}

  /** List all backup rows, newest first. */
  @Get()
  async list() {
    const rows = await this.prisma.backupLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 200,
    })
    // BigInt cannot be JSON-serialised by default — coerce to string.
    return rows.map((r) => ({
      ...r,
      sizeBytes: r.sizeBytes === null ? null : r.sizeBytes.toString(),
    }))
  }

  /** Health check for the admin UI: is R2 reachable? */
  @Get('health')
  async health() {
    if (!this.r2.isConfigured()) {
      return { r2Configured: false, objectCount: 0 }
    }
    try {
      const count = await this.r2.countObjects()
      return { r2Configured: true, objectCount: count }
    } catch (err: any) {
      return { r2Configured: true, objectCount: null, error: err?.message ?? 'unknown' }
    }
  }

  /** Trigger a manual backup on demand. Returns the BackupLog row id. */
  @Post('manual')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerManual(@Req() req: any) {
    // Fire-and-forget: admin UI doesn't wait for the dump to finish
    // (can take minutes). The row appears as RUNNING immediately and
    // polls to SUCCESS/FAILED.
    const rowId = await this.backup
      .runBackup({ type: 'MANUAL', triggeredByUserId: req.user?.id ?? null })
      .catch(() => null)
    return { accepted: true, rowId }
  }

  /** Signed R2 URL (15 min TTL) for direct-from-browser download. */
  @Get(':id/download-url')
  async downloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.backupLog.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('Backup not found')
    if (row.status !== 'SUCCESS' || !row.storageKey) {
      throw new NotFoundException('Backup has no downloadable payload (not SUCCESS)')
    }
    const url = await this.r2.signedDownloadUrl(row.storageKey, 900)
    return { url, expiresInSeconds: 900, storageKey: row.storageKey, sha256: row.sha256 }
  }
}
