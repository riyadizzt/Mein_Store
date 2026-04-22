import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { EventEmitterModule } from '@nestjs/event-emitter'
// Sentry is loaded through an optional resolver so a missing
// @sentry/nestjs at runtime (Railway pnpm-symlink-drop 22.04.2026)
// cannot crash container boot. When the package is present, the
// resolved symbols ARE the real ones — semantics unchanged.
import { resolveSentryNestModule, resolveSentryGlobalFilter } from './sentry-optional'
const SentryModule = resolveSentryNestModule()
const SentryGlobalFilter = resolveSentryGlobalFilter()
import { SentryUserContextInterceptor } from './common/interceptors/sentry-user-context.interceptor'
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware'
import { PrismaModule } from './prisma/prisma.module'
import { QueueModule } from './queues/queue.module'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { CategoriesModule } from './modules/categories/categories.module'
import { ProductsModule } from './modules/products/products.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { OrdersModule } from './modules/orders/orders.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ShipmentsModule } from './modules/shipments/shipments.module'
import { ChannelsModule } from './modules/channels/channels.module'
import { WmsModule } from './modules/wms/wms.module'
import { AdminModule } from './modules/admin/admin.module'
import { FeedsModule } from './modules/feeds/feeds.module'
import { AiModule } from './modules/ai/ai.module'
import { WhatsappModule } from './modules/whatsapp/whatsapp.module'
import { MasterBoxModule } from './modules/master-box/master-box.module'
import { MaintenanceModule } from './modules/maintenance/maintenance.module'
import { SizingModule } from './modules/sizing/sizing.module'
import { BackupModule } from './modules/backup/backup.module'
import { MarketplacesModule } from './modules/marketplaces/marketplaces.module'
import { ReviewsModule } from './modules/reviews/reviews.module'
import { EmailModule } from './modules/email/email.module'
import { StorageModule } from './common/services/storage.module'
import { ContactModule } from './modules/contact/contact.module'
import { WebhookModule } from './modules/webhooks/webhook.module'

@Module({
  imports: [
    // Sentry — must be registered first so it can hook into NestJS internals
    // (DI graph, exception handlers, route registration). When SENTRY_DSN
    // is not set, sentry.init.ts skipped Sentry.init() entirely and this
    // module is effectively a no-op.
    SentryModule.forRoot(),

    // Config — lädt .env Datei
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate Limiting — Schutz vor Brute Force
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10, // max 10 req/sek
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 100, // max 100 req/min
      },
    ]),

    // Cron Jobs
    ScheduleModule.forRoot(),

    // Event-basierte Modul-Kommunikation (synchron + async)
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', maxListeners: 20 }),

    // Database
    PrismaModule,

    // Supabase Storage (Bilder)
    StorageModule,

    // Queue (BullMQ + Redis)
    QueueModule,

    // Health Check
    HealthModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    PaymentsModule,
    ShipmentsModule,
    ChannelsModule,
    WmsModule,
    AdminModule,
    FeedsModule,
    AiModule,
    WhatsappModule,
    MasterBoxModule,
    MaintenanceModule,
    SizingModule,
    BackupModule,
    MarketplacesModule,
    ReviewsModule,
    EmailModule,
    ContactModule,
    WebhookModule,
  ],
  providers: [
    // Catch-all exception filter that reports unhandled errors to Sentry.
    // Extends NestJS BaseExceptionFilter so the default 500-response
    // behaviour is preserved. Skips expected errors (HttpException with
    // status < 500) and respects the beforeSend filter in sentry.init.ts.
    // No-op when SENTRY_DSN is not set (Sentry.captureException becomes
    // a no-op in that case).
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    // Attach authenticated user info (id, email, role) to the Sentry scope
    // so errors are linked to the triggering user. Runs after JwtAuthGuard
    // populates req.user. No-op when SENTRY_DSN is not set.
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryUserContextInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
