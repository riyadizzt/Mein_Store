import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { PaymentsController } from './payments.controller'
import { PaymentsWebhookController } from './payments-webhook.controller'
import { PaymentsService } from './payments.service'
import { InvoiceService } from './invoice.service'
import { StripeProvider } from './providers/stripe.provider'
import { KlarnaProvider } from './providers/klarna.provider'
import { PayPalProvider } from './providers/paypal.provider'
import { PAYMENT_PROVIDERS } from './payment-provider.interface'

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    PaymentsService,
    InvoiceService,
    StripeProvider,
    KlarnaProvider,
    PayPalProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (stripe: StripeProvider, klarna: KlarnaProvider, paypal: PayPalProvider) => [
        stripe,
        klarna,
        paypal,
      ],
      inject: [StripeProvider, KlarnaProvider, PayPalProvider],
    },
  ],
  exports: [PaymentsService, InvoiceService],
})
export class PaymentsModule {}
