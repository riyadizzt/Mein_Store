import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { PaymentsModule } from '../payments/payments.module'
import { EmailModule } from '../email/email.module'
import { ShipmentsController } from './shipments.controller'
import { ShipmentsService } from './shipments.service'
import { DHLProvider } from './providers/dhl.provider'
import { DPDProvider } from './providers/dpd.provider'
import { KlarnaProvider } from '../payments/providers/klarna.provider'
import { SHIPMENT_PROVIDERS } from './shipment-provider.interface'

@Module({
  imports: [PrismaModule, PaymentsModule, EmailModule],
  controllers: [ShipmentsController],
  providers: [
    ShipmentsService,
    DHLProvider,
    DPDProvider,
    KlarnaProvider,
    {
      provide: SHIPMENT_PROVIDERS,
      useFactory: (dhl: DHLProvider, dpd: DPDProvider) => [dhl, dpd],
      inject: [DHLProvider, DPDProvider],
    },
  ],
  exports: [ShipmentsService, DHLProvider],
})
export class ShipmentsModule {}
