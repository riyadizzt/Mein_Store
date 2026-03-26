import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { ProductsModule } from './modules/products/products.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { OrdersModule } from './modules/orders/orders.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ShipmentsModule } from './modules/shipments/shipments.module'
import { ChannelsModule } from './modules/channels/channels.module'
import { WmsModule } from './modules/wms/wms.module'
import { AdminModule } from './modules/admin/admin.module'

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

    // Database
    PrismaModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    PaymentsModule,
    ShipmentsModule,
    ChannelsModule,
    WmsModule,
    AdminModule,
  ],
})
export class AppModule {}
