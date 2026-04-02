import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../common/services/storage.service'

// Payment method display names
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe_card: 'Kreditkarte',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  klarna_pay_now: 'Klarna Sofort',
  klarna_pay_later: 'Klarna Rechnung',
  klarna_installments: 'Klarna Ratenzahlung',
  paypal: 'PayPal',
  sepa_direct_debit: 'SEPA-Lastschrift',
  giropay: 'Giropay',
}

interface CompanyData {
  name: string
  address: string
  vatId: string
  ceo: string
  register: string
  phone: string
  email: string
  bankName: string
  bankIban: string
  bankBic: string
  logoUrl: string
}

@Injectable()
export class InvoiceService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceService.name)
  private companyDataCache: CompanyData | null = null
  private cacheExpiry = 0
  private logoBuffer: Buffer | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit() {
    await this.refreshCompanyData()
  }

  // ── Company Data (cached from ShopSettings) ──────────────

  private async refreshCompanyData(): Promise<CompanyData> {
    if (this.companyDataCache && Date.now() < this.cacheExpiry) return this.companyDataCache

    const settings = await this.prisma.shopSetting.findMany()
    const db: Record<string, string> = {}
    for (const s of settings) db[s.key] = s.value

    this.companyDataCache = {
      name: db.companyName || this.config.get('COMPANY_NAME', 'Malak Bekleidung'),
      address: db.companyAddress || this.config.get('COMPANY_ADDRESS', ''),
      vatId: db.companyVatId || this.config.get('COMPANY_VAT_ID', ''),
      ceo: db.companyCeo || this.config.get('COMPANY_CEO', ''),
      register: db.companyRegister || this.config.get('COMPANY_REGISTER', ''),
      phone: db.companyPhone || this.config.get('COMPANY_PHONE', ''),
      email: db.companyEmail || this.config.get('COMPANY_CONTACT_EMAIL', 'info@malak-bekleidung.com'),
      bankName: db.bankName || '',
      bankIban: db.bankIban || '',
      bankBic: db.bankBic || '',
      logoUrl: db.logoUrl || '',
    }
    this.cacheExpiry = Date.now() + 5 * 60 * 1000 // 5 minutes

    // Cache logo buffer
    if (this.companyDataCache.logoUrl && !this.logoBuffer) {
      try {
        const res = await fetch(this.companyDataCache.logoUrl)
        if (res.ok) this.logoBuffer = Buffer.from(await res.arrayBuffer())
      } catch { this.logger.warn('Could not fetch company logo for PDF') }
    }

    return this.companyDataCache
  }

  // ── Invoice Number Generator (atomic, per year) ──────────

  private async generateInvoiceNumber(prefix: string): Promise<string> {
    const year = new Date().getFullYear().toString()

    const result = await this.prisma.$queryRaw<Array<{ seq: number }>>`
      INSERT INTO invoice_sequences (date_key, seq)
      VALUES (${`${prefix}-${year}`}, 1)
      ON CONFLICT (date_key) DO UPDATE SET seq = invoice_sequences.seq + 1
      RETURNING seq
    `

    const seq = result[0].seq
    return `${prefix}-${year}-${String(seq).padStart(5, '0')}`
  }

  // ── Fetch Order with All Relations ───────────────────────

  private async fetchOrderForInvoice(orderId: string, userId?: string) {
    const where: any = { id: orderId, deletedAt: null }
    if (userId) where.userId = userId

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        items: {
          include: {
            variant: {
              select: {
                color: true, size: true,
                product: { select: { translations: { select: { language: true, name: true } } } },
              },
            },
          },
        },
        payment: { select: { method: true, paidAt: true } },
        invoices: true,
        user: { select: { firstName: true, lastName: true, email: true, preferredLang: true } },
        shippingAddress: true,
      },
    })

    if (!order) {
      throw new NotFoundException({
        statusCode: 404, error: 'OrderNotFound',
        message: { de: 'Bestellung nicht gefunden.', en: 'Order not found.', ar: 'الطلب غير موجود.' },
      })
    }

    return order
  }

  // ── Generate & Store Invoice ─────────────────────────────

  async generateAndStoreInvoice(orderId: string): Promise<{ invoice: any; pdfBuffer: Buffer }> {
    const order = await this.fetchOrderForInvoice(orderId)

    // Return existing if already generated
    const existing = order.invoices.find((i: any) => i.type === 'INVOICE' && i.pdfUrl)
    if (existing) {
      const buffer = existing.storagePath
        ? await this.storage.downloadInvoicePdf(existing.storagePath)
        : Buffer.alloc(0)
      return { invoice: existing, pdfBuffer: buffer }
    }

    const invoiceNumber = await this.generateInvoiceNumber('RE')
    const netAmount = Number(order.subtotal)
    const taxAmount = Number(order.taxAmount)
    const grossAmount = Number(order.totalAmount)

    // Generate PDF
    const pdfBuffer = await this.buildInvoicePdf(order, invoiceNumber, 'INVOICE')

    // Upload to Supabase
    const { path, signedUrl } = await this.storage.uploadInvoicePdf(invoiceNumber, pdfBuffer)

    // Create DB record
    const invoice = await this.prisma.invoice.create({
      data: {
        orderId,
        invoiceNumber,
        type: 'INVOICE',
        pdfUrl: signedUrl,
        storagePath: path,
        netAmount,
        taxAmount,
        grossAmount,
      },
    })

    this.logger.log(`Invoice ${invoiceNumber} generated for order ${order.orderNumber}`)
    return { invoice, pdfBuffer }
  }

  // ── Get or Generate (for customer download) ──────────────

  async getOrGenerateInvoice(orderId: string, userId: string): Promise<Buffer> {
    const order = await this.fetchOrderForInvoice(orderId, userId)

    const existing = order.invoices.find((i: any) => i.type === 'INVOICE' && i.storagePath)
    if (existing?.storagePath) {
      return this.storage.downloadInvoicePdf(existing.storagePath)
    }

    // Generate if not exists
    const { pdfBuffer } = await this.generateAndStoreInvoice(orderId)
    return pdfBuffer
  }

  // ── Get Invoice PDF by ID (for admin) ────────────────────

  async getInvoicePdfById(invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice || !invoice.storagePath) throw new NotFoundException('Invoice not found')

    const buffer = await this.storage.downloadInvoicePdf(invoice.storagePath)
    return { buffer, filename: `${invoice.invoiceNumber}.pdf` }
  }

  // ── Generate Credit Note ─────────────────────────────────

  async generateCreditNote(orderId: string, refundAmount: number): Promise<{ creditNote: any; pdfBuffer: Buffer }> {
    const order = await this.fetchOrderForInvoice(orderId)

    // Find original invoice
    const originalInvoice = order.invoices.find((i: any) => i.type === 'INVOICE')
    const originalInvoiceNumber = originalInvoice?.invoiceNumber ?? 'N/A'

    const creditNoteNumber = await this.generateInvoiceNumber('GS')
    const netAmount = -(refundAmount / 1.19)
    const taxAmount = -(refundAmount - refundAmount / 1.19)
    const grossAmount = -refundAmount

    // Generate PDF
    const pdfBuffer = await this.buildCreditNotePdf(order, creditNoteNumber, originalInvoiceNumber, refundAmount)

    // Upload
    const { path, signedUrl } = await this.storage.uploadInvoicePdf(creditNoteNumber, pdfBuffer)

    // DB record
    const creditNote = await this.prisma.invoice.create({
      data: {
        orderId,
        invoiceNumber: creditNoteNumber,
        type: 'CREDIT_NOTE',
        pdfUrl: signedUrl,
        storagePath: path,
        originalInvoiceId: originalInvoice?.id ?? null,
        netAmount,
        taxAmount,
        grossAmount,
      },
    })

    this.logger.log(`Credit note ${creditNoteNumber} generated (ref: ${originalInvoiceNumber})`)
    return { creditNote, pdfBuffer }
  }

  // ── Generate Delivery Note (no prices, not stored) ───────

  async generateDeliveryNote(orderId: string): Promise<Buffer> {
    const order = await this.fetchOrderForInvoice(orderId)
    return this.buildDeliveryNotePdf(order)
  }

  // ── PDF: Invoice / Rechnung ──────────────────────────────

  private async buildInvoicePdf(order: any, invoiceNumber: string, type: 'INVOICE' | 'CREDIT_NOTE'): Promise<Buffer> {
    const co = await this.refreshCompanyData()

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const isCredit = type === 'CREDIT_NOTE'
      const title = isCredit ? 'Gutschrift' : 'Rechnung'

      // ── Company Header ───────────────────────────────
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 40, { height: 40 }) } catch { /* skip */ }
      }
      const headerX = this.logoBuffer ? 100 : 50
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a2e').text(co.name, headerX, 45)
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
      doc.text(`${co.address} | Tel.: ${co.phone} | ${co.email}`, 50, 90)
      doc.text(`USt-IdNr.: ${co.vatId}${co.register ? ` | ${co.register}` : ''}`, 50, 101)

      // Divider
      doc.moveTo(50, 118).lineTo(545, 118).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // ── Customer Address Block ───────────────────────
      doc.fillColor('#1a1a2e')
      const addr = order.shippingAddress
      doc.fontSize(8).fillColor('#999999').text('Rechnungsadresse', 50, 130)
      doc.fontSize(10).fillColor('#1a1a2e').font('Helvetica')
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 50, 143)
        doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 50, 156)
        doc.text(`${addr.postalCode} ${addr.city}`, 50, 169)
        doc.text(addr.country || 'Deutschland', 50, 182)
      } else {
        doc.text(`${order.user?.firstName ?? ''} ${order.user?.lastName ?? ''}`, 50, 143)
        doc.text(order.user?.email ?? '', 50, 156)
      }

      // ── Invoice Details (right side) ─────────────────
      const rx = 350
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e').text(title, rx, 130)
      doc.fontSize(9).font('Helvetica').fillColor('#444444')
      doc.text(`${title}snummer:`, rx, 155).text(invoiceNumber, rx + 100, 155, { align: 'right', width: 95 })
      doc.text('Bestellnummer:', rx, 170).text(order.orderNumber, rx + 100, 170, { align: 'right', width: 95 })
      doc.text('Datum:', rx, 185).text(new Date().toLocaleDateString('de-DE'), rx + 100, 185, { align: 'right', width: 95 })
      if (order.payment?.paidAt) {
        doc.text('Zahlungsdatum:', rx, 200).text(new Date(order.payment.paidAt).toLocaleDateString('de-DE'), rx + 100, 200, { align: 'right', width: 95 })
      }
      if (order.payment?.method) {
        doc.text('Zahlungsart:', rx, 215).text(PAYMENT_METHOD_LABELS[order.payment.method] || order.payment.method, rx + 100, 215, { align: 'right', width: 95 })
      }

      // ── Items Table ──────────────────────────────────
      let y = 250
      // Table header background
      doc.rect(50, y - 4, 495, 18).fill('#f3f4f6')
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#4b5563')
      doc.text('Pos.', 55, y, { width: 25 })
      doc.text('Artikel', 82, y, { width: 190 })
      doc.text('Menge', 275, y, { width: 35, align: 'center' })
      doc.text('Einzelpreis', 315, y, { width: 70, align: 'right' })
      doc.text('MwSt.', 390, y, { width: 35, align: 'right' })
      doc.text('Gesamt', 430, y, { width: 115, align: 'right' })
      y += 20

      doc.font('Helvetica').fontSize(8.5).fillColor('#1a1a2e')
      const taxTotals: Record<string, { net: number; tax: number }> = {}

      order.items.forEach((item: any, i: number) => {
        const deName = item.variant?.product?.translations?.find((t: any) => t.language === 'de')?.name ?? item.snapshotName
        const variant = item.variant
        const variantInfo = [variant?.color, variant?.size].filter(Boolean).join(' / ')
        const unitPrice = Number(item.unitPrice)
        const totalPrice = Number(item.totalPrice)
        const taxRate = Number(item.taxRate)
        const lineNet = totalPrice / (1 + taxRate / 100)
        const lineTax = totalPrice - lineNet

        // Accumulate VAT by rate
        const rateKey = `${taxRate}`
        if (!taxTotals[rateKey]) taxTotals[rateKey] = { net: 0, tax: 0 }
        taxTotals[rateKey].net += lineNet
        taxTotals[rateKey].tax += lineTax

        // Zebra striping
        if (i % 2 === 1) doc.rect(50, y - 3, 495, 16).fill('#fafafa')
        doc.fillColor('#1a1a2e')
        doc.text(`${i + 1}`, 55, y, { width: 25 })
        doc.text(variantInfo ? `${deName} (${variantInfo})` : deName, 82, y, { width: 190 })
        doc.text(`${item.quantity}`, 275, y, { width: 35, align: 'center' })
        doc.text(`${unitPrice.toFixed(2)} €`, 315, y, { width: 70, align: 'right' })
        doc.text(`${taxRate.toFixed(0)}%`, 390, y, { width: 35, align: 'right' })
        doc.text(`${totalPrice.toFixed(2)} €`, 430, y, { width: 115, align: 'right' })
        y += 16

        if (y > 680) { doc.addPage(); y = 50 }
      })

      // ── Totals ───────────────────────────────────────
      y += 8
      doc.moveTo(320, y).lineTo(545, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
      y += 10

      const subtotal = Number(order.subtotal)
      const shipping = Number(order.shippingCost)
      const total = Number(order.totalAmount)

      doc.font('Helvetica').fontSize(9).fillColor('#4b5563')
      doc.text('Zwischensumme (netto):', 320, y, { width: 140, align: 'right' })
      doc.text(`${subtotal.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })
      y += 14

      if (shipping > 0) {
        doc.text('Versandkosten:', 320, y, { width: 140, align: 'right' })
        doc.text(`${shipping.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })
        y += 14
      }

      // VAT breakdown by rate (OSS-ready)
      for (const [rate, amounts] of Object.entries(taxTotals)) {
        doc.text(`MwSt. ${rate}% auf ${amounts.net.toFixed(2)} €:`, 320, y, { width: 140, align: 'right' })
        doc.text(`${amounts.tax.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })
        y += 14
      }

      y += 4
      doc.moveTo(320, y).lineTo(545, y).lineWidth(1).strokeColor('#1a1a2e').stroke()
      y += 8
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a2e')
      doc.text('Gesamtbetrag (brutto):', 320, y, { width: 140, align: 'right' })
      doc.text(`${total.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })

      // ── Payment Note ─────────────────────────────────
      if (order.payment?.paidAt) {
        y += 30
        doc.font('Helvetica').fontSize(8).fillColor('#16a34a')
        const method = PAYMENT_METHOD_LABELS[order.payment.method] || order.payment.method
        doc.text(`Bezahlt via ${method} am ${new Date(order.payment.paidAt).toLocaleDateString('de-DE')}`, 50, y)
      }

      // ── Bank Details ─────────────────────────────────
      if (co.bankIban) {
        y += 20
        doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
        doc.text(`Bankverbindung: ${co.bankName ? co.bankName + ' | ' : ''}IBAN: ${co.bankIban}${co.bankBic ? ' | BIC: ' + co.bankBic : ''}`, 50, y)
      }

      // ── Footer ───────────────────────────────────────
      const footerY = 780
      doc.font('Helvetica').fontSize(7).fillColor('#9ca3af')
      doc.text(
        `${co.name} | ${co.address}${co.ceo ? ' | GF: ' + co.ceo : ''}${co.register ? ' | ' + co.register : ''} | USt-IdNr.: ${co.vatId}`,
        50, footerY, { align: 'center', width: 495 },
      )
      doc.text(
        `Tel.: ${co.phone} | E-Mail: ${co.email}${co.bankIban ? ' | IBAN: ' + co.bankIban : ''}`,
        50, footerY + 10, { align: 'center', width: 495 },
      )

      doc.end()
    })
  }

  // ── PDF: Credit Note / Gutschrift ────────────────────────

  private async buildCreditNotePdf(order: any, creditNoteNumber: string, originalInvoiceNumber: string, refundAmount: number): Promise<Buffer> {
    const co = await this.refreshCompanyData()

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Header
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 40, { height: 40 }) } catch { /* skip */ }
      }
      const headerX = this.logoBuffer ? 100 : 50
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a2e').text(co.name, headerX, 45)
      doc.fontSize(8).font('Helvetica').fillColor('#666666')
      doc.text(`${co.address} | USt-IdNr.: ${co.vatId}`, 50, 90)

      doc.moveTo(50, 108).lineTo(545, 108).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // Customer
      const addr = order.shippingAddress
      doc.fontSize(10).fillColor('#1a1a2e')
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 50, 120)
        doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 50, 133)
        doc.text(`${addr.postalCode} ${addr.city}`, 50, 146)
      }

      // Title
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#dc2626').text('Gutschrift', 350, 120)
      doc.fontSize(9).font('Helvetica').fillColor('#444444')
      doc.text('Gutschrift-Nr.:', 350, 145).text(creditNoteNumber, 440, 145, { align: 'right', width: 105 })
      doc.text('Zu Rechnung:', 350, 160).text(originalInvoiceNumber, 440, 160, { align: 'right', width: 105 })
      doc.text('Bestellnummer:', 350, 175).text(order.orderNumber, 440, 175, { align: 'right', width: 105 })
      doc.text('Datum:', 350, 190).text(new Date().toLocaleDateString('de-DE'), 440, 190, { align: 'right', width: 105 })

      // Amount
      let y = 230
      doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
      y += 16

      const netRefund = refundAmount / 1.19
      const taxRefund = refundAmount - netRefund

      doc.font('Helvetica').fontSize(10).fillColor('#1a1a2e')
      doc.text('Erstattungsbetrag (netto):', 320, y, { width: 140, align: 'right' })
      doc.text(`-${netRefund.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })
      y += 16
      doc.text('MwSt. 19%:', 320, y, { width: 140, align: 'right' })
      doc.text(`-${taxRefund.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })
      y += 20
      doc.moveTo(320, y).lineTo(545, y).lineWidth(1).strokeColor('#1a1a2e').stroke()
      y += 8
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#dc2626')
      doc.text('Erstattung (brutto):', 320, y, { width: 140, align: 'right' })
      doc.text(`-${refundAmount.toFixed(2)} €`, 465, y, { width: 80, align: 'right' })

      // Note
      y += 40
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      doc.text('Diese Gutschrift bezieht sich auf die oben genannte Originalrechnung. Der Betrag wird auf dem gleichen Zahlungsweg erstattet.', 50, y, { width: 495 })

      // Footer
      const footerY = 780
      doc.fontSize(7).fillColor('#9ca3af')
      doc.text(
        `${co.name} | ${co.address}${co.ceo ? ' | GF: ' + co.ceo : ''} | USt-IdNr.: ${co.vatId}`,
        50, footerY, { align: 'center', width: 495 },
      )

      doc.end()
    })
  }

  // ── PDF: Delivery Note / Lieferschein (no prices) ────────

  private async buildDeliveryNotePdf(order: any): Promise<Buffer> {
    const co = await this.refreshCompanyData()

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Header
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 40, { height: 40 }) } catch { /* skip */ }
      }
      const headerX = this.logoBuffer ? 100 : 50
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#1a1a2e').text(co.name, headerX, 45)
      doc.fontSize(8).font('Helvetica').fillColor('#666666').text(co.address, 50, 90)

      doc.moveTo(50, 108).lineTo(545, 108).lineWidth(0.5).strokeColor('#e5e7eb').stroke()

      // Delivery address
      doc.fontSize(8).fillColor('#999999').text('Lieferadresse', 50, 120)
      doc.fontSize(10).fillColor('#1a1a2e')
      const addr = order.shippingAddress
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 50, 133)
        doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 50, 146)
        doc.text(`${addr.postalCode} ${addr.city}`, 50, 159)
        doc.text(addr.country || 'Deutschland', 50, 172)
      }

      // Title
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e').text('Lieferschein', 350, 120)
      doc.fontSize(9).font('Helvetica').fillColor('#444444')
      doc.text('Bestellnummer:', 350, 145).text(order.orderNumber, 440, 145, { align: 'right', width: 105 })
      doc.text('Datum:', 350, 160).text(new Date().toLocaleDateString('de-DE'), 440, 160, { align: 'right', width: 105 })

      // Items table (NO prices)
      let y = 200
      doc.rect(50, y - 4, 495, 18).fill('#f3f4f6')
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#4b5563')
      doc.text('Pos.', 55, y, { width: 25 })
      doc.text('Artikel', 82, y, { width: 250 })
      doc.text('Farbe / Größe', 335, y, { width: 110 })
      doc.text('Menge', 450, y, { width: 90, align: 'center' })
      y += 20

      doc.font('Helvetica').fontSize(9).fillColor('#1a1a2e')
      order.items.forEach((item: any, i: number) => {
        const deName = item.variant?.product?.translations?.find((t: any) => t.language === 'de')?.name ?? item.snapshotName
        const variant = item.variant
        const variantInfo = [variant?.color, variant?.size].filter(Boolean).join(' / ')

        if (i % 2 === 1) doc.rect(50, y - 3, 495, 16).fill('#fafafa')
        doc.fillColor('#1a1a2e')
        doc.text(`${i + 1}`, 55, y, { width: 25 })
        doc.text(deName, 82, y, { width: 250 })
        doc.text(variantInfo || '—', 335, y, { width: 110 })
        doc.text(`${item.quantity}`, 450, y, { width: 90, align: 'center' })
        y += 16
      })

      // Note
      y += 20
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      doc.text('Bitte prüfen Sie die Vollständigkeit Ihrer Lieferung. Bei Abweichungen wenden Sie sich an unseren Kundenservice.', 50, y, { width: 495 })

      // Footer
      const footerY = 780
      doc.fontSize(7).fillColor('#9ca3af')
      doc.text(`${co.name} | ${co.address} | Tel.: ${co.phone} | ${co.email}`, 50, footerY, { align: 'center', width: 495 })

      doc.end()
    })
  }
}
