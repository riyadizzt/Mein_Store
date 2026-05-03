import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { OrderStatus, SalesChannel } from '@prisma/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

/**
 * All revenue-generating channels INCLUDING eBay (and any future
 * marketplace/social channel). Used by every finance aggregate as the
 * single source of truth for "what counts toward revenue".
 *
 * POS is intentionally excluded — Shopify-managed offline channel,
 * reported separately.
 *
 * Contract for adding new channels: when a new SalesChannel enum value
 * lands (e.g. future tiktok-shop, instagram-shop), it MUST be added
 * here AND to the 8 hardcoded SQL strings further down in this file
 * (search TODO(C17.1) — those will be refactored to use Prisma.sql
 * interpolation against this constant in a follow-up cleanup task).
 *
 * Other consumers: dashboard.service.ts imports this constant for the
 * 4 revenue aggregates (today/week/month/lastMonth) so dashboard and
 * finance-reports always agree on totals.
 */
export const ONLINE_CHANNELS: SalesChannel[] = ['website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay']

// Countable statuses: every order that WAS paid counts as revenue.
// 'returned' is included because the payment was captured — the refund
// is subtracted separately via the Refund table. Excluding 'returned'
// would cause double-subtraction (order drops from gross AND refund
// subtracts from it again → negative net revenue).
//
// Exported as the single source of truth for "what counts toward gross
// revenue" across the API. Admin dashboard imports this too so its KPIs
// never drift from the finance-reports figures.
export const COUNTABLE_STATUSES: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded']

/** Shared where-clause for all finance queries */
const ORDER_FILTER = {
  channel: { in: ONLINE_CHANNELS },
  status: { in: COUNTABLE_STATUSES },
  deletedAt: null,
}

interface SalesSummary {
  gross: string          // totalAmount = what customer actually paid (Brutto)
  net: string            // gross - tax = revenue without tax (Netto für Finanzamt)
  tax: string            // taxAmount from DB = MwSt rausgerechnet
  discount: string       // discountAmount = Rabatt/Gutscheine
  shipping: string       // shippingCost = Versandkosten
  orderCount: number
  avgOrderValue: string
}

interface PaymentBreakdown {
  method: string
  gross: string
  count: number
}

// Revenue-only product data (no cost/profit — Einkaufspreise nur im Lieferanten-System)

interface VatLine {
  rate: number
  taxableAmount: number
  taxAmount: number
  grossAmount: number
}

interface BestsellerRow {
  productName: string
  sku: string
  quantitySold: number
  revenue: number
}

interface TopCustomer {
  userId: string
  firstName: string
  lastName: string
  email: string
  orderCount: number
  totalSpent: number
  avgOrderValue: number
}

