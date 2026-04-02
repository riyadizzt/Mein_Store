import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { OrderStatus, SalesChannel } from '@prisma/client'

// Only online channels — exclude POS and scanner
const ONLINE_CHANNELS: SalesChannel[] = ['website', 'mobile']

// Only countable statuses — exclude pending, cancelled, refunded
const COUNTABLE_STATUSES: OrderStatus[] = ['confirmed', 'processing', 'shipped', 'delivered']

/** Shared where-clause for all finance queries */
const ORDER_FILTER = {
  channel: { in: ONLINE_CHANNELS },
  status: { in: COUNTABLE_STATUSES },
  deletedAt: null,
}

interface SalesSummary {
  gross: string
  net: string
  orderCount: number
  avgOrderValue: string
}

interface PaymentBreakdown {
  method: string
  gross: string
  count: number
}

interface ProfitProduct {
  productId: string
  productName: string
  revenue: number
  cost: number
  profit: number
  margin: number
}

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

    const [todaySales, yesterdaySales, lastWeekSameDaySales, byPaymentMethod, hourlyBreakdown, topProducts, byChannel] =
      await Promise.all([
        this.aggregateSalesForDay(target),
        this.aggregateSalesForDay(yesterday),
        this.aggregateSalesForDay(lastWeekSameDay),
        this.getPaymentBreakdownForDay(target),
        this.getHourlyBreakdown(target),
        this.getTopProductsForDay(target),
        this.getChannelBreakdownForDay(target),
      ])

    return {
      date: targetDate,
      todaySales,
      yesterdaySales,
      lastWeekSameDaySales,
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
      _sum: { totalAmount: true, subtotal: true },
      _count: true,
    })

    const gross = Number(result._sum?.totalAmount ?? 0)
    const net = Number(result._sum?.subtotal ?? 0)
    const count = result._count

    return {
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      orderCount: count,
      avgOrderValue: count > 0 ? (gross / count).toFixed(2) : '0.00',
    }
  }

  private async getPaymentBreakdownForDay(
    day: Date,
  ): Promise<PaymentBreakdown[]> {
    const start = new Date(day)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(day)
    end.setUTCHours(23, 59, 59, 999)

    const rows = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'captured',
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
        AND o.channel IN ('website', 'mobile')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
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

    const [currentMonth, previousMonth, sameMonthLastYear, refundsTotal, dailyBreakdown] =
      await Promise.all([
        this.aggregateSalesForRange(currentStart, currentEnd),
        this.aggregateSalesForRange(prevStart, prevEnd),
        this.aggregateSalesForRange(lastYearStart, lastYearEnd),
        this.getRefundsTotalForRange(currentStart, currentEnd),
        this.getDailyBreakdownForMonth(year, month),
      ])

    const grossNum = Number(currentMonth.gross)
    const netRevenue = grossNum - refundsTotal

    return {
      year,
      month,
      currentMonth: {
        ...currentMonth,
        taxTotal: (grossNum - Number(currentMonth.net)).toFixed(2),
      },
      previousMonth: {
        ...previousMonth,
        taxTotal: (
          Number(previousMonth.gross) - Number(previousMonth.net)
        ).toFixed(2),
      },
      sameMonthLastYear: {
        ...sameMonthLastYear,
        taxTotal: (
          Number(sameMonthLastYear.gross) - Number(sameMonthLastYear.net)
        ).toFixed(2),
      },
      refundsTotal: refundsTotal.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      dailyBreakdown,
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
      _sum: { totalAmount: true, subtotal: true },
      _count: true,
    })

    const gross = Number(result._sum?.totalAmount ?? 0)
    const net = Number(result._sum?.subtotal ?? 0)
    const count = result._count

    return {
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      orderCount: count,
      avgOrderValue: count > 0 ? (gross / count).toFixed(2) : '0.00',
    }
  }

  private async getRefundsTotalForRange(
    start: Date,
    end: Date,
  ): Promise<number> {
    const result = await this.prisma.refund.aggregate({
      where: {
        status: 'PROCESSED',
        createdAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    })

    return Number(result._sum.amount ?? 0)
  }

  private async getDailyBreakdownForMonth(year: number, month: number): Promise<Array<{ date: string; gross: string; net: string; orderCount: number }>> {
    const daysInMonth = new Date(year, month, 0).getDate()
    const rows: Array<{ date: string; gross: string; net: string; orderCount: number }> = []

    const allOrders = await this.prisma.order.findMany({
      where: {
        ...ORDER_FILTER,
        createdAt: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
        },
      },
      select: { totalAmount: true, subtotal: true, createdAt: true },
    })

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dayOrders = allOrders.filter((o) => o.createdAt.toISOString().slice(0, 10) === dateStr)
      const gross = dayOrders.reduce((s, o) => s + Number(o.totalAmount), 0)
      const net = dayOrders.reduce((s, o) => s + Number(o.subtotal), 0)
      rows.push({ date: dateStr, gross: gross.toFixed(2), net: net.toFixed(2), orderCount: dayOrders.length })
    }

    return rows
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Profit Report
  // ─────────────────────────────────────────────────────────────

  async getProfitReport(dateFrom: string, dateTo: string) {
    const start = new Date(`${dateFrom}T00:00:00.000Z`)
    const end = new Date(`${dateTo}T23:59:59.999Z`)

    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string
        product_name: string
        revenue: number
        cost: number
      }>
    >`
      SELECT
        pv.product_id,
        COALESCE(pt.name, oi.snapshot_name) AS product_name,
        COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS revenue,
        COALESCE(SUM(oi.quantity * CAST(COALESCE(pv.purchase_price, 0) AS DECIMAL(10,2))), 0) AS cost
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN product_translations pt
        ON pt.product_id = pv.product_id AND pt.language = 'de'
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
        AND o.deleted_at IS NULL
      GROUP BY pv.product_id, pt.name, oi.snapshot_name
      ORDER BY revenue DESC
    `

    const products: ProfitProduct[] = rows.map((r) => {
      const revenue = Number(r.revenue)
      const cost = Number(r.cost)
      const profit = revenue - cost
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0

      return {
        productId: r.product_id,
        productName: r.product_name,
        revenue,
        cost,
        profit,
        margin: Number(margin.toFixed(2)),
      }
    })

    const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0)
    const totalCost = products.reduce((sum, p) => sum + p.cost, 0)
    const totalProfit = totalRevenue - totalCost
    const overallMarginPercent =
      totalRevenue > 0
        ? Number(((totalProfit / totalRevenue) * 100).toFixed(2))
        : 0

    // Top 10 by profit
    const topProducts = [...products]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10)

    // Bottom 10 by margin (lowest margin, including negative)
    const bottomProducts = [...products]
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 10)

    return {
      dateFrom,
      dateTo,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      overallMarginPercent,
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

    const rows = await this.prisma.$queryRaw<
      Array<{
        tax_rate: number
        taxable_amount: number
        tax_amount: number
        gross_amount: number
      }>
    >`
      SELECT
        oi.tax_rate,
        COALESCE(SUM(
          CAST(oi.total_price AS DECIMAL(10,2)) /
          (1 + CAST(oi.tax_rate AS DECIMAL(5,2)) / 100)
        ), 0) AS taxable_amount,
        COALESCE(SUM(
          CAST(oi.total_price AS DECIMAL(10,2)) -
          CAST(oi.total_price AS DECIMAL(10,2)) /
          (1 + CAST(oi.tax_rate AS DECIMAL(5,2)) / 100)
        ), 0) AS tax_amount,
        COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) AS gross_amount
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${start}
        AND o.created_at <= ${end}
        AND o.channel IN ('website', 'mobile')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
        AND o.deleted_at IS NULL
      GROUP BY oi.tax_rate
      ORDER BY oi.tax_rate DESC
    `

    const vatLines: VatLine[] = rows.map((r) => ({
      rate: Number(r.tax_rate),
      taxableAmount: Number(Number(r.taxable_amount).toFixed(2)),
      taxAmount: Number(Number(r.tax_amount).toFixed(2)),
      grossAmount: Number(Number(r.gross_amount).toFixed(2)),
    }))

    const totalTax = vatLines.reduce((sum, l) => sum + l.taxAmount, 0)

    return {
      dateFrom,
      dateTo,
      vatLines,
      totalTax: Number(totalTax.toFixed(2)),
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
        AND o.channel IN ('website', 'mobile')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
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
        AND o.channel IN ('website', 'mobile')
        AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
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
        WHERE o.channel IN ('website', 'mobile')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
          AND o.deleted_at IS NULL
          AND o.user_id IS NOT NULL
        GROUP BY o.user_id
      ),
      period_customers AS (
        SELECT DISTINCT o.user_id
        FROM orders o
        WHERE o.created_at >= ${start}
          AND o.created_at <= ${end}
          AND o.channel IN ('website', 'mobile')
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
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
}
