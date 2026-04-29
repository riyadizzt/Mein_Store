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
import { OrdersModule } from '../orders/orders.module'

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
import { EbayCategoryMatcherController } from './ebay/ebay-category-matcher.controller'
import { EbayCategoryMatcherService } from './ebay/ebay-category-matcher.service'
// C12.2 + C12.4 — order-import adapter, glue + webhook
import { EbayOrderAdapter } from './ebay/ebay-order.adapter'
import { MarketplaceImportService } from './marketplace-import.service'
import { EbayOrderNotificationService } from './ebay/ebay-order-notification.service'
import { EbayOrderNotificationController } from './ebay/ebay-order-notification.controller'
// C12.5 — pull-cron safety-net
import { EbayOrderPullService } from './ebay/ebay-order-pull.service'
import { EbayOrderPullCron } from './ebay/ebay-order-pull.cron'

@Module({
  imports: [
    PrismaModule,
    // AdminModule brings AuditService + NotificationService.
    // forwardRef guards against a future circular import should
    // AdminModule itself ever consume something from marketplaces.
    forwardRef(() => AdminModule),
    // C12.4: OrdersModule brings OrdersService.createFromMarketplace.
    // forwardRef defensively (Klärung 2) — OrdersModule already imports
    // AdminModule and we want to stay safe against future cycles.
    forwardRef(() => OrdersModule),
  ],
  controllers: [
    EbayController,
    EbayAccountDeletionController,
    EbayCategoryMatcherController,
    EbayOrderNotificationController,
  ],
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
    EbayCategoryMatcherService,
    EbayOrderAdapter,
    MarketplaceImportService,
    EbayOrderNotificationService,
    EbayOrderPullService,
    EbayOrderPullCron,
  ],
  exports: [
    PrismaMarketplaceImportStore,
    MarketplaceAuditAdapter,
    MarketplaceNotificationAdapter,
    EbayAuthService,
    EbayMerchantLocationService,
    EbayListingService,
    EbayOrderAdapter,
    MarketplaceImportService,
  ],
})
export class MarketplacesModule {}
