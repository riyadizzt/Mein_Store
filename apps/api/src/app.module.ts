import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { EventEmitterModule } from '@nestjs/event-emitter'
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
import { ReviewsModule } from './modules/reviews/reviews.module'
import { EmailModule } from './modules/email/email.module'
import { StorageModule } from './common/services/storage.module'
import { ContactModule } from './modules/contact/contact.module'
import { WebhookModule } from './modules/webhooks/webhook.module'

@Module({
  imports: [
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
    ReviewsModule,
    EmailModule,
    ContactModule,
    WebhookModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
