import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
// Single source of truth for "what counts toward gross revenue" —
// shared with finance-reports to prevent the two services from drifting
// apart again (the exact bug shape of Launch-Blocker #3).
//
// C17 — also imports ONLINE_CHANNELS for the same reason: dashboard
// revenue tiles MUST aggregate the same channel-set as finance-reports.
// Pre-C17 the dashboard had NO channel filter at all (over-counted
// eBay vs finance-reports which excluded eBay) — the asymmetry made
// dashboard "Today's revenue" disagree with finance daily report.
import { COUNTABLE_STATUSES, ONLINE_CHANNELS } from './finance-reports.service'

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name)

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
    // All day/week/month boundaries are anchored to UTC, matching the
    // convention used by finance-reports.service.ts. Previously these used
    // local-server-time constructors (e.g. `new Date(y, m, d)`), which on a
    // Berlin-local machine produced boundaries 1-2h off from the finance
    // reports' UTC-aligned buckets — same day's revenue showed different
    // numbers on the dashboard vs. the reports page. GoBD requires
    // consistent, reproducible time boundaries across all finance views.
    // Production hosts run in UTC, so this change is a no-op in prod; it
    // only shifts dev-machine behaviour into alignment with finance-reports.
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)
    // ISO 8601 / German convention: week starts Monday. getUTCDay returns
    // 0=Sunday..6=Saturday; map Sunday→6-days-back-to-Monday, anything else→(n-1).
    const weekStart = new Date(todayStart)
    const dow = weekStart.getUTCDay()
    const daysBackToMonday = dow === 0 ? 6 : dow - 1
    weekStart.setUTCDate(weekStart.getUTCDate() - daysBackToMonday)
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))

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
      // Today's revenue — FINANCIAL KPI. Uses COUNTABLE_STATUSES + the
      // ONLINE_CHANNELS filter (C17) so it matches finance-reports
      // .aggregateSalesForDay exactly. Pre-C17 had no channel filter and
      // included POS + always counted eBay (asymmetric vs finance which
      // excluded eBay). Previously the COUNTABLE_STATUSES alignment was
      // added in Launch-Blocker #3; this is the channel-side equivalent.
      this.prisma.order.aggregate({
        where: { channel: { in: ONLINE_CHANNELS }, createdAt: { gte: todayStart }, status: { in: COUNTABLE_STATUSES }, deletedAt: null },
        _sum: { totalAmount: true, subtotal: true },
        _count: true,
      }),
      // This week — FINANCIAL KPI, see todayOrders comment above.
      this.prisma.order.aggregate({
        where: { channel: { in: ONLINE_CHANNELS }, createdAt: { gte: weekStart }, status: { in: COUNTABLE_STATUSES }, deletedAt: null },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // This month — FINANCIAL KPI, see todayOrders comment above.
      this.prisma.order.aggregate({
        where: { channel: { in: ONLINE_CHANNELS }, createdAt: { gte: monthStart }, status: { in: COUNTABLE_STATUSES }, deletedAt: null },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Last month — FINANCIAL KPI used for month-over-month comparison.
      this.prisma.order.aggregate({
        where: {
          channel: { in: ONLINE_CHANNELS },
          createdAt: { gte: lastMonthStart, lt: monthStart },
          status: { in: COUNTABLE_STATUSES },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Orders by status — OPERATIONAL pipeline view.
      // Intentionally includes EVERY status (pending, cancelled, disputed,
      // etc.) because this drives the admin's "where are my orders right
      // now" pie/bar chart. Narrowing to COUNTABLE_STATUSES would hide
      // pending orders and break pipeline visibility.
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
      // Recent 10 orders — OPERATIONAL activity feed.
      // Intentionally unfiltered by status so a fresh pending order shows
      // up immediately (admin wants to see new orders in real time, not
      // wait ~15 minutes for payment capture). Narrowing to
      // COUNTABLE_STATUSES would hide pending orders from this list.
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
      // Recent 10 audit actions.
      // C15.7 — Dashboard recent-activity widget ALWAYS excludes
      // tier='ephemeral' (eBay LOPP webhooks etc.) because it represents
      // human-driven admin actions, not telemetry. Without this filter,
      // ~106 ebay-deletion-notifications/h would dominate the timeline
      // and bury real admin events. The opt-in toggle for ephemeral lives
      // on /admin/audit-log only — no toggle here, this is the executive-
      // summary view. See AuditService.findAll JSDoc for the full contract.
      this.prisma.adminAuditLog.findMany({
        where: { tier: { not: 'ephemeral' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Open disputes — OPERATIONAL, gezielter Single-Status-Filter.
      // Lists the orders currently in the 'disputed' state for admin
      // attention (chargebacks, Stripe disputes, etc.). Status filter
      // here is INTENTIONAL and has nothing to do with revenue logic.
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
      // Revenue by payment method.
      // C17: nested ONLINE_CHANNELS filter on order so payment-method
      // breakdown matches the same revenue universe as the today/week/
      // month aggregates above.
      this.prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: true,
        where: {
          status: 'captured',
          order: { channel: { in: ONLINE_CHANNELS }, deletedAt: null },
        },
      }),
      // Top 10 products this month — FINANCIAL KPI.
      // Status list below MUST stay in sync with COUNTABLE_STATUSES in
      // finance-reports.service.ts. Hardcoded inline because Prisma's
      // $queryRaw template tag cannot cleanly interpolate a TS string[]
      // into SQL `IN (...)` without switching to the more verbose
      // Prisma.sql helper — keeping this readable trades a tiny sync
      // obligation for grep-friendly SQL. If COUNTABLE_STATUSES ever
      // changes, update this list too (Fix 4 regression test catches drift).
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
          AND o.status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
          AND o.deleted_at IS NULL
        GROUP BY oi.snapshot_name, pt_de.name, pt_en.name, pt_ar.name, pi.url
        ORDER BY total_revenue DESC
        LIMIT 10
      `,
      // Today's revenue by channel — FINANCIAL KPI.
      // Same COUNTABLE_STATUSES + ONLINE_CHANNELS filter as the today/
      // week/month aggregates so the channel-breakdown sum matches
      // today.revenueGross. C17: added ONLINE_CHANNELS for parity with
      // finance-reports byChannel.
      this.prisma.order.groupBy({
        by: ['channel'],
        _sum: { totalAmount: true },
        _count: true,
        where: { channel: { in: ONLINE_CHANNELS }, createdAt: { gte: todayStart }, status: { in: COUNTABLE_STATUSES }, deletedAt: null },
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
      // Revenue for the last 7 days (incl. today), grouped per UTC day —
      // FINANCIAL KPI, drives the "Revenue — Last 7 Days" chart.
      // Status list below MUST stay in sync with COUNTABLE_STATUSES in
      // finance-reports.service.ts. Same hardcoding rationale as the
      // topProducts query above — Prisma's $queryRaw template tag does not
      // interpolate string[] cleanly into SQL IN-lists without the more
      // verbose Prisma.sql helper. If COUNTABLE_STATUSES changes, update
      // this list too; Fix 4's regression test will catch any drift.
      this.prisma.$queryRaw<Array<{ day: Date; revenue: number; order_count: number }>>`
        SELECT
          DATE_TRUNC('day', created_at)::timestamp AS day,
          COALESCE(SUM(CAST(total_amount AS DECIMAL(10,2))), 0)::float AS revenue,
          COUNT(*)::int AS order_count
        FROM orders
        WHERE created_at >= ${new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)}
          AND status IN ('confirmed', 'processing', 'shipped', 'delivered', 'returned', 'refunded')
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
      // setUTCDate to stay on UTC day boundaries (matches the UTC anchor of
      // todayStart above). setDate would use local-time, risking a 1-day
      // shift across DST transitions on non-UTC machines.
      const d = new Date(todayStart)
      d.setUTCDate(d.getUTCDate() - i)
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
    // OPERATIONAL ratio — cancellation percentage over the last 30 days.
    // The denominator (`total`) MUST include every order regardless of
    // status, the numerator only 'cancelled' — that's the math. Swapping
    // in COUNTABLE_STATUSES here would shrink the denominator and falsely
    // inflate the ratio. This is intentionally NOT a finance metric.
    //
    // Rolling 30-day window from the current instant. Millisecond
    // subtraction is timezone-free: no DST ambiguity at month boundaries.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
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
    // Same UTC-anchored boundaries as getOverview above (see the comment
    // block there for the reasoning — keep finance-dashboard alignment
    // consistent across every query in this service).
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)
    const weekStart = new Date(todayStart)
    weekStart.setUTCDate(weekStart.getUTCDate() - 7)
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

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