@Injectable()
export class FinanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  // 1. Daily Report
  // ─────────────────────────────────────────────────────────────

  async getDailyReport(date?: string) {
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const target = new Date(`${targetDate}T00:00:00.000Z`)

    const yesterday = new Date(target)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const lastWeekSameDay = new Date(target)
    lastWeekSameDay.setUTCDate(lastWeekSameDay.getUTCDate() - 7)

    const dayStart = new Date(target); dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(target); dayEnd.setUTCHours(23, 59, 59, 999)

    const [todaySales, yesterdaySales, lastWeekSameDaySales, byPaymentMethod, hourlyBreakdown, topProducts, byChannel, todayRefunds] =
      await Promise.all([
        this.aggregateSalesForDay(target),
        this.aggregateSalesForDay(yesterday),
        this.aggregateSalesForDay(lastWeekSameDay),
        this.getPaymentBreakdownForDay(target),
        this.getHourlyBreakdown(target),
        this.getTopProductsForDay(target),
        this.getChannelBreakdownForDay(target),
        this.aggregateRefunds(dayStart, dayEnd),
      ])

    // Tax phantom bug fix — mirror getVatReport logic.
    // Refunds must adjust tax + net, not only gross. Same single-rate
    // assumption as getMonthlyReport / getVatReport. Daily KPIs feed
    // dashboard tiles and per-day breakdowns; un-adjusted tax would
    // propagate phantom VAT into every Finanzamt-relevant figure.
    const dayRefundNet = todayRefunds.totalRefunded / 1.19
    const dayRefundVat = todayRefunds.totalRefunded - dayRefundNet
    const dayAdjustedTax = Math.max(0, Number(todaySales.tax) - dayRefundVat)
    const dayAdjustedNet = Math.max(0, Number(todaySales.net) - dayRefundNet)
    const todaySalesAdjusted = {
      ...todaySales,
      tax: dayAdjustedTax.toFixed(2),
      net: dayAdjustedNet.toFixed(2),
    }

    return {
      date: targetDate,
      todaySales: todaySalesAdjusted,
      yesterdaySales,
      lastWeekSameDaySales,
      refunds: {
        total: todayRefunds.totalRefunded.toFixed(2),
        count: todayRefunds.refundCount,
        byChannel: todayRefunds.refundsByChannel,
      },
      netRevenue: (Number(todaySales.gross) - todayRefunds.totalRefunded).toFixed(2),
      byPaymentMethod,
      hourlyBreakdown,
      topProducts,
      byChannel,
    }
  }

  private async aggregateSalesForDay(day: Date): Promise<SalesSummary> {
    const start = new Date(day)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day)
    end.setUTCHours(23, 59, 59, 999)

    const result = await this.prisma.order.aggregate({
      where: {
        ...ORDER_FILTER,
        createdAt: { gte: start, lte: end },
      },
      _sum: { totalAmount: true, taxAmount: true, discountAmount: true, shippingCost: true },
      _count: true,
    })

    const gross = Number(result._sum?.totalAmount ?? 0)
    const tax = Number(result._sum?.taxAmount ?? 0)
    const discount = Number(result._sum?.discountAmount ?? 0)
    const shipping = Number(result._sum?.shippingCost ?? 0)
    const net = gross - tax // Netto = Brutto minus enthaltene MwSt
    const count = result._count

    return {
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      tax: tax.toFixed(2),
      discount: discount.toFixed(2),
      shipping: shipping.toFixed(2),
      orderCount: count,
      avgOrderValue: count > 0 ? (gross / count).toFixed(2) : '0.00',
    }
  }

  /**
   * Aggregate refunds for a date range — used by all finance reports.
   *
   * C17 — explicit channel-symmetry filter: refunds must come from the
   * same set of channels that sales aggregates from (ONLINE_CHANNELS).
   * Pre-C17 this was permissive (no channel filter) and worked by
   * accident because POS has no refund flow. Adding explicit filter
   * documents intent + protects against future channel additions.
   * Refunds from POS or any non-ONLINE_CHANNELS channel are excluded
   * from finance totals — symmetric with sales-side.
   *
   * C17 status-filter (Phase D fix) — Refund-counting semantic:
   *
   *   A refund is counted toward refundsTotal as soon as it's ISSUED
   *   (Refund.status IN ['PENDING', 'PROCESSED']), NOT when the bank
   *   transfer completes.
   *
   * Rationale: aligns with German Soll-Versteuerung (accrual accounting).
   * The decision to refund creates the obligation; bank-transfer timing
   * is an operational detail. FAILED status is excluded — no money
   * actually moved.
   *
   * Async-flow channels (eBay, Vorkasse) start as PENDING and transition
   * to PROCESSED via poll-cron or admin action. Both states count toward
   * the refund total to eliminate phantom-revenue windows during the
   * transition lag — without this, an eBay order canceled but with its
   * refund still in PENDING (until next 60-min poll-cron) appears in
   * gross WITHOUT a matching refund deduction → phantom revenue + tax
   * (the Phase D failure that motivated this fix).
   *
   * Symmetric with getRefundsTotalForRange — same filter applied at
   * line 466 for the parallel refund-aggregation path used by
   * getMonthlyReport.refundsTotal.
   */
  private async aggregateRefunds(start: Date, end: Date): Promise<{ totalRefunded: number; refundCount: number; refundsByChannel: Record<string, number> }> {
    const refunds = await this.prisma.refund.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        // C17 status-filter: count both PENDING and PROCESSED — see JSDoc above.
        status: { in: ['PROCESSED', 'PENDING'] },
        // C17 symmetry: only count refunds for orders from ONLINE_CHANNELS.
        payment: {
          order: { channel: { in: ONLINE_CHANNELS } },
        },
      },
      select: {
        amount: true,
        payment: {
          select: {
            order: { select: { channel: true } },
          },
        },
      },
    })

    let totalRefunded = 0
    const refundsByChannel: Record<string, number> = {}
    for (const r of refunds) {
      const amt = Number(r.amount)
      totalRefunded += amt
      const ch = r.payment?.order?.channel ?? 'website'
      refundsByChannel[ch] = (refundsByChannel[ch] ?? 0) + amt
    }

    return { totalRefunded, refundCount: refunds.length, refundsByChannel }
  }

  private async getPaymentBreakdownForDay(
    day: Date,
  ): Promise<PaymentBreakdown[]> {
    const start = new Date(day)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day)
    end.setUTCHours(23, 59, 59, 999)

    // Include refunded + partially_refunded payments: the money WAS captured,
    // so it counts toward the day's payment-method mix. The refund itself is
    // subtracted separately in aggregateRefunds() — not here. Without this
    // broader filter, refunded orders silently drop out of the payment mix
    // and the sum of per-method totals disagrees with the day's order count.
    const rows = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: { in: ['captured', 'partially_refunded', 'refunded'] },
        order: {
          ...ORDER_FILTER,
          createdAt: { gte: start, lte: end },
        },
      },
      _sum: { amount: true },
      _count: true,
    })

    return rows.map((r) => ({
      method: r.method,
      gross: Number(r._sum.amount ?? 0).toFixed(2),
      count: r._count,
    }))
  }

  private async getHourlyBreakdown(day: Date): Promise<Array<{ hour: number; gross: number; orders: number }>> {
    const start = new Date(day); start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day); end.setUTCHours(23, 59, 59, 999)

    const orders = await this.prisma.order.findMany({
      where: { ...ORDER_FILTER, createdAt: { gte: start, lte: end } },
      select: { totalAmount: true, createdAt: true },
    })

    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, gross: 0, orders: 0 }))
    for (const o of orders) {
      const h = o.createdAt.getUTCHours()
      hourly[h].gross += Number(o.totalAmount)
      hourly[h].orders++
    }
    return hourly
  }

  // TODO(C17.1): The 8 raw-SQL queries below (this one + getVatReport's
  // CTEs + getProfitReport + getBestsellersReport + getCustomerReport's
  // CTEs) all hardcode the channel-list inline as a SQL string literal.
  // This violates single-source-of-truth — adding a new SalesChannel
  // requires updating ONLINE_CHANNELS AND every one of those 8 sites.
  // Refactor to Prisma.sql interpolation against ONLINE_CHANNELS in a
  // follow-up cleanup. C17 fixes the missing 'ebay' in all 8 sites
  // (atomic) but defers the architectural refactor.
  private async getTopProductsForDay(day: Date): Promise<Array<{ name: string; sku: string; quantity: number; revenue: number }>> {
    const start = new Date(day); start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day); end.setUTCHours(23, 59, 59, 999)

    const rows = await this.prisma.$queryRaw<Array<{ product_name: string; sku: string; quantity: bigint; revenue: any }>>`
      SELECT
        COALESCE(pt.name, oi.snapshot_name) as product_name,
        oi.snapshot_sku as sku,
        SUM(oi.quantity) as quantity,
        SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN product_translations pt ON pt.product_id = pv.product_id AND pt.language = 'de'
      WHERE o.created_at >= ${start} AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
        AND o.deleted_at IS NULL
      GROUP BY product_name, oi.snapshot_sku
      ORDER BY revenue DESC
      LIMIT 5
    `

    return rows.map((r) => ({
      name: r.product_name ?? '',
      sku: r.sku ?? '',
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    }))
  }

  private async getChannelBreakdownForDay(day: Date): Promise<Array<{ channel: string; gross: string; count: number }>> {
    const start = new Date(day); start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day); end.setUTCHours(23, 59, 59, 999)

    const rows = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { ...ORDER_FILTER, createdAt: { gte: start, lte: end } },
      _sum: { totalAmount: true },
      _count: true,
    })

    return rows.map((r) => ({
      channel: r.channel,
      gross: Number(r._sum?.totalAmount ?? 0).toFixed(2),
      count: r._count,
    }))
  }

  private async getChannelBreakdownForRange(start: Date, end: Date): Promise<Array<{ channel: string; gross: string; count: number; avgOrderValue: string }>> {
    const rows = await this.prisma.order.groupBy({
      by: ['channel'],
      where: { ...ORDER_FILTER, createdAt: { gte: start, lte: end } },
      _sum: { totalAmount: true },
      _count: true,
    })
    return rows.map((r) => {
      const gross = Number(r._sum?.totalAmount ?? 0)
      return {
        channel: r.channel,
        gross: gross.toFixed(2),
        count: r._count,
        avgOrderValue: r._count > 0 ? (gross / r._count).toFixed(2) : '0.00',
      }
    })
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Monthly Report
  // ─────────────────────────────────────────────────────────────

  async getMonthlyReport(year: number, month: number) {
    const currentStart = new Date(Date.UTC(year, month - 1, 1))
    const currentEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

    const prevStart = new Date(Date.UTC(year, month - 2, 1))
    const prevEnd = new Date(
      Date.UTC(year, month - 1, 0, 23, 59, 59, 999),
    )

    const lastYearStart = new Date(Date.UTC(year - 1, month - 1, 1))
    const lastYearEnd = new Date(
      Date.UTC(year - 1, month, 0, 23, 59, 59, 999),
    )

    const [currentMonth, previousMonth, sameMonthLastYear, refundsTotal, dailyBreakdown, byChannel, refundDetails] =
      await Promise.all([
        this.aggregateSalesForRange(currentStart, currentEnd),
        this.aggregateSalesForRange(prevStart, prevEnd),
        this.aggregateSalesForRange(lastYearStart, lastYearEnd),
        this.getRefundsTotalForRange(currentStart, currentEnd),
        this.getDailyBreakdownForMonth(year, month),
        this.getChannelBreakdownForRange(currentStart, currentEnd),
        this.aggregateRefunds(currentStart, currentEnd),
      ])

    const grossNum = Number(currentMonth.gross)
    const netRevenue = grossNum - refundsTotal

    // Tax phantom bug fix — mirror getVatReport logic.
    // Refunds must adjust tax + net, not only gross. Required for accurate
    // Finanzamt reporting (GoBD compliance). Backend is the single
    // authority for tax/net per the architectural contract documented in
    // apps/web/src/lib/finance-display.ts; the frontend reads these
    // values directly and never re-derives via gross - net.
    // Single-rate (19%) assumption mirrors getVatReport at lines 584-590
    // (Malak today: 19% only; multi-rate future needs pro-rating).
    // Math.max(0, ...) clamps to zero when refunds in the period exceed
    // sales (prior-month sale refunded current period — tax-credit
    // handling is a separate ledger feature).
    const refundNet = refundsTotal / 1.19
    const refundVat = refundsTotal - refundNet
    const adjustedTax = Math.max(0, Number(currentMonth.tax) - refundVat)
    const adjustedNet = Math.max(0, Number(currentMonth.net) - refundNet)

    return {
      year,
      month,
      currentMonth: {
        ...currentMonth,
        tax: adjustedTax.toFixed(2),
        net: adjustedNet.toFixed(2),
        taxTotal: adjustedTax.toFixed(2),
      },
      previousMonth: {
        ...previousMonth,
        taxTotal: previousMonth.tax,
      },
      sameMonthLastYear: {
        ...sameMonthLastYear,
        taxTotal: sameMonthLastYear.tax,
      },
      refundsTotal: refundsTotal.toFixed(2),
      refundCount: refundDetails.refundCount,
      refundsByChannel: refundDetails.refundsByChannel,
      netRevenue: netRevenue.toFixed(2),
      dailyBreakdown,
      byChannel,
    }
  }

  private async aggregateSalesForRange(
    start: Date,
    end: Date,
  ): Promise<SalesSummary> {
    const result = await this.prisma.order.aggregate({
      where: {
        ...ORDER_FILTER,
        createdAt: { gte: start, lte: end },
      },
      _sum: { totalAmount: true, taxAmount: true, discountAmount: true, shippingCost: true },
      _count: true,
    })

    const gross = Number(result._sum?.totalAmount ?? 0)
    const tax = Number(result._sum?.taxAmount ?? 0)
    const discount = Number(result._sum?.discountAmount ?? 0)
    const shipping = Number(result._sum?.shippingCost ?? 0)
    const net = gross - tax
    const count = result._count

    return {
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      tax: tax.toFixed(2),
      discount: discount.toFixed(2),
      shipping: shipping.toFixed(2),
      orderCount: count,
      avgOrderValue: count > 0 ? (gross / count).toFixed(2) : '0.00',
    }
  }

  // C17 — same channel-symmetry filter as aggregateRefunds(). This is
  // a SEPARATE path used by getMonthlyReport's refundsTotal field
  // (distinct from refundDetails which goes through aggregateRefunds).
  // Both paths must apply the same ONLINE_CHANNELS + status filter for
  // symmetric sales/refund accounting.
  //
  // Status filter mirrors aggregateRefunds: counts both PENDING and
  // PROCESSED refunds (German Soll-Versteuerung — refund counted at
  // issuance, not transfer-completion). FAILED excluded. See JSDoc on
  // aggregateRefunds for the full architectural contract.
  private async getRefundsTotalForRange(
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.prisma.refund.aggregate({
      where: {
        // C17 status-filter: count both PENDING and PROCESSED — see
        // aggregateRefunds JSDoc for the architectural contract.
        status: { in: ['PROCESSED', 'PENDING'] },
        createdAt: { gte: start, lte: end },
        payment: {
          order: { channel: { in: ONLINE_CHANNELS } },
        },
      },
      _sum: { amount: true },
    })

    return Number(result._sum.amount ?? 0)
  }

  private async getDailyBreakdownForMonth(year: number, month: number): Promise<Array<{ date: string; gross: string; net: string; tax: string; discount: string; orderCount: number }>> {
    const daysInMonth = new Date(year, month, 0).getDate()
    const rows: Array<{ date: string; gross: string; net: string; tax: string; discount: string; orderCount: number }> = []

    const allOrders = await this.prisma.order.findMany({
      where: {
        ...ORDER_FILTER,
        createdAt: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
        },
      },
      select: { totalAmount: true, taxAmount: true, discountAmount: true, createdAt: true },
    })

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dayOrders = allOrders.filter((o) => o.createdAt.toISOString().slice(0, 10) === dateStr)
      const gross = dayOrders.reduce((s, o) => s + Number(o.totalAmount), 0)
      const tax = dayOrders.reduce((s, o) => s + Number(o.taxAmount), 0)
      const discount = dayOrders.reduce((s, o) => s + Number(o.discountAmount), 0)
      const net = gross - tax
      rows.push({ date: dateStr, gross: gross.toFixed(2), net: net.toFixed(2), tax: tax.toFixed(2), discount: discount.toFixed(2), orderCount: dayOrders.length })
    }

    return rows
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Profit Report
  // ─────────────────────────────────────────────────────────────

  async getProfitReport(dateFrom: string, dateTo: string) {
    const start = new Date(`${dateFrom}T00:00:00.000Z`)
    const end = new Date(`${dateTo}T23:59:59.999Z`)

    // Nur Umsatz pro Produkt — KEIN Einkaufspreis, KEINE Gewinnberechnung
    // Einkaufspreise sind ausschließlich im Lieferanten-System sichtbar
    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string
        product_name: string
        revenue: number
        quantity_sold: number
      }>
    >`
      SELECT
        pv.product_id,
        COALESCE(pt.name, oi.snapshot_name) AS product_name,
        COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS revenue,
        COALESCE(SUM(oi.quantity), 0) AS quantity_sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN product_translations pt
        ON pt.product_id = pv.product_id AND pt.language = 'de'
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
        AND o.deleted_at IS NULL
      GROUP BY pv.product_id, pt.name, oi.snapshot_name
      ORDER BY revenue DESC
    `

    const products = rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      revenue: Number(r.revenue),
      quantitySold: Number(r.quantity_sold),
    }))

    const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0)

    // Top 10 by revenue
    const topProducts = [...products]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // Bottom 10 by revenue
    const bottomProducts = [...products]
      .sort((a, b) => a.revenue - b.revenue)
      .slice(0, 10)

    return {
      dateFrom,
      dateTo,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      topProducts,
      bottomProducts,
      allProducts: products,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. VAT Report (MwSt.)
  // ─────────────────────────────────────────────────────────────

  async getVatReport(dateFrom: string, dateTo: string) {
    const start = new Date(`${dateFrom}T00:00:00.000Z`)
    const end = new Date(`${dateTo}T23:59:59.999Z`)

    // Trust the DB's order-level totals (order.total_amount is the actual
    // gross paid after coupon/discount; order.tax_amount is the MwSt
    // rausgerechnet from that gross). Summing order_items.total_price
    // ignores order.discountAmount — which for a 50%-off coupon on a
    // €19570 cart inflated the reported VAT to €3124.62 instead of the
    // correct €1562.31. Same root cause as the Invoice.netAmount bug
    // (ORD-20260420-000001 incident, fix 8bd0eb0).
    //
    // For multi-rate orders (future — Malak is 19% only today), pro-rate
    // the order-level total/tax by each rate's share of the pre-discount
    // items_sum. Single-rate orders collapse the ratio to 1.0 and we
    // get order.total_amount / order.tax_amount directly. Orders with
    // subtotal=0 are skipped (can't divide).
    // Pro-rating strategy: denominator is the PER-ORDER sum of items
    // (computed in the first CTE), NOT orders.subtotal. Using items-sum
    // guarantees the per-rate contributions sum to order.total_amount
    // exactly, even when orders.subtotal is out of sync with the items
    // (legacy orders, edge-cases, dropped items). The ratio is always
    // rate_items_sum / all_items_sum ∈ [0, 1] within the same order.
    // For single-rate orders (Malak today) this collapses to 1.0.
    const rows = await this.prisma.$queryRaw<
      Array<{
        tax_rate: number
        taxable_amount: number
        tax_amount: number
        gross_amount: number
      }>
    >`
      WITH order_items_totals AS (
        SELECT oi.order_id, SUM(CAST(oi.total_price AS DECIMAL(10,2))) AS all_items_sum
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${start}
          AND o.created_at <= ${end}
          AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
          AND o.deleted_at IS NULL
        GROUP BY oi.order_id
        HAVING SUM(CAST(oi.total_price AS DECIMAL(10,2))) > 0
      ),
      order_rate_shares AS (
        SELECT
          oi.tax_rate,
          o.id AS order_id,
          o.total_amount,
          o.tax_amount,
          oit.all_items_sum,
          SUM(CAST(oi.total_price AS DECIMAL(10,2))) AS rate_items_sum
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN order_items_totals oit ON oit.order_id = o.id
        WHERE o.created_at >= ${start}
          AND o.created_at <= ${end}
          AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
          AND o.deleted_at IS NULL
        GROUP BY oi.tax_rate, o.id, o.total_amount, o.tax_amount, oit.all_items_sum
      )
      SELECT
        tax_rate,
        COALESCE(SUM(total_amount * (rate_items_sum / all_items_sum)), 0) AS gross_amount,
        COALESCE(SUM(tax_amount * (rate_items_sum / all_items_sum)), 0) AS tax_amount,
        COALESCE(SUM((total_amount - tax_amount) * (rate_items_sum / all_items_sum)), 0) AS taxable_amount
      FROM order_rate_shares
      GROUP BY tax_rate
      ORDER BY tax_rate DESC
    `

    const vatLines: VatLine[] = rows.map((r) => ({
      rate: Number(r.tax_rate),
      taxableAmount: Number(Number(r.taxable_amount).toFixed(2)),
      taxAmount: Number(Number(r.tax_amount).toFixed(2)),
      grossAmount: Number(Number(r.gross_amount).toFixed(2)),
    }))

    const totalTaxSales = vatLines.reduce((sum, l) => sum + l.taxAmount, 0)

    // Refunds: calculate VAT on refunded amounts (assume 19% standard rate)
    const refundData = await this.aggregateRefunds(start, end)
    const refundGross = refundData.totalRefunded
    const refundNet = refundGross / 1.19
    const refundVat = refundGross - refundNet

    const netTax = totalTaxSales - refundVat

    return {
      dateFrom,
      dateTo,
      vatLines,
      totalTaxSales: Number(totalTaxSales.toFixed(2)),
      refunds: {
        grossAmount: Number(refundGross.toFixed(2)),
        netAmount: Number(refundNet.toFixed(2)),
        vatAmount: Number(refundVat.toFixed(2)),
        count: refundData.refundCount,
      },
      totalTax: Number(netTax.toFixed(2)), // MwSt-Schuld = Verkäufe - Erstattungen
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Bestsellers Report
  // ─────────────────────────────────────────────────────────────

  async getBestsellersReport(
    dateFrom: string,
    dateTo: string,
    limit: number = 20,
  ) {
    const start = new Date(`${dateFrom}T00:00:00.000Z`)
    const end = new Date(`${dateTo}T23:59:59.999Z`)

    const rows = await this.prisma.$queryRaw<
      Array<{
        product_name: string
        sku: string
        quantity_sold: number
        revenue: number
      }>
    >`
      SELECT
        COALESCE(pt.name, oi.snapshot_name) AS product_name,
        pv.sku,
        COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
        COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = pv.product_id
      LEFT JOIN product_translations pt
        ON pt.product_id = p.id AND pt.language = 'de'
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
        AND o.deleted_at IS NULL
      GROUP BY pt.name, oi.snapshot_name, pv.sku
      ORDER BY quantity_sold DESC
      LIMIT ${limit}
    `

    const bestsellers: BestsellerRow[] = rows.map((r) => ({
      productName: r.product_name,
      sku: r.sku,
      quantitySold: Number(r.quantity_sold),
      revenue: Number(Number(r.revenue).toFixed(2)),
    }))

    return {
      dateFrom,
      dateTo,
      limit,
      bestsellers,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Customer Report
  // ─────────────────────────────────────────────────────────────

  async getCustomerReport(dateFrom: string, dateTo: string) {
    const start = new Date(`${dateFrom}T00:00:00.000Z`)
    const end = new Date(`${dateTo}T23:59:59.999Z`)

    // Top 20 customers by total spent in the period
    const topRows = await this.prisma.$queryRaw<
      Array<{
        user_id: string
        first_name: string
        last_name: string
        email: string
        order_count: number
        total_spent: number
      }>
    >`
      SELECT
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(CAST(o.total_amount AS DECIMAL(10,2))), 0) AS total_spent
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
        AND o.deleted_at IS NULL
        AND o.user_id IS NOT NULL
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY total_spent DESC
      LIMIT 20
    `

    const topCustomers: TopCustomer[] = topRows.map((r) => {
      const totalSpent = Number(r.total_spent)
      const orderCount = Number(r.order_count)

      return {
        userId: r.user_id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        orderCount,
        totalSpent: Number(totalSpent.toFixed(2)),
        avgOrderValue:
          orderCount > 0
            ? Number((totalSpent / orderCount).toFixed(2))
            : 0,
      }
    })

    // New vs returning customers
    // "new" = their first-ever order (across all channels matching our filter) falls within the date range
    // "returning" = they had at least one matching order before the date range

    const newVsReturningRows = await this.prisma.$queryRaw<
      Array<{ customer_type: string; customer_count: number }>
    >`
      WITH customer_first_order AS (
        SELECT
          o.user_id,
          MIN(o.created_at) AS first_order_date
        FROM orders o
        WHERE o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
          AND o.deleted_at IS NULL
          AND o.user_id IS NOT NULL
        GROUP BY o.user_id
      ),
      period_customers AS (
        SELECT DISTINCT o.user_id
        FROM orders o
        WHERE o.created_at >= ${start}
          AND o.created_at <= ${end}
          AND o.channel IN ('website', 'mobile', 'facebook', 'instagram', 'tiktok', 'google', 'whatsapp', 'ebay')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
          AND o.deleted_at IS NULL
          AND o.user_id IS NOT NULL
      )
      SELECT
        CASE
          WHEN cfo.first_order_date >= ${start} AND cfo.first_order_date <= ${end}
            THEN 'new'
          ELSE 'returning'
        END AS customer_type,
        COUNT(*)::int AS customer_count
      FROM period_customers pc
      JOIN customer_first_order cfo ON cfo.user_id = pc.user_id
      GROUP BY customer_type
    `

    let newCustomers = 0
    let returningCustomers = 0
    for (const row of newVsReturningRows) {
      if (row.customer_type === 'new') {
        newCustomers = Number(row.customer_count)
      } else {
        returningCustomers = Number(row.customer_count)
      }
    }

    return {
      dateFrom,
      dateTo,
      topCustomers,
      newVsReturning: {
        newCustomers,
        returningCustomers,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. CSV Export (generic)
  // ─────────────────────────────────────────────────────────────

  exportReportCsv(
    data: Record<string, unknown>[],
    columns: { key: string; label: string }[],
  ): string {
    // UTF-8 BOM for proper Excel encoding
    const BOM = '\uFEFF'

    const header = columns.map((c) => this.escapeCsvField(c.label)).join(';')

    const rows = data.map((row) =>
      columns
        .map((col) => {
          const value = row[col.key]
          if (value === null || value === undefined) return ''
          return this.escapeCsvField(String(value))
        })
        .join(';'),
    )

    return BOM + [header, ...rows].join('\r\n')
  }

  private escapeCsvField(field: string): string {
    // If field contains semicolons, quotes, or newlines, wrap in quotes
    if (
      field.includes(';') ||
      field.includes('"') ||
      field.includes('\n') ||
      field.includes('\r')
    ) {
      return `"${field.replace(/"/g, '""')}"`
    }
    return field
  }

  // ══════════════════════════════════════════════════════════════
  //  MONTHLY REVENUE PDF — for Finanzamt / Steuerberater
  // ══════════════════════════════════════════════════════════════
  //
  //  Premium A4 PDF matching the invoice design (same colors, fonts,
  //  layout). Contains everything the Finanzamt needs:
  //    - Company header with USt-IdNr
  //    - Monthly summary: Brutto, Erstattungen, Netto, MwSt
  //    - Daily breakdown table
  //    - Channel breakdown
  //    - Bank details footer
  //
  //  Uses pdfkit directly (same as invoice.service.ts).

  async generateMonthlyReportPdf(year: number, month: number): Promise<Buffer> {
    const data = await this.getMonthlyReport(year, month)
    const co = await this.getCompanyDataForPdf()

    const GOLD = '#d4a853'
    const DARK = '#1a1a2e'
    const MUTED = '#6b7280'
    const ZEBRA = '#f8f8f8'

    const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
    const monthName = MONTH_NAMES[month - 1]
    const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const fmt = (v: string | number) => {
      const n = typeof v === 'string' ? parseFloat(v) : v
      return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    }

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      let y = 50

      // ── Header ──────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(14).fillColor(DARK)
        .text(co.name, 50, y)
      y += 18
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(co.address, 50, y)
      y += 10
      if (co.phone || co.email) {
        doc.text(`${co.phone ? 'Tel. ' + co.phone + ' | ' : ''}${co.email}`, 50, y)
        y += 10
      }

      // Title: MONATSBERICHT
      doc.font('Helvetica-Bold').fontSize(24).fillColor(DARK)
        .text('MONATSBERICHT', 300, 50, { width: 245, align: 'right' })

      // Gold separator
      y = 95
      doc.moveTo(50, y).lineTo(545, y).lineWidth(2).strokeColor(GOLD).stroke()
      y += 12

      // USt-IdNr + Berichtszeitraum
      if (co.vatId) {
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(`USt-IdNr.: ${co.vatId}`, 50, y)
      }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
        .text(`${monthName} ${year}`, 350, y, { width: 195, align: 'right' })
      y += 12
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(`Erstellt am ${dateStr}`, 350, y, { width: 195, align: 'right' })
      y += 25

      // ══════════════════════════════════════════════════════════
      //  SECTION 1: Monatszusammenfassung
      // ══════════════════════════════════════════════════════════
      doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
        .text('Monatszusammenfassung', 50, y)
      y += 18

      const summaryRows: [string, string, string][] = [
        ['Brutto-Umsatz (Einnahmen)', fmt(data.currentMonth.gross), ''],
        ['Gewährte Rabatte / Gutscheine', '- ' + fmt(data.currentMonth.discount), MUTED],
        ['Versandkosten (vereinnahmt)', fmt(data.currentMonth.shipping), ''],
        ['', '', ''], // spacer
        ['Erstattungen (Retouren)', '- ' + fmt(data.refundsTotal), '#dc2626'],
        ['', '', ''], // spacer
        ['Netto-Umsatz (nach Erstattungen)', fmt(data.netRevenue), ''],
        ['', '', ''], // spacer
        ['Enthaltene MwSt. 19% (Umsatzsteuer)', fmt(data.currentMonth.tax), ''],
        ['Umsatz ohne MwSt. (Netto)', fmt(data.currentMonth.net), ''],
      ]

      for (const [label, value, color] of summaryRows) {
        if (!label && !value) { y += 6; continue }
        const isTotal = label.startsWith('Netto-Umsatz') || label.startsWith('Enthaltene MwSt') || label.startsWith('Umsatz ohne MwSt')
        if (isTotal) {
          doc.moveTo(50, y - 2).lineTo(545, y - 2).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
        }
        doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(isTotal ? 9.5 : 8.5)
          .fillColor(color || DARK)
          .text(label, 58, y, { width: 340 })
        doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(isTotal ? 9.5 : 8.5)
          .fillColor(color || DARK)
          .text(value, 400, y, { width: 140, align: 'right' })
        y += isTotal ? 18 : 15
      }

      // Gold line under summary
      y += 4
      doc.moveTo(50, y).lineTo(545, y).lineWidth(1.5).strokeColor(GOLD).stroke()
      y += 6

      // Finanzamt-Zeile
      doc.rect(50, y, 495, 22).fill('#fef3c7')
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#92400e')
        .text('An das Finanzamt abzuführende Umsatzsteuer', 58, y + 5, { width: 340 })
        .text(fmt(data.currentMonth.tax), 400, y + 5, { width: 140, align: 'right' })
      y += 32

      // Bestellungen-Info
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(`${data.currentMonth.orderCount} Bestellungen  ·  Ø ${fmt(data.currentMonth.avgOrderValue)} pro Bestellung  ·  ${data.refundCount} Erstattung${data.refundCount === 1 ? '' : 'en'}`, 50, y)
      y += 25

      // ══════════════════════════════════════════════════════════
      //  SECTION 2: Tagesübersicht
      // ══════════════════════════════════════════════════════════
      if (y > 600) { doc.addPage(); y = 50 }

      doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
        .text('Tagesübersicht', 50, y)
      y += 16

      // Table header
      doc.rect(50, y - 4, 495, 20).fill(DARK)
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
      doc.text('DATUM', 58, y, { width: 70 })
      doc.text('BESTELL.', 130, y, { width: 45, align: 'center' })
      doc.text('BRUTTO', 178, y, { width: 80, align: 'right' })
      doc.text('MWST 19%', 262, y, { width: 70, align: 'right' })
      doc.text('NETTO', 336, y, { width: 70, align: 'right' })
      doc.text('RABATT', 410, y, { width: 65, align: 'right' })
      y += 20

      // Table rows — only show days with orders
      let rowIdx = 0
      let totalGross = 0, totalTax = 0, totalNet = 0, totalDiscount = 0, totalOrders = 0

      for (const day of data.dailyBreakdown) {
        if (day.orderCount === 0) continue
        if (y > 720) { doc.addPage(); y = 50 }

        if (rowIdx % 2 === 0) doc.rect(50, y - 3, 495, 16).fill(ZEBRA)
        const gross = parseFloat(day.gross)
        const tax = parseFloat(day.tax)
        const net = gross - tax
        const discount = parseFloat(day.discount)
        totalGross += gross; totalTax += tax; totalNet += net; totalDiscount += discount; totalOrders += day.orderCount

        const dayDate = new Date(day.date + 'T12:00:00')
        const dayStr = dayDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

        doc.font('Helvetica').fontSize(7.5).fillColor(DARK)
        doc.text(dayStr, 58, y, { width: 70 })
        doc.text(String(day.orderCount), 130, y, { width: 45, align: 'center' })
        doc.text(fmt(gross), 178, y, { width: 80, align: 'right' })
        doc.text(fmt(tax), 262, y, { width: 70, align: 'right' })
        doc.text(fmt(net), 336, y, { width: 70, align: 'right' })
        doc.fillColor(discount > 0 ? '#16a34a' : MUTED)
          .text(discount > 0 ? '- ' + fmt(discount) : '—', 410, y, { width: 65, align: 'right' })
        y += 16
        rowIdx++
      }

      // Table footer (sum row)
      y += 2
      doc.moveTo(50, y).lineTo(545, y).lineWidth(1).strokeColor(DARK).stroke()
      y += 6
      doc.font('Helvetica-Bold').fontSize(8).fillColor(DARK)
      doc.text('SUMME', 58, y, { width: 70 })
      doc.text(String(totalOrders), 130, y, { width: 45, align: 'center' })
      doc.text(fmt(totalGross), 178, y, { width: 80, align: 'right' })
      doc.text(fmt(totalTax), 262, y, { width: 70, align: 'right' })
      doc.text(fmt(totalNet), 336, y, { width: 70, align: 'right' })
      doc.fillColor(totalDiscount > 0 ? '#16a34a' : MUTED)
        .text(totalDiscount > 0 ? '- ' + fmt(totalDiscount) : '—', 410, y, { width: 65, align: 'right' })
      y += 25

      // ══════════════════════════════════════════════════════════
      //  SECTION 3: Kanal-Aufschlüsselung
      // ══════════════════════════════════════════════════════════
      if (y > 680) { doc.addPage(); y = 50 }

      if (data.byChannel?.length > 0) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK)
          .text('Umsatz nach Verkaufskanal', 50, y)
        y += 16

        doc.rect(50, y - 4, 495, 20).fill(DARK)
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
        doc.text('KANAL', 58, y, { width: 120 })
        doc.text('BESTELLUNGEN', 180, y, { width: 80, align: 'center' })
        doc.text('UMSATZ (BRUTTO)', 264, y, { width: 100, align: 'right' })
        doc.text('Ø WERT', 368, y, { width: 80, align: 'right' })
        doc.text('ANTEIL', 452, y, { width: 85, align: 'right' })
        y += 20

        const channelTotal = data.byChannel.reduce((s: number, c: any) => s + parseFloat(c.gross), 0)
        const CHANNEL_LABELS: Record<string, string> = {
          website: 'Webshop', mobile: 'Mobile App', facebook: 'Facebook Shop',
          instagram: 'Instagram Shop', tiktok: 'TikTok Shop', google: 'Google Shopping', whatsapp: 'WhatsApp',
        }

        data.byChannel.forEach((ch: any, i: number) => {
          if (y > 750) { doc.addPage(); y = 50 }
          if (i % 2 === 0) doc.rect(50, y - 3, 495, 16).fill(ZEBRA)
          const gross = parseFloat(ch.gross)
          const pct = channelTotal > 0 ? ((gross / channelTotal) * 100).toFixed(1) + '%' : '—'
          doc.font('Helvetica').fontSize(7.5).fillColor(DARK)
          doc.text(CHANNEL_LABELS[ch.channel] ?? ch.channel, 58, y, { width: 120 })
          doc.text(String(ch.count), 180, y, { width: 80, align: 'center' })
          doc.text(fmt(gross), 264, y, { width: 100, align: 'right' })
          doc.text(fmt(ch.avgOrderValue), 368, y, { width: 80, align: 'right' })
          doc.text(pct, 452, y, { width: 85, align: 'right' })
          y += 16
        })
        y += 15
      }

      // ══════════════════════════════════════════════════════════
      //  FOOTER: Bank + Legal
      // ══════════════════════════════════════════════════════════
      if (y > 710) { doc.addPage(); y = 50 }

      y = Math.max(y, 730)
      doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(GOLD).stroke()
      y += 8

      const footerParts: string[] = []
      if (co.bankName) footerParts.push(`Bankverbindung: ${co.bankName}`)
      if (co.iban) footerParts.push(`IBAN: ${co.iban}`)
      if (co.bic) footerParts.push(`BIC: ${co.bic}`)
      if (footerParts.length > 0) {
        doc.font('Helvetica').fontSize(6.5).fillColor('#9ca3af')
          .text(footerParts.join('  ·  '), 50, y, { width: 495, align: 'center' })
        y += 10
      }
      doc.font('Helvetica').fontSize(6).fillColor('#9ca3af')
        .text(`${co.name}  ·  ${co.address}${co.vatId ? '  ·  USt-IdNr.: ' + co.vatId : ''}`, 50, y, { width: 495, align: 'center' })

      doc.end()
    })
  }

  /** Load company data from ShopSettings (same source as invoice.service.ts) */
  private async getCompanyDataForPdf() {
    const settings = await this.prisma.shopSetting.findMany()
    const db: Record<string, string> = {}
    for (const s of settings) db[s.key] = s.value
    return {
      name: db.companyName || 'Malak Bekleidung',
      address: db.companyAddress || '',
      vatId: db.companyVatId || '',
      phone: db.companyPhone || '',
      email: db.companyEmail || 'info@malak-bekleidung.com',
      bankName: db.bankName || '',
      iban: db.bankIban || '',
      bic: db.bankBic || '',
    }
  }
}
