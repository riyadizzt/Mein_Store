import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name)

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1) // Monday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const [
      todayOrders,
      weekOrders,
      monthOrders,
      lastMonthOrders,
      ordersByStatus,
      lowStock,
      recentOrders,
      recentAudit,
      disputes,
      pendingReturns,
      revenueByPayment,
      topProducts,
      todayByChannel,
      openOrdersUnread,
      lowStockCountRows,
      revenueLast7DaysRaw,
    ] = await Promise.all([
      // Today's revenue
      this.prisma.order.aggregate({
        where: { createdAt: { gte: todayStart }, status: { notIn: ['cancelled'] }, deletedAt: null },
        _sum: { totalAmount: true, subtotal: true },
        _count: true,
      }),
      // This week
      this.prisma.order.aggregate({
        where: { createdAt: { gte: weekStart }, status: { notIn: ['cancelled'] }, deletedAt: null },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // This month
      this.prisma.order.aggregate({
        where: { createdAt: { gte: monthStart }, status: { notIn: ['cancelled'] }, deletedAt: null },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Last month (for comparison)
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: lastMonthStart, lt: monthStart },
          status: { notIn: ['cancelled'] },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Orders by status
      this.prisma.order.groupBy({
        by: ['status'],
        _count: true,
        where: { deletedAt: null },
      }),
      // Low stock — items where on_hand - reserved <= reorder_point.
      //
      // Filters to avoid badge noise:
      //   - p.deleted_at IS NULL: skip soft-deleted products (test data,
      //     garbage collection candidates — not real low-stock situations)
      //   - p.is_active AND pv.is_active: skip inactive SKUs (dormant)
      //   - reorder_point > 0: skip rows where no reorder trigger is set.
      //     After the pre-launch reset, non-default warehouses are empty
      //     but also set reorder_point=0 → they don't alert. A warehouse
      //     that's genuinely stocking this variant will have reorder_point>0.
      //
      // LIMIT 20 caps the detail list; a separate UNLIMITED count ships as
      // lowStockCount so the sidebar badge is honest instead of always
      // reading "20" when there are 20+ items.
      this.prisma.$queryRaw<Array<{
        sku: string
        product_name: string
        image_url: string | null
        warehouse_name: string
        quantity_on_hand: number
        quantity_reserved: number
        reorder_point: number
      }>>`
        SELECT pv.sku, pt.name AS product_name,
               pi.url AS image_url,
               w.name AS warehouse_name,
               i.quantity_on_hand, i.quantity_reserved, i.reorder_point
        FROM inventory i
        JOIN product_variants pv ON pv.id = i.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de'
        LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
        JOIN warehouses w ON w.id = i.warehouse_id
        WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
          AND i.reorder_point > 0
          AND p.deleted_at IS NULL
          AND p.is_active = true
          AND pv.is_active = true
        ORDER BY (i.quantity_on_hand - i.quantity_reserved) ASC
        LIMIT 20
      `,
      // Recent 10 orders
      this.prisma.order.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          channel: true,
          guestEmail: true,
          totalAmount: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Recent 10 audit actions
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Open disputes
      this.prisma.order.findMany({
        where: { status: 'disputed', deletedAt: null },
        select: { id: true, orderNumber: true, totalAmount: true, createdAt: true },
      }),
      // Pending returns
      this.prisma.return.findMany({
        where: { status: { in: ['requested', 'label_sent', 'in_transit'] } },
        include: { order: { select: { orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      // Revenue by payment method
      this.prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: true,
        where: { status: 'captured' },
      }),
      // Top 10 products this month (with names in all 3 locales + images)
      this.prisma.$queryRaw<Array<{
        snapshot_name: string
        product_name_de: string | null
        product_name_en: string | null
        product_name_ar: string | null
        image_url: string | null
        total_revenue: number
        total_quantity: number
      }>>`
        SELECT oi.snapshot_name,
               pt_de.name as product_name_de,
               pt_en.name as product_name_en,
               pt_ar.name as product_name_ar,
               pi.url as image_url,
               COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) as total_revenue,
               COALESCE(SUM(oi.quantity), 0) as total_quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_translations pt_de ON pt_de.product_id = p.id AND pt_de.language = 'de'
        LEFT JOIN product_translations pt_en ON pt_en.product_id = p.id AND pt_en.language = 'en'
        LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.language = 'ar'
        LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
        WHERE o.created_at >= ${monthStart}
          AND o.status != 'cancelled'
          AND o.deleted_at IS NULL
        GROUP BY oi.snapshot_name, pt_de.name, pt_en.name, pt_ar.name, pi.url
        ORDER BY total_revenue DESC
        LIMIT 10
      `,
      // Today's revenue by channel
      this.prisma.order.groupBy({
        by: ['channel'],
        _sum: { totalAmount: true },
        _count: true,
        where: { createdAt: { gte: todayStart }, status: { notIn: ['cancelled'] }, deletedAt: null },
      }),
      // Unread (first-viewed-by-admin-at IS NULL) orders — ALL statuses.
      // Powers the sidebar badge. Consistent with the red pulsing dot in
      // the orders list which appears on every unread row regardless of
      // status. Previously filtered to open-pipeline statuses only, which
      // caused the mismatch: a refunded unread order showed the dot but
      // wasn't counted in the badge — user ended up with red dots they
      // couldn't "clear" by looking at the sidebar. Now badge = dot count.
      this.prisma.order.count({
        where: {
          firstViewedByAdminAt: null,
          deletedAt: null,
        },
      }),
      // Unbounded count of the same low-stock set the query above returns
      // (without the LIMIT 20) — the sidebar badge shows this. Keeps the
      // badge truthful instead of always clamping at 20 whenever there
      // are ≥ 20 low-stock rows.
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM inventory i
        JOIN product_variants pv ON pv.id = i.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE (i.quantity_on_hand - i.quantity_reserved) <= i.reorder_point
          AND i.reorder_point > 0
          AND p.deleted_at IS NULL
          AND p.is_active = true
          AND pv.is_active = true
      `,
      // Revenue for the last 7 days (incl. today), grouped per calendar day.
      // Drives the "Revenue — Last 7 Days" chart on the dashboard. Before
      // this query, the chart used Math.random() mock data — embarrassingly
      // visible after the pre-launch reset when every real number was 0.
      // Excludes cancelled orders and soft-deleted orders, same filter as the
      // today/week/month aggregates above for consistency.
      this.prisma.$queryRaw<Array<{ day: Date; revenue: number; order_count: number }>>`
        SELECT
          DATE_TRUNC('day', created_at)::timestamp AS day,
          COALESCE(SUM(CAST(total_amount AS DECIMAL(10,2))), 0)::float AS revenue,
          COUNT(*)::int AS order_count
        FROM orders
        WHERE created_at >= ${new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)}
          AND status NOT IN ('cancelled')
          AND deleted_at IS NULL
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY day ASC
      `,
    ])

    // Normalise the 7-day revenue series so the chart always has 7 points,
    // even on days without orders. Days without orders → revenue=0. Keyed
    // by YYYY-MM-DD so DST-shifts don't shift the buckets.
    const revenueLast7Days: Array<{ date: string; revenue: number; orderCount: number }> = []
    const dayMap = new Map<string, { revenue: number; orderCount: number }>()
    for (const row of revenueLast7DaysRaw as any[]) {
      const key = new Date(row.day).toISOString().slice(0, 10)
      dayMap.set(key, { revenue: Number(row.revenue ?? 0), orderCount: Number(row.order_count ?? 0) })
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const hit = dayMap.get(key)
      revenueLast7Days.push({
        date: key,
        revenue: hit?.revenue ?? 0,
        orderCount: hit?.orderCount ?? 0,
      })
    }

    // Calculate comparison percentages
    const thisMonthRevenue = Number(monthOrders._sum.totalAmount ?? 0)
    const lastMonthRevenue = Number(lastMonthOrders._sum.totalAmount ?? 0)
    const monthOverMonth = lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : null

    const todayRevenue = Number(todayOrders._sum.totalAmount ?? 0)
    const todayNetRevenue = Number(todayOrders._sum.subtotal ?? 0)
    const avgOrderValue = todayOrders._count > 0
      ? (todayRevenue / todayOrders._count).toFixed(2)
      : '0.00'

    return {
      today: {
        revenueGross: todayRevenue.toFixed(2),
        revenueNet: todayNetRevenue.toFixed(2),
        orderCount: todayOrders._count,
        avgOrderValue,
      },
      thisWeek: {
        revenue: Number(weekOrders._sum.totalAmount ?? 0).toFixed(2),
        orderCount: weekOrders._count,
      },
      thisMonth: {
        revenue: thisMonthRevenue.toFixed(2),
        orderCount: monthOrders._count,
        monthOverMonth: monthOverMonth ? `${Number(monthOverMonth) > 0 ? '+' : ''}${monthOverMonth}%` : null,
      },
      ordersByStatus: ordersByStatus.map((s) => ({ status: s.status, count: s._count })),
      // Sidebar-badge feed: unread orders that still need admin attention.
      // Decrements the moment an admin opens the order (findOne fires the
      // updateMany that stamps firstViewedByAdminAt).
      openOrdersUnread,
      // Truthful low-stock count (not capped by the list's LIMIT 20).
      lowStockCount: Number(lowStockCountRows?.[0]?.n ?? 0),
      // Real revenue for the dashboard chart (7 days incl. today, always
      // exactly 7 entries — days without orders have revenue=0).
      revenueLast7Days,
      recentOrders,
      recentAuditActions: recentAudit,
      disputes: {
        count: disputes.length,
        totalAmount: disputes.reduce((s, d) => s + Number(d.totalAmount), 0).toFixed(2),
        items: disputes,
      },
      pendingReturns: {
        count: pendingReturns.length,
        items: pendingReturns,
      },
      revenueByPaymentMethod: revenueByPayment.map((r) => ({
        method: r.method,
        revenue: Number(r._sum.amount ?? 0).toFixed(2),
        count: r._count,
      })),
      // Convert BigInt from raw SQL to Number for JSON serialization.
      // `name` kept as DE default for backwards-compat with other consumers
      // (finance page etc.); nameDe/nameEn/nameAr exposed so the dashboard
      // top-products widget can pick the viewing admin's locale at render.
      topProducts: (topProducts as any[]).map((p) => ({
        name: p.product_name_de ?? p.snapshot_name,
        nameDe: p.product_name_de ?? null,
        nameEn: p.product_name_en ?? null,
        nameAr: p.product_name_ar ?? null,
        snapshotName: p.snapshot_name ?? null,
        imageUrl: p.image_url ?? null,
        revenue: Number(p.total_revenue ?? 0),
        quantity: Number(p.total_quantity ?? 0),
      })),
      lowStock: lowStock.map((inv: any) => ({
        sku: inv.sku,
        product: inv.product_name ?? inv.sku,
        imageUrl: inv.image_url ?? null,
        warehouse: inv.warehouse_name,
        onHand: Number(inv.quantity_on_hand),
        reserved: Number(inv.quantity_reserved),
        available: Number(inv.quantity_on_hand) - Number(inv.quantity_reserved),
        reorderPoint: Number(inv.reorder_point),
      })),
      cancellationRate: await this.getCancellationRate(),
      todayByChannel: (todayByChannel as any[]).map((r: any) => ({
        channel: r.channel,
        revenue: Number(r._sum?.totalAmount ?? 0).toFixed(2),
        count: r._count,
      })),
      abandonedCarts: await this.getAbandonedCartsToday(todayStart),
    }
    } catch (err) {
      this.logger.error('Dashboard getOverview failed', err)
      return {
        today: { revenueGross: '0.00', revenueNet: '0.00', orderCount: 0, avgOrderValue: '0.00' },
        thisWeek: { revenue: '0.00', orderCount: 0 },
        thisMonth: { revenue: '0.00', orderCount: 0, monthOverMonth: null },
        ordersByStatus: [],
        openOrdersUnread: 0,
        lowStockCount: 0,
        revenueLast7Days: [],
        lowStock: [],
        recentOrders: [],
        recentAuditActions: [],
        disputes: { count: 0, totalAmount: '0.00', items: [] },
        pendingReturns: { count: 0, items: [] },
        revenueByPaymentMethod: [],
        topProducts: [],
        cancellationRate: { rate: '0.0', cancelled: 0, total: 0 },
        todayByChannel: [],
        abandonedCarts: { count: 0, totalValue: '0.00' },
      }
    }
  }

  private async getCancellationRate() {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const [total, cancelled] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo }, deletedAt: null } }),
      this.prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo }, deletedAt: null, status: 'cancelled' } }),
    ])
    return { rate: total > 0 ? ((cancelled / total) * 100).toFixed(1) : '0.0', cancelled, total }
  }

  private async getAbandonedCartsToday(todayStart: Date) {
    const carts = await this.prisma.abandonedCart.findMany({
      where: { recoveredAt: null, createdAt: { gte: todayStart } },
      select: { totalAmount: true },
    })
    return {
      count: carts.length,
      totalValue: carts.reduce((s, c) => s + Number(c.totalAmount), 0).toFixed(2),
    }
  }

  // ── Search Analytics ──────────────────────────────────
  async getSearchAnalytics() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - 7)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Total searches
    const [totalToday, totalWeek, totalMonth] = await Promise.all([
      this.prisma.searchLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.searchLog.count({ where: { createdAt: { gte: weekStart } } }),
      this.prisma.searchLog.count({ where: { createdAt: { gte: monthStart } } }),
    ])

    // Top search terms (last 30 days)
    const topTerms = await this.prisma.$queryRaw<{ query: string; count: bigint; avg_results: number }[]>`
      SELECT query, COUNT(*) as count, AVG(result_count)::int as avg_results
      FROM search_logs
      WHERE created_at >= ${monthStart}
      GROUP BY query
      ORDER BY count DESC
      LIMIT 20
    `

    // Zero-result searches (last 30 days)
    const zeroResults = await this.prisma.$queryRaw<{ query: string; count: bigint }[]>`
      SELECT query, COUNT(*) as count
      FROM search_logs
      WHERE created_at >= ${monthStart} AND result_count = 0
      GROUP BY query
      ORDER BY count DESC
      LIMIT 20
    `

    return {
      totals: {
        today: totalToday,
        week: totalWeek,
        month: totalMonth,
      },
      topTerms: topTerms.map((t) => ({ query: t.query, count: Number(t.count), avgResults: t.avg_results })),
      zeroResults: zeroResults.map((t) => ({ query: t.query, count: Number(t.count) })),
    }
  }
}
