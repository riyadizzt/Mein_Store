import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { WebhookService } from './webhook.service'
import { WebhookDispatcherService } from './webhook-dispatcher.service'
import { WebhookWorker } from './webhook.worker'
import { WebhookController } from './webhook.controller'
import { OrderWebhookListener } from './listeners/order-webhook.listener'

/**
 * Outbound webhook integration — isolated, plugin-artig.
 *
 * @Global so business services (auth/gdpr/contact/products/inventory/returns/payments)
 * can @Optional @Inject() WebhookDispatcherService without each one importing this
 * module. The @Optional keeps unit tests green — if the dispatcher isn't provided
 * (e.g. in a small TestingModule), DI passes undefined and the service uses the
 * optional-chain `?.emit()` guard.
 *
 * If we ever want to remove this module: drop the @Global, each consumer's
 * `dispatcher?.emit()` call becomes a no-op, nothing crashes.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDispatcherService,
    WebhookWorker,
    OrderWebhookListener,
  ],
  exports: [WebhookDispatcherService, WebhookService],
})
export class WebhookModule {}
