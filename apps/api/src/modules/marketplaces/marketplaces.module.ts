/**
 * MarketplacesModule (C10).
 *
 * NestJS module that wires the marketplace-adapter layer into the
 * application. Registers:
 *   - Prisma-backed MarketplaceImportStore (C9 port implementation)
 *   - MarketplaceAuditAdapter / MarketplaceNotificationAdapter
 *     wrapping the existing AuditService / NotificationService
 *   - EbayAuthService + EbaySandboxPoliciesService
 *   - EbayTokenRefreshCron
 *   - EbayController (admin-UI endpoints)
 *
 * Imports from:
 *   - PrismaModule — DB access
 *   - AdminModule — for AuditService + NotificationService consumers
 *
 * Export contract:
 *   - EbayAuthService, MarketplaceAuditAdapter,
 *     MarketplaceNotificationAdapter, PrismaMarketplaceImportStore
 *   are exported so C12+ consumer modules can inject them without
 *   re-registering.
 */

import { forwardRef, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AdminModule } from '../admin/admin.module'

// C9 core (no NestJS — type-only imports elsewhere)
// C10 adapters + services
import { PrismaMarketplaceImportStore } from './adapters/prisma-marketplace-import-store'
import { MarketplaceAuditAdapter } from './adapters/marketplace-audit.adapter'
import { MarketplaceNotificationAdapter } from './adapters/marketplace-notification.adapter'
import { EbayAuthService } from './ebay/ebay-auth.service'
import { EbayListingService } from './ebay/ebay-listing.service'
import { EbayMerchantLocationService } from './ebay/ebay-merchant-location.service'
import { EbaySandboxPoliciesService } from './ebay/ebay-sandbox-policies.service'
import { EbayTokenRefreshCron } from './ebay/ebay-token-refresh.cron'
import { EbayController } from './ebay/ebay.controller'
import { EbayAccountDeletionController } from './ebay/ebay-account-deletion.controller'
import { EbayAccountDeletionService } from './ebay/ebay-account-deletion.service'

@Module({
  imports: [
    PrismaModule,
    // AdminModule brings AuditService + NotificationService.
    // forwardRef guards against a future circular import should
    // AdminModule itself ever consume something from marketplaces.
    forwardRef(() => AdminModule),
  ],
  controllers: [EbayController, EbayAccountDeletionController],
  providers: [
    PrismaMarketplaceImportStore,
    MarketplaceAuditAdapter,
    MarketplaceNotificationAdapter,
    EbayAuthService,
    EbayMerchantLocationService,
    EbayListingService,
    EbaySandboxPoliciesService,
    EbayTokenRefreshCron,
    EbayAccountDeletionService,
  ],
  exports: [
    PrismaMarketplaceImportStore,
    MarketplaceAuditAdapter,
    MarketplaceNotificationAdapter,
    EbayAuthService,
    EbayMerchantLocationService,
    EbayListingService,
  ],
})
export class MarketplacesModule {}
