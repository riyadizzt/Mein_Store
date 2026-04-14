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
    const pdfBuffer = await this.buildInvoicePdf(order, invoiceNumber)

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

    // Block invoice generation for unpaid orders (Vorkasse pending, etc.)
    const payment = await this.prisma.payment.findUnique({ where: { orderId } })
    const paidStatuses = ['captured', 'refunded', 'partially_refunded']
    if (payment && !paidStatuses.includes(payment.status)) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'InvoiceNotAvailable',
        message: {
          de: 'Rechnung erst nach Zahlungseingang verfuegbar.',
          en: 'Invoice only available after payment.',
          ar: 'الفاتورة متاحة فقط بعد استلام الدفع.',
        },
      })
    }

    const existing = order.invoices.find((i: any) => i.type === 'INVOICE' && i.storagePath)
    if (existing?.storagePath) {
      return this.storage.downloadInvoicePdf(existing.storagePath)
    }

    // Generate if not exists (only for paid orders)
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

    // Try to find return items for this order (for detailed credit note)
    const returnReq = await this.prisma.return.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { returnItems: true },
    })
    const returnItems = (returnReq?.returnItems as any[]) ?? []

    const creditNoteNumber = await this.generateInvoiceNumber('GS')
    const netAmount = -(refundAmount / 1.19)
    const taxAmount = -(refundAmount - refundAmount / 1.19)
    const grossAmount = -refundAmount

    // Generate PDF
    const pdfBuffer = await this.buildCreditNotePdf(order, creditNoteNumber, originalInvoiceNumber, refundAmount, returnItems)

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

  // ── Address Resolution Helper ────────────────────────────
  // Priorität: 1) shippingAddress (DB-Relation), 2) shippingAddressSnapshot (JSON), 3) User-Daten
  private resolveAddress(order: any): { firstName: string; lastName: string; street?: string; houseNumber?: string; postalCode?: string; city?: string; country?: string } | null {
    if (order.shippingAddress) return order.shippingAddress
    if (order.shippingAddressSnapshot) {
      try {
        const snap = typeof order.shippingAddressSnapshot === 'string'
          ? JSON.parse(order.shippingAddressSnapshot)
          : order.shippingAddressSnapshot
        return snap
      } catch (e) {
        this.logger.warn(
          `Failed to parse shippingAddressSnapshot for order ${order.orderNumber}: ${(e as Error).message}`,
        )
      }
    }
    if (order.user?.firstName) {
      return { firstName: order.user.firstName, lastName: order.user.lastName ?? '' }
    }
    // Fallback: Notes-Feld
    try {
      const notes = typeof order.notes === 'string' ? JSON.parse(order.notes) : order.notes
      if (notes?.guestFirstName) return { firstName: notes.guestFirstName, lastName: notes.guestLastName ?? '' }
    } catch (e) {
      this.logger.warn(
        `Failed to parse order.notes for address fallback on order ${order.orderNumber}: ${(e as Error).message}`,
      )
    }
    return null
  }

  // ── PDF: Invoice / Rechnung (Premium Design) ─────────────

  private async buildInvoicePdf(order: any, invoiceNumber: string): Promise<Buffer> {
    const co = await this.refreshCompanyData()
    const GOLD = '#d4a853'
    const DARK = '#1a1a2e'
    const MUTED = '#6b7280'
    const ZEBRA = '#f8f8f8'

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── HEADER ─────────────────────────────────────
      // Logo left
      let logoRight = 50
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 35, { height: 48 }); logoRight = 110 } catch { /* skip */ }
      }
      // Company name under/next to logo
      doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK).text(co.name, logoRight, 42)
      doc.fontSize(7.5).font('Helvetica').fillColor(MUTED)
      doc.text(co.address, logoRight, 60)
      if (co.phone || co.email) doc.text(`${co.phone ? 'Tel. ' + co.phone : ''}${co.phone && co.email ? ' | ' : ''}${co.email}`, logoRight, 71)

      // "RECHNUNG" title — right aligned, elegant
      doc.fontSize(26).font('Helvetica-Bold').fillColor(DARK)
      doc.text('RECHNUNG', 350, 36, { width: 195, align: 'right' })

      // Gold separator line
      doc.moveTo(50, 95).lineTo(545, 95).lineWidth(2).strokeColor(GOLD).stroke()

      // Company legal line below gold (only show if data exists)
      const invoiceLegalParts = [co.vatId ? `USt-IdNr.: ${co.vatId}` : '', co.register || '', co.ceo ? `Inh. ${co.ceo}` : ''].filter(Boolean)
      if (invoiceLegalParts.length > 0) {
        doc.fontSize(6.5).font('Helvetica').fillColor('#9ca3af').text(invoiceLegalParts.join(' | '), 50, 101)
      }

      // ── CUSTOMER ADDRESS (left, elegant box) ───────
      const addrBoxY = 125
      doc.roundedRect(50, addrBoxY, 240, 80, 4).lineWidth(0.5).strokeColor('#e0e0e0').stroke()

      doc.fontSize(7).font('Helvetica').fillColor(MUTED).text('Rechnungsadresse', 62, addrBoxY + 10)
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK)

      const addr = this.resolveAddress(order)
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 62, addrBoxY + 24)
        doc.font('Helvetica').fontSize(9).fillColor('#333333')
        if (addr.street) doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 62, addrBoxY + 38)
        if (addr.postalCode) doc.text(`${addr.postalCode} ${addr.city ?? ''}`, 62, addrBoxY + 50)
        if (addr.country) doc.text(addr.country === 'DE' ? 'Deutschland' : addr.country, 62, addrBoxY + 62)
      } else {
        doc.text(order.user?.email ?? order.guestEmail ?? '', 62, addrBoxY + 24)
      }

      // ── INVOICE DETAILS (right, two-column table) ──
      const rx = 340
      const detailsY = addrBoxY + 4
      const detailGap = 14

      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      const details: [string, string][] = [
        ['Rechnungsnummer', invoiceNumber],
        ['Bestellnummer', order.orderNumber],
        ['Rechnungsdatum', new Date().toLocaleDateString('de-DE')],
      ]
      if (order.payment?.paidAt) {
        details.push(['Zahlungsdatum', new Date(order.payment.paidAt).toLocaleDateString('de-DE')])
      }
      if (order.payment?.method) {
        details.push(['Zahlungsart', PAYMENT_METHOD_LABELS[order.payment.method] || order.payment.method])
      }

      details.forEach(([label, value], i) => {
        const dy = detailsY + i * detailGap
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, rx, dy)
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(value, rx + 110, dy, { width: 95, align: 'right' })
      })

      // ── SHIPPING ADDRESS (right, if different from billing) ──
      const shipAddr = order.shippingAddress
      if (shipAddr && (shipAddr.street !== addr?.street || shipAddr.city !== addr?.city)) {
        doc.roundedRect(310, addrBoxY, 235, 80, 4).lineWidth(0.5).strokeColor('#e0e0e0').stroke()
        doc.fontSize(7).font('Helvetica').fillColor(MUTED).text('Lieferadresse', 322, addrBoxY + 10)
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK)
        doc.text(`${shipAddr.firstName} ${shipAddr.lastName}`, 322, addrBoxY + 24)
        doc.font('Helvetica').fontSize(9).fillColor('#333333')
        if (shipAddr.street) doc.text(`${shipAddr.street}${shipAddr.houseNumber ? ' ' + shipAddr.houseNumber : ''}`, 322, addrBoxY + 38)
        if (shipAddr.postalCode) doc.text(`${shipAddr.postalCode} ${shipAddr.city ?? ''}`, 322, addrBoxY + 50)
        if (shipAddr.country) doc.text(shipAddr.country === 'DE' ? 'Deutschland' : shipAddr.country, 322, addrBoxY + 62)
      }

      // ── ITEMS TABLE ────────────────────────────────
      let y = 225
      // Dark header
      doc.rect(50, y - 5, 495, 22).fill(DARK)
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
      doc.text('POS', 58, y, { width: 22 })
      doc.text('ARTIKEL', 82, y, { width: 185 })
      doc.text('MENGE', 270, y, { width: 40, align: 'center' })
      doc.text('EINZELPREIS', 312, y, { width: 72, align: 'right' })
      doc.text('MWST', 388, y, { width: 36, align: 'right' })
      doc.text('GESAMT', 428, y, { width: 115, align: 'right' })
      y += 24

      // --- Item data (CALCULATION LOGIC UNCHANGED) ---
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

        const rateKey = `${taxRate}`
        if (!taxTotals[rateKey]) taxTotals[rateKey] = { net: 0, tax: 0 }
        taxTotals[rateKey].net += lineNet
        taxTotals[rateKey].tax += lineTax

        // Zebra striping
        if (i % 2 === 0) doc.rect(50, y - 4, 495, 20).fill(ZEBRA)
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
        doc.text(`${i + 1}`, 58, y, { width: 22 })
        const articleText = variantInfo ? `${deName}  ·  ${variantInfo}` : deName
        doc.text(articleText, 82, y, { width: 185 })
        doc.text(`${item.quantity}`, 270, y, { width: 40, align: 'center' })
        doc.text(`${unitPrice.toFixed(2)} €`, 312, y, { width: 72, align: 'right' })
        doc.fillColor(MUTED).text(`${taxRate.toFixed(0)}%`, 388, y, { width: 36, align: 'right' })
        doc.fillColor(DARK).font('Helvetica-Bold').text(`${totalPrice.toFixed(2)} €`, 428, y, { width: 115, align: 'right' })
        y += 20

        if (y > 670) { doc.addPage(); y = 50 }
      })

      // ── TOTALS BLOCK (right-aligned) ───────────────
      y += 12
      const totX = 340
      const totValX = 465
      const totW = 120
      const valW = 80

      const subtotal = Number(order.subtotal)
      const shipping = Number(order.shippingCost)
      const total = Number(order.totalAmount)
      const discount = Number(order.discountAmount ?? 0)

      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      doc.text('Zwischensumme', totX, y, { width: totW, align: 'right' })
      doc.fillColor(DARK).text(`${subtotal.toFixed(2)} €`, totValX, y, { width: valW, align: 'right' })
      y += 16

      doc.fillColor(MUTED).text('Versandkosten', totX, y, { width: totW, align: 'right' })
      doc.fillColor(DARK).text(shipping > 0 ? `${shipping.toFixed(2)} €` : 'Kostenlos', totValX, y, { width: valW, align: 'right' })
      y += 16

      if (discount > 0) {
        doc.fillColor('#16a34a').text('Rabatt', totX, y, { width: totW, align: 'right' })
        doc.text(`-${discount.toFixed(2)} €`, totValX, y, { width: valW, align: 'right' })
        y += 16
      }

      // Gold line above total
      y += 2
      doc.moveTo(totX, y).lineTo(545, y).lineWidth(1.5).strokeColor(GOLD).stroke()
      y += 10

      doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
      doc.text('Gesamtbetrag', totX, y, { width: totW, align: 'right' })
      doc.text(`${total.toFixed(2)} €`, totValX, y, { width: valW, align: 'right' })
      y += 20

      // MwSt-Ausweis (CALCULATION UNCHANGED)
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      for (const [rate, amounts] of Object.entries(taxTotals)) {
        const shippingNet = shipping / (1 + Number(rate) / 100)
        const shippingVat = shipping - shippingNet
        const totalTax = amounts.tax + (Object.keys(taxTotals).length === 1 ? shippingVat : 0)
        doc.text(`Darin enthaltene MwSt. ${rate}%: ${totalTax.toFixed(2)} €`, totX, y, { width: totW + valW + 5, align: 'right' })
        y += 11
      }

      // ── PAYMENT NOTE ───────────────────────────────
      if (order.payment?.paidAt) {
        y += 24
        doc.roundedRect(50, y - 4, 250, 22, 4).fill('#f0fdf4')
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#16a34a')
        const method = PAYMENT_METHOD_LABELS[order.payment.method] || order.payment.method
        doc.text(`✓ Bezahlt via ${method} am ${new Date(order.payment.paidAt).toLocaleDateString('de-DE')}`, 62, y + 2)
      }

      // ── BANK DETAILS ───────────────────────────────
      if (co.bankIban) {
        y += 34
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        doc.text(`Bankverbindung: ${co.bankName ? co.bankName + ' · ' : ''}IBAN: ${co.bankIban}${co.bankBic ? ' · BIC: ' + co.bankBic : ''}`, 50, y)
      }

      // ── FOOTER ─────────────────────────────────────
      const footerY = 770
      doc.moveTo(50, footerY).lineTo(545, footerY).lineWidth(1).strokeColor(GOLD).stroke()
      doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af')
      doc.text(
        [co.name, co.address, co.ceo ? `Inh. ${co.ceo}` : '', co.vatId ? `USt-IdNr.: ${co.vatId}` : '', co.bankIban ? `IBAN: ${co.bankIban}` : ''].filter(Boolean).join(' | '),
        50, footerY + 8, { align: 'center', width: 495 },
      )

      doc.end()
    })
  }

  // ── PDF: Credit Note / Gutschrift (Premium Design — Red Accent) ──

  private async buildCreditNotePdf(order: any, creditNoteNumber: string, originalInvoiceNumber: string, refundAmount: number, returnItems: any[] = []): Promise<Buffer> {
    const co = await this.refreshCompanyData()
    const RED = '#dc2626'
    const DARK = '#1a1a2e'
    const MUTED = '#6b7280'

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── HEADER ─────────────────────────────────────
      let logoRight = 50
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 35, { height: 48 }); logoRight = 110 } catch { /* skip */ }
      }
      doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK).text(co.name, logoRight, 42)
      doc.fontSize(7.5).font('Helvetica').fillColor(MUTED)
      doc.text(co.address, logoRight, 60)
      if (co.phone || co.email) doc.text(`${co.phone ? 'Tel. ' + co.phone : ''}${co.phone && co.email ? ' | ' : ''}${co.email}`, logoRight, 71)

      // "GUTSCHRIFT" — red accent
      doc.fontSize(26).font('Helvetica-Bold').fillColor(RED)
      doc.text('GUTSCHRIFT', 350, 36, { width: 195, align: 'right' })

      // Red separator line
      doc.moveTo(50, 95).lineTo(545, 95).lineWidth(2).strokeColor(RED).stroke()

      // Legal line (only show if data exists)
      const legalParts = [co.vatId ? `USt-IdNr.: ${co.vatId}` : '', co.register || '', co.ceo ? `Inh. ${co.ceo}` : ''].filter(Boolean)
      if (legalParts.length > 0) {
        doc.fontSize(6.5).font('Helvetica').fillColor('#9ca3af').text(legalParts.join(' | '), 50, 101)
      }

      // ── CUSTOMER ADDRESS ───────────────────────────
      const addrBoxY = 125
      doc.roundedRect(50, addrBoxY, 240, 72, 4).lineWidth(0.5).strokeColor('#e0e0e0').stroke()
      doc.fontSize(7).font('Helvetica').fillColor(MUTED).text('Empfänger', 62, addrBoxY + 10)
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK)

      const addr = this.resolveAddress(order)
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 62, addrBoxY + 24)
        doc.font('Helvetica').fontSize(9).fillColor('#333333')
        if (addr.street) doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 62, addrBoxY + 38)
        if (addr.postalCode) doc.text(`${addr.postalCode} ${addr.city ?? ''}`, 62, addrBoxY + 50)
      }

      // ── CREDIT NOTE DETAILS (right) ────────────────
      const rx = 340
      const dy0 = addrBoxY + 4
      const dg = 14
      const details: [string, string][] = [
        ['Gutschrift-Nr.', creditNoteNumber],
        ['Zu Rechnung', originalInvoiceNumber],
        ['Bestellnummer', order.orderNumber],
        ['Datum', new Date().toLocaleDateString('de-DE')],
      ]
      details.forEach(([label, value], i) => {
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, rx, dy0 + i * dg)
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(value, rx + 110, dy0 + i * dg, { width: 95, align: 'right' })
      })

      // ── RETURNED ITEMS TABLE (if available) ────────
      let y = 220

      if (returnItems.length > 0) {
        doc.rect(50, y - 5, 495, 20).fill(DARK)
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
        doc.text('POS', 58, y, { width: 22 })
        doc.text('ARTIKEL', 82, y, { width: 200 })
        doc.text('MENGE', 285, y, { width: 40, align: 'center' })
        doc.text('EINZELPREIS', 330, y, { width: 75, align: 'right' })
        doc.text('GESAMT', 410, y, { width: 133, align: 'right' })
        y += 22

        returnItems.forEach((item: any, i: number) => {
          if (i % 2 === 0) doc.rect(50, y - 3, 495, 18).fill('#fef2f2')
          doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
          doc.text(`${i + 1}`, 58, y, { width: 22 })
          doc.text(item.name ?? '—', 82, y, { width: 200 })
          doc.text(`${item.quantity ?? 1}`, 285, y, { width: 40, align: 'center' })
          doc.text(`${Number(item.unitPrice ?? 0).toFixed(2)} €`, 330, y, { width: 75, align: 'right' })
          const lineTotal = (item.quantity ?? 1) * Number(item.unitPrice ?? 0)
          doc.font('Helvetica-Bold').text(`-${lineTotal.toFixed(2)} €`, 410, y, { width: 133, align: 'right' })
          y += 18
        })
        y += 8
      }

      // ── AMOUNT SECTION ─────────────────────────────
      // Refund calculation (UNCHANGED)
      const netRefund = refundAmount / 1.19
      const taxRefund = refundAmount - netRefund

      const totX = 340
      const valX = 465
      const tw = 120
      const vw = 80

      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      doc.text('Erstattungsbetrag', totX, y, { width: tw, align: 'right' })
      doc.fillColor(DARK).text(`-${refundAmount.toFixed(2)} €`, valX, y, { width: vw, align: 'right' })
      y += 18

      // Red line above total
      doc.moveTo(totX, y).lineTo(545, y).lineWidth(1.5).strokeColor(RED).stroke()
      y += 10

      doc.font('Helvetica-Bold').fontSize(13).fillColor(RED)
      doc.text('Erstattung gesamt', totX, y, { width: tw, align: 'right' })
      doc.text(`-${refundAmount.toFixed(2)} €`, valX, y, { width: vw, align: 'right' })
      y += 20

      // MwSt-Ausweis
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      doc.text(`Darin enthaltene MwSt. 19%: -${taxRefund.toFixed(2)} €`, totX, y, { width: tw + vw + 5, align: 'right' })

      // ── NOTE ───────────────────────────────────────
      y += 40
      doc.roundedRect(50, y - 4, 495, 36, 4).fill('#fef2f2')
      doc.font('Helvetica').fontSize(8.5).fillColor('#991b1b')
      doc.text('Diese Gutschrift bezieht sich auf die oben genannte Originalrechnung.', 62, y + 4, { width: 470 })
      doc.text('Der Betrag wird auf dem gleichen Zahlungsweg erstattet.', 62, y + 16, { width: 470 })

      // ── FOOTER ─────────────────────────────────────
      const footerY = 770
      doc.moveTo(50, footerY).lineTo(545, footerY).lineWidth(1).strokeColor(RED).stroke()
      doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af')
      const footParts = [co.name, co.address, co.ceo ? `Inh. ${co.ceo}` : '', co.vatId ? `USt-IdNr.: ${co.vatId}` : '', co.bankIban ? `IBAN: ${co.bankIban}` : ''].filter(Boolean)
      doc.text(footParts.join(' | '), 50, footerY + 8, { align: 'center', width: 495 })

      doc.end()
    })
  }

  // ── PDF: Delivery Note / Lieferschein (Premium, no prices) ──

  private async buildDeliveryNotePdf(order: any): Promise<Buffer> {
    const co = await this.refreshCompanyData()
    const GOLD = '#d4a853'
    const DARK = '#1a1a2e'
    const MUTED = '#6b7280'
    const ZEBRA = '#f8f8f8'

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── HEADER ─────────────────────────────────────
      let logoRight = 50
      if (this.logoBuffer) {
        try { doc.image(this.logoBuffer, 50, 35, { height: 48 }); logoRight = 110 } catch { /* skip */ }
      }
      doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK).text(co.name, logoRight, 42)
      doc.fontSize(7.5).font('Helvetica').fillColor(MUTED).text(co.address, logoRight, 60)

      doc.fontSize(26).font('Helvetica-Bold').fillColor(DARK)
      doc.text('LIEFERSCHEIN', 310, 36, { width: 235, align: 'right' })

      doc.moveTo(50, 95).lineTo(545, 95).lineWidth(2).strokeColor(GOLD).stroke()

      // ── DELIVERY ADDRESS (elegant box) ──────────────
      const addrBoxY = 115
      doc.roundedRect(50, addrBoxY, 240, 85, 4).lineWidth(0.5).strokeColor('#e0e0e0').stroke()
      doc.fontSize(7).font('Helvetica').fillColor(MUTED).text('Lieferadresse', 62, addrBoxY + 10)
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK)

      const addr = this.resolveAddress(order)
      if (addr) {
        doc.text(`${addr.firstName} ${addr.lastName}`, 62, addrBoxY + 24)
        doc.font('Helvetica').fontSize(9).fillColor('#333333')
        if (addr.street) doc.text(`${addr.street}${addr.houseNumber ? ' ' + addr.houseNumber : ''}`, 62, addrBoxY + 38)
        if (addr.postalCode) doc.text(`${addr.postalCode} ${addr.city ?? ''}`, 62, addrBoxY + 50)
        if (addr.country) doc.text(addr.country === 'DE' ? 'Deutschland' : addr.country, 62, addrBoxY + 62)
      }

      // ── DETAILS (right) ────────────────────────────
      const rx = 340
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Bestellnummer', rx, addrBoxY + 4)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(order.orderNumber, rx + 110, addrBoxY + 4, { width: 95, align: 'right' })
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Datum', rx, addrBoxY + 18)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(new Date().toLocaleDateString('de-DE'), rx + 110, addrBoxY + 18, { width: 95, align: 'right' })
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Artikel gesamt', rx, addrBoxY + 32)
      const totalQty = order.items.reduce((sum: number, item: any) => sum + item.quantity, 0)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(`${totalQty} Stück`, rx + 110, addrBoxY + 32, { width: 95, align: 'right' })

      // ── ITEMS TABLE (NO prices) ────────────────────
      let y = 220
      doc.rect(50, y - 5, 495, 22).fill(DARK)
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
      doc.text('POS', 58, y, { width: 25 })
      doc.text('ARTIKEL', 86, y, { width: 240 })
      doc.text('FARBE / GRÖSSE', 330, y, { width: 120 })
      doc.text('MENGE', 455, y, { width: 85, align: 'center' })
      y += 24

      doc.font('Helvetica').fontSize(9).fillColor(DARK)
      order.items.forEach((item: any, i: number) => {
        const deName = item.variant?.product?.translations?.find((t: any) => t.language === 'de')?.name ?? item.snapshotName
        const variant = item.variant
        const variantInfo = [variant?.color, variant?.size].filter(Boolean).join(' / ')

        if (i % 2 === 0) doc.rect(50, y - 4, 495, 20).fill(ZEBRA)
        doc.fillColor(DARK)
        doc.text(`${i + 1}`, 58, y, { width: 25 })
        doc.font('Helvetica-Bold').text(deName, 86, y, { width: 240 })
        doc.font('Helvetica').fillColor(MUTED).text(variantInfo || '—', 330, y, { width: 120 })
        doc.font('Helvetica-Bold').fillColor(DARK).text(`${item.quantity}`, 455, y, { width: 85, align: 'center' })
        y += 20
      })

      // ── NOTE ───────────────────────────────────────
      y += 24
      doc.roundedRect(50, y - 4, 495, 32, 4).fill('#fffbeb')
      doc.font('Helvetica').fontSize(8.5).fillColor('#92400e')
      doc.text('Bitte prüfen Sie die Vollständigkeit Ihrer Lieferung bei Annahme.', 62, y + 2, { width: 470 })
      doc.text('Bei Abweichungen wenden Sie sich bitte an unseren Kundenservice.', 62, y + 14, { width: 470 })

      // ── FOOTER ─────────────────────────────────────
      const footerY = 770
      doc.moveTo(50, footerY).lineTo(545, footerY).lineWidth(1).strokeColor(GOLD).stroke()
      doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af')
      doc.text(
        `${co.name} | ${co.address} | Tel.: ${co.phone} | ${co.email}`,
        50, footerY + 8, { align: 'center', width: 495 },
      )

      doc.end()
    })
  }
}
