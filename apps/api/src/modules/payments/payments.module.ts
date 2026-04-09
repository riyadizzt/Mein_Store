import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
// EmailModule not needed — VorkasseCron sends via Resend directly
import { PaymentsController } from './payments.controller'
import { PaymentsWebhookController } from './payments-webhook.controller'
import { PaymentsService } from './payments.service'
import { InvoiceService } from './invoice.service'
import { StripeProvider } from './providers/stripe.provider'
import { KlarnaProvider } from './providers/klarna.provider'
import { PayPalProvider } from './providers/paypal.provider'
import { VorkasseProvider } from './providers/vorkasse.provider'
import { SumUpProvider } from './providers/sumup.provider'
import { VorkasseCron } from './vorkasse.cron'
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
    VorkasseProvider,
    SumUpProvider,
    VorkasseCron,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (
        stripe: StripeProvider,
        klarna: KlarnaProvider,
        paypal: PayPalProvider,
        vorkasse: VorkasseProvider,
        sumup: SumUpProvider,
      ) => [stripe, klarna, paypal, vorkasse, sumup],
      inject: [StripeProvider, KlarnaProvider, PayPalProvider, VorkasseProvider, SumUpProvider],
    },
  ],
  exports: [PaymentsService, InvoiceService, VorkasseProvider, SumUpProvider],
})
export class PaymentsModule {}
