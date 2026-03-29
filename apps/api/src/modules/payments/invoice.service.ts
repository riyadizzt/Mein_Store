import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── Generate Invoice Number (atomic) ───────────────────────

  private async generateInvoiceNumber(prefix: string): Promise<string> {
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    const result = await this.prisma.$queryRaw<Array<{ seq: number }>>`
      INSERT INTO invoice_sequences (date_key, seq)
      VALUES (${`${prefix}-${dateKey}`}, 1)
      ON CONFLICT (date_key) DO UPDATE SET seq = invoice_sequences.seq + 1
      RETURNING seq
    `

    const seq = result[0].seq
    return `${prefix}-${dateKey}-${String(seq).padStart(6, '0')}`
  }

  // ── Get or Generate Invoice ────────────────────────────────

  async getOrGenerateInvoice(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      include: {
        items: {
          include: {
            variant: {
              select: { product: { select: { translations: { select: { language: true, name: true } } } } },
            },
          },
        },
        payment: { select: { method: true, paidAt: true } },
        invoices: { where: { type: 'INVOICE' }, take: 1 },
        user: { select: { firstName: true, lastName: true, email: true } },
        shippingAddress: true,
      },
    })

    if (!order) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'OrderNotFound',
        message: { de: 'Bestellung nicht gefunden.', en: 'Order not found.', ar: 'الطلب غير موجود.' },
      })
    }

    // Return existing invoice if already generated
    if (order.invoices.length > 0 && order.invoices[0].pdfUrl) {
      return { invoiceNumber: order.invoices[0].invoiceNumber, pdfUrl: order.invoices[0].pdfUrl }
    }

    // Generate invoice
    const invoiceNumber = await this.generateInvoiceNumber('RE')
    const netAmount = Number(order.subtotal)
    const taxAmount = Number(order.taxAmount)
    const grossAmount = Number(order.totalAmount)

    // Generate PDF (buffer available for upload)
    await this.generatePdf(order, invoiceNumber, 'INVOICE')

    // TODO: Upload PDF to Cloudinary and store URL
    // For now, store path reference (dev only)
    const pdfUrl = `/api/v1/invoices/${invoiceNumber}.pdf`

    const invoice = await this.prisma.invoice.create({
      data: {
        orderId,
        invoiceNumber,
        type: 'INVOICE',
        pdfUrl,
        netAmount,
        taxAmount,
        grossAmount,
      },
    })

    this.logger.log(`Invoice generated: ${invoiceNumber} for order ${order.orderNumber}`)
    return { invoiceNumber: invoice.invoiceNumber, pdfUrl: invoice.pdfUrl }
  }

  // ── Generate Credit Note ───────────────────────────────────

  async generateCreditNote(orderId: string, refundAmount: number): Promise<string> {
    const creditNoteNumber = await this.generateInvoiceNumber('GS')

    // For credit notes: negative amounts
    await this.prisma.invoice.create({
      data: {
        orderId,
        invoiceNumber: creditNoteNumber,
        type: 'CREDIT_NOTE',
        netAmount: -(refundAmount / 1.19),
        taxAmount: -(refundAmount - refundAmount / 1.19),
        grossAmount: -refundAmount,
      },
    })

    this.logger.log(`Credit note generated: ${creditNoteNumber}`)
    return creditNoteNumber
  }

  // ── PDF Generation (pdfkit) ────────────────────────────────

  private async generatePdf(
    order: any,
    invoiceNumber: string,
    type: 'INVOICE' | 'CREDIT_NOTE',
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const companyName = this.config.get('COMPANY_NAME', 'Malak')
      const companyAddress = this.config.get('COMPANY_ADDRESS', '[wird ergänzt]')
      const companyVatId = this.config.get('COMPANY_VAT_ID', '[wird ergänzt]')
      const companyCeo = this.config.get('COMPANY_CEO', '[wird ergänzt]')
      const companyRegister = this.config.get('COMPANY_REGISTER', '[wird ergänzt]')
      const companyPhone = this.config.get('COMPANY_PHONE', '[wird ergänzt]')
      const companyEmail = this.config.get('COMPANY_CONTACT_EMAIL', 'info@malak-bekleidung.com')

      const isCredit = type === 'CREDIT_NOTE'
      const title = isCredit ? 'Gutschrift' : 'Rechnung'

      // ── Header ───────────────────────────────────────────
      doc.fontSize(20).font('Helvetica-Bold').text(companyName, 50, 50)
      doc.fontSize(9).font('Helvetica').text(companyAddress, 50, 75)
      doc.text(`USt-IdNr.: ${companyVatId}`, 50, 87)

      // Title
      doc.fontSize(16).font('Helvetica-Bold').text(title, 50, 130)
      doc.fontSize(10).font('Helvetica')
      doc.text(`${title}snummer: ${invoiceNumber}`, 50, 155)
      doc.text(`Bestellnummer: ${order.orderNumber}`, 50, 170)
      doc.text(`Datum: ${new Date().toLocaleDateString('de-DE')}`, 50, 185)
      if (order.payment?.paidAt) {
        doc.text(`Zahlungsdatum: ${new Date(order.payment.paidAt).toLocaleDateString('de-DE')}`, 50, 200)
      }

      // ── Customer ─────────────────────────────────────────
      doc.fontSize(10).font('Helvetica-Bold').text('Rechnungsadresse:', 350, 130)
      doc.font('Helvetica')
      const addr = order.shippingAddress
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 350, 145)
        doc.text(`${addr.street} ${addr.houseNumber}`, 350, 158)
        doc.text(`${addr.postalCode} ${addr.city}`, 350, 171)
        doc.text(addr.country, 350, 184)
      } else {
        doc.text(`${order.user?.firstName ?? ''} ${order.user?.lastName ?? ''}`, 350, 145)
        doc.text(order.user?.email ?? '', 350, 158)
      }

      // ── Items Table ──────────────────────────────────────
      let y = 240
      doc.font('Helvetica-Bold').fontSize(9)
      doc.text('Pos.', 50, y, { width: 30 })
      doc.text('Artikel', 85, y, { width: 200 })
      doc.text('Menge', 290, y, { width: 40, align: 'center' })
      doc.text('Einzelpreis', 340, y, { width: 80, align: 'right' })
      doc.text('MwSt.', 425, y, { width: 40, align: 'right' })
      doc.text('Gesamt', 470, y, { width: 80, align: 'right' })

      doc.moveTo(50, y + 14).lineTo(550, y + 14).stroke()
      y += 22

      doc.font('Helvetica').fontSize(9)
      order.items.forEach((item: any, i: number) => {
        const name = item.variant?.product?.translations?.[0]?.name ?? item.snapshotName
        const unitPrice = Number(item.unitPrice).toFixed(2)
        const totalPrice = Number(item.totalPrice).toFixed(2)
        const taxRate = Number(item.taxRate).toFixed(0)

        doc.text(`${i + 1}`, 50, y, { width: 30 })
        doc.text(name, 85, y, { width: 200 })
        doc.text(`${item.quantity}`, 290, y, { width: 40, align: 'center' })
        doc.text(`${unitPrice} €`, 340, y, { width: 80, align: 'right' })
        doc.text(`${taxRate}%`, 425, y, { width: 40, align: 'right' })
        doc.text(`${totalPrice} €`, 470, y, { width: 80, align: 'right' })
        y += 16
      })

      // ── Totals ───────────────────────────────────────────
      doc.moveTo(350, y + 8).lineTo(550, y + 8).stroke()
      y += 16

      const subtotal = Number(order.subtotal).toFixed(2)
      const shipping = Number(order.shippingCost).toFixed(2)
      const tax = Number(order.taxAmount).toFixed(2)
      const total = Number(order.totalAmount).toFixed(2)

      doc.text('Zwischensumme (netto):', 350, y, { width: 120, align: 'right' })
      doc.text(`${subtotal} €`, 470, y, { width: 80, align: 'right' })
      y += 14

      doc.text('Versandkosten:', 350, y, { width: 120, align: 'right' })
      doc.text(`${shipping} €`, 470, y, { width: 80, align: 'right' })
      y += 14

      doc.text('MwSt. (19%):', 350, y, { width: 120, align: 'right' })
      doc.text(`${tax} €`, 470, y, { width: 80, align: 'right' })
      y += 16

      doc.font('Helvetica-Bold')
      doc.text('Gesamtbetrag (brutto):', 350, y, { width: 120, align: 'right' })
      doc.text(`${total} €`, 470, y, { width: 80, align: 'right' })

      // ── Footer ───────────────────────────────────────────
      const footerY = 720
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
      doc.text(
        `${companyName} | ${companyAddress} | GF: ${companyCeo} | ${companyRegister} | USt-IdNr.: ${companyVatId}`,
        50,
        footerY,
        { align: 'center', width: 500 },
      )
      doc.text(
        `Tel.: ${companyPhone} | E-Mail: ${companyEmail}`,
        50,
        footerY + 12,
        { align: 'center', width: 500 },
      )

      doc.end()
    })
  }
}
