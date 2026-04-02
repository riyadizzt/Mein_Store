import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { EmailService } from '../email.service'
import { ConfigService } from '@nestjs/config'

interface InvoiceGeneratedEvent {
  orderId: string
  orderNumber: string
  invoiceNumber: string
  grossAmount: string
  pdfBuffer: Buffer
  correlationId: string
}

@Injectable()
export class InvoiceEmailListener {
  private readonly logger = new Logger(InvoiceEmailListener.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent('invoice.generated')
  async handleInvoiceGenerated(event: InvoiceGeneratedEvent): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        include: {
          user: { select: { email: true, firstName: true, preferredLang: true } },
        },
      })
      if (!order) return

      const email = order.user?.email ?? order.guestEmail
      if (!email) return

      const lang = order.user?.preferredLang ?? 'de'
      const firstName = order.user?.firstName ?? 'Kunde'
      const appUrl = this.config.get('APP_URL', 'https://malak-bekleidung.com')
      const orderUrl = `${appUrl}/${lang}/account/orders/${order.orderNumber}`

      await this.emailService.queueInvoiceEmail(
        email,
        lang,
        {
          firstName,
          orderNumber: order.orderNumber,
          invoiceNumber: event.invoiceNumber,
          invoiceDate: new Date().toLocaleDateString('de-DE'),
          grossAmount: event.grossAmount,
          orderUrl,
        },
        event.pdfBuffer,
        event.invoiceNumber,
      )

      this.logger.log(`Invoice email queued: ${event.invoiceNumber} → ${email}`)
    } catch (err) {
      this.logger.error(`Failed to queue invoice email for order ${event.orderNumber}: ${err}`)
    }
  }
}
