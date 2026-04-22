/**
 * PrismaMarketplaceImportStore (C10).
 *
 * Concrete implementation of the MarketplaceImportStore port
 * defined in C9. Persists lifecycle rows on marketplace_order_imports
 * and resolves duplicate-claim races via the DB's @@unique constraint.
 *
 * Null-touch: operates only on marketplace_order_imports (the sidecar
 * table added in C8). Never reads or writes Orders / Payments / etc.
 *
 * Used by (in C12+): the marketplace order-import flow. Not yet
 * consumed anywhere in C10 — the adapter sits ready for C12 to wire
 * into OrderImportFlow.
 */

import { Injectable, Logger } from '@nestjs/common'
import { Marketplace, Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import type {
  ClaimResult,
  MarketplaceImportStore,
} from '../core/types'

@Injectable()
export class PrismaMarketplaceImportStore implements MarketplaceImportStore {
  private readonly logger = new Logger(PrismaMarketplaceImportStore.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomic claim. Uses INSERT, catches the Prisma P2002 unique-
   * violation as the "already exists" signal. The DB is the
   * single source of truth for the race resolution.
   */
  async claim(
    marketplace: Marketplace,
    externalOrderId: string,
    rawEventId?: string,
  ): Promise<ClaimResult> {
    try {
      const row = await this.prisma.marketplaceOrderImport.create({
        data: {
          marketplace,
          externalOrderId,
          rawEventId: rawEventId ?? null,
          status: 'IMPORTING',
        },
        select: { id: true },
      })
      return { outcome: 'claimed', importId: row.id }
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Another importer already claimed it — fetch the existing
        // row so we can return the full already_exists details.
        const existing = await this.prisma.marketplaceOrderImport.findUnique({
          where: {
            marketplace_external_order_unique: {
              marketplace,
              externalOrderId,
            },
          },
          select: { id: true, orderId: true, status: true },
        })
        if (!existing) {
          // Unusual — unique hit but the row vanished. Re-raise as unknown.
          this.logger.error(
            `P2002 on claim(${marketplace}, ${externalOrderId}) but follow-up findUnique returned null`,
          )
          throw e
        }
        return {
          outcome: 'already_exists',
          importId: existing.id,
          existingOrderId: existing.orderId,
          existingStatus: existing.status,
        }
      }
      throw e
    }
  }

  async markImported(
    importId: string,
    orderId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.marketplaceOrderImport.update({
      where: { id: importId },
      data: {
        status: 'IMPORTED',
        orderId,
        importedAt: new Date(),
        metadata: (metadata ?? undefined) as any,
      },
    })
  }

  async markFailed(
    importId: string,
    error: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.marketplaceOrderImport.update({
      where: { id: importId },
      data: {
        status: 'FAILED',
        error: error.slice(0, 500),
        metadata: (metadata ?? undefined) as any,
      },
    })
  }
}
