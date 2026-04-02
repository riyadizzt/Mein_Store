import { Module } from '@nestjs/common'
import { EmailService } from './email.service'
import { EmailWorker } from './email.worker'
import { ResendProvider } from './providers/resend.provider'
import { EMAIL_PROVIDER } from './email-provider.interface'
import { EmailRateLimiter } from './rate-limit/email-rate-limiter'
import { OrderEmailListener } from './listeners/order-email.listener'
import { InvoiceEmailListener } from './listeners/invoice-email.listener'
import { NewsletterController } from './newsletter.controller'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [NewsletterController],
  providers: [
    EmailService,
    EmailWorker,
    EmailRateLimiter,
    OrderEmailListener,
    InvoiceEmailListener,
    { provide: EMAIL_PROVIDER, useClass: ResendProvider },
  ],
  exports: [EmailService],
})
export class EmailModule {}
