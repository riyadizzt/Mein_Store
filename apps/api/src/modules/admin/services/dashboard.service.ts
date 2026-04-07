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
      // Low stock (items where on_hand - reserved <= reorder_point)
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
      // Top 10 products this month (with names + images)
      this.prisma.$queryRaw<Array<{
        snapshot_name: string
        product_name: string | null
        image_url: string | null
        total_revenue: number
        total_quantity: number
      }>>`
        SELECT oi.snapshot_name,
               pt.name as product_name,
               pi.url as image_url,
               COALESCE(SUM(CAST(oi.total_price AS DECIMAL(10,2))), 0) as total_revenue,
               COALESCE(SUM(oi.quantity), 0) as total_quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.language = 'de'
        LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
        WHERE o.created_at >= ${monthStart}
          AND o.status != 'cancelled'
          AND o.deleted_at IS NULL
        GROUP BY oi.snapshot_name, pt.name, pi.url
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
    ])

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
      // Convert BigInt from raw SQL to Number for JSON serialization
      topProducts: (topProducts as any[]).map((p) => ({
        name: p.product_name ?? p.snapshot_name,
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
}
