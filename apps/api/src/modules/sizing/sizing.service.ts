import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class SizingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── SIZE CHARTS CRUD ──────────────────────────────────────

  async findAllCharts(query?: { supplierId?: string; categoryId?: string; chartType?: string }) {
    const where: any = { isActive: true }
    if (query?.supplierId) where.supplierId = query.supplierId
    if (query?.categoryId) where.categoryId = query.categoryId
    if (query?.chartType) where.chartType = query.chartType

    return this.prisma.sizeChart.findMany({
      where,
      include: {
        entries: { orderBy: { sortOrder: 'asc' } },
        supplier: { select: { id: true, name: true, country: true } },
        category: { include: { translations: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findChartById(id: string) {
    const chart = await this.prisma.sizeChart.findUnique({
      where: { id },
      include: {
        entries: { orderBy: { sortOrder: 'asc' } },
        supplier: { select: { id: true, name: true, country: true } },
        category: { include: { translations: true } },
      },
    })
    if (!chart) throw new NotFoundException('Size chart not found')
    return chart
  }

  async createChart(data: {
    name: string
    supplierId?: string
    categoryId?: string
    chartType: string
    fitNote?: string
    fitNoteAr?: string
    fitNoteEn?: string
    isDefault?: boolean
    entries?: Array<{
      size: string; sortOrder?: number
      bust?: number; waist?: number; hip?: number; length?: number
      inseam?: number; shoulder?: number; sleeve?: number
      footLength?: number; bodyHeight?: number; euSize?: string
    }>
  }) {
    return this.prisma.sizeChart.create({
      data: {
        name: data.name,
        supplierId: data.supplierId || null,
        categoryId: data.categoryId || null,
        chartType: data.chartType as any,
        fitNote: data.fitNote,
        fitNoteAr: data.fitNoteAr,
        fitNoteEn: data.fitNoteEn,
        isDefault: data.isDefault ?? false,
        entries: data.entries?.length ? {
          create: data.entries.map((e, i) => ({
            size: e.size,
            sortOrder: e.sortOrder ?? i,
            bust: e.bust, waist: e.waist, hip: e.hip, length: e.length,
            inseam: e.inseam, shoulder: e.shoulder, sleeve: e.sleeve,
            footLength: e.footLength, bodyHeight: e.bodyHeight, euSize: e.euSize,
          })),
        } : undefined,
      },
      include: { entries: { orderBy: { sortOrder: 'asc' } } },
    })
  }

  async updateChart(id: string, data: any) {
    return this.prisma.sizeChart.update({
      where: { id },
      data: {
        name: data.name,
        supplierId: data.supplierId,
        categoryId: data.categoryId,
        chartType: data.chartType,
        fitNote: data.fitNote,
        fitNoteAr: data.fitNoteAr,
        fitNoteEn: data.fitNoteEn,
        isDefault: data.isDefault,
      },
    })
  }

  async deleteChart(id: string) {
    await this.prisma.sizeChart.update({ where: { id }, data: { isActive: false } })
  }

  // ── SIZE CHART ENTRIES ────────────────────────────────────

  async addEntry(chartId: string, data: any) {
    return this.prisma.sizeChartEntry.create({
      data: { sizeChartId: chartId, ...data },
    })
  }

  async updateEntry(entryId: string, data: any) {
    return this.prisma.sizeChartEntry.update({ where: { id: entryId }, data })
  }

  async deleteEntry(entryId: string) {
    await this.prisma.sizeChartEntry.delete({ where: { id: entryId } })
  }

  async bulkUpsertEntries(chartId: string, entries: any[]) {
    // Delete existing and recreate
    await this.prisma.sizeChartEntry.deleteMany({ where: { sizeChartId: chartId } })
    await this.prisma.sizeChartEntry.createMany({
      data: entries.map((e: any, i: number) => ({
        sizeChartId: chartId,
        size: e.size,
        sortOrder: e.sortOrder ?? i,
        bust: e.bust, waist: e.waist, hip: e.hip, length: e.length,
        inseam: e.inseam, shoulder: e.shoulder, sleeve: e.sleeve,
        footLength: e.footLength, bodyHeight: e.bodyHeight, euSize: e.euSize,
      })),
    })
  }

  // ── FIND CHART FOR PRODUCT ────────────────────────────────
  //
  // Three-tier fallback:
  //   1. Supplier-specific chart (most recent delivery's supplier + category match)
  //   2. Category-default chart (isDefault=true for the product's category)
  //   3. Any chart for the category — deterministic order-by to remove the
  //      audit-flagged "random chart wins" behaviour. Oldest chart wins.
  //
  // Soft-deleted products (deletedAt != null) no longer resolve a chart —
  // historical order views would otherwise show a stale size guide for a
  // product that's no longer on the shop. Returning null lets the
  // consumer render a "chart unavailable" state instead.
  async findChartForProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { categoryId: true },
    })
    if (!product?.categoryId) return null

    // 1. Try to find supplier-specific chart via delivery history
    const variant = await this.prisma.productVariant.findFirst({
      where: { productId },
      select: { id: true },
    })
    const deliveryItem = variant ? await this.prisma.supplierDeliveryItem.findFirst({
      where: { variantId: variant.id },
      include: { delivery: { select: { supplierId: true } } },
      orderBy: { createdAt: 'desc' },
    }) : null

    if (deliveryItem?.delivery?.supplierId) {
      const supplierChart = await this.prisma.sizeChart.findFirst({
        where: {
          supplierId: deliveryItem.delivery.supplierId,
          categoryId: product.categoryId,
          isActive: true,
        },
        include: { entries: { orderBy: { sortOrder: 'asc' } }, supplier: { select: { name: true } } },
      })
      if (supplierChart) return supplierChart
    }

    // 2. Fallback: default chart for category
    const defaultChart = await this.prisma.sizeChart.findFirst({
      where: { categoryId: product.categoryId, isDefault: true, isActive: true },
      include: { entries: { orderBy: { sortOrder: 'asc' } } },
    })
    if (defaultChart) return defaultChart

    // 3. Fallback: any chart for category, deterministic (oldest first).
    // Pre-hardening this used findFirst with no orderBy — non-deterministic,
    // customers could see different charts on refresh when a category had
    // multiple non-default charts. Oldest-first is stable + gives the admin
    // agency (the chart they created first wins).
    return this.prisma.sizeChart.findFirst({
      where: { categoryId: product.categoryId, isActive: true },
      include: { entries: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ── ADMIN: preview which chart a product would resolve to under a
  // hypothetical category change. Runs the same 3-tier fallback as
  // findChartForProduct, but against a caller-supplied target
  // categoryId instead of the product's current one. Used by the
  // product-edit UI to warn "changing category X → Y will switch the
  // customer's size guide from 'Chart A' to 'Chart B'".

  async previewChartForCategory(productId: string, targetCategoryId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, categoryId: true },
    })
    if (!product) return { current: null, preview: null, willChange: false }

    const currentChart = await this.findChartForProduct(productId)

    // Run the 3-tier resolution against the hypothetical categoryId
    const variant = await this.prisma.productVariant.findFirst({
      where: { productId },
      select: { id: true },
    })
    const deliveryItem = variant ? await this.prisma.supplierDeliveryItem.findFirst({
      where: { variantId: variant.id },
      include: { delivery: { select: { supplierId: true } } },
      orderBy: { createdAt: 'desc' },
    }) : null

    let previewChart: any = null
    if (deliveryItem?.delivery?.supplierId) {
      previewChart = await this.prisma.sizeChart.findFirst({
        where: {
          supplierId: deliveryItem.delivery.supplierId,
          categoryId: targetCategoryId,
          isActive: true,
        },
        select: { id: true, name: true, chartType: true },
      })
    }
    if (!previewChart) {
      previewChart = await this.prisma.sizeChart.findFirst({
        where: { categoryId: targetCategoryId, isDefault: true, isActive: true },
        select: { id: true, name: true, chartType: true },
      })
    }
    if (!previewChart) {
      previewChart = await this.prisma.sizeChart.findFirst({
        where: { categoryId: targetCategoryId, isActive: true },
        select: { id: true, name: true, chartType: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    const currentId = currentChart?.id ?? null
    const previewId = previewChart?.id ?? null
    return {
      current: currentChart ? { id: currentChart.id, name: currentChart.name, chartType: currentChart.chartType } : null,
      preview: previewChart,
      willChange: currentId !== previewId,
    }
  }

  // Lists category ids where the tier-3 fallback is ambiguous — more
  // than one non-default active chart attached to the same category.
  // Admin UI flags these so the admin knows which categories need a
  // designated default (currently oldest-chart wins silently).
  async listCategoriesWithChartConflicts() {
    const grouped = await this.prisma.sizeChart.groupBy({
      by: ['categoryId'],
      where: { isActive: true, categoryId: { not: null } },
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    })

    const conflicts: Array<{
      categoryId: string
      chartCount: number
      hasDefault: boolean
      chartNames: string[]
    }> = []

    for (const g of grouped) {
      if (!g.categoryId) continue
      const charts = await this.prisma.sizeChart.findMany({
        where: { categoryId: g.categoryId, isActive: true },
        select: { id: true, name: true, isDefault: true },
        orderBy: { createdAt: 'asc' },
      })
      const hasDefault = charts.some((c) => c.isDefault)
      // Only flag as conflict if tier-3 would actually trigger (no default)
      if (!hasDefault && charts.length > 1) {
        conflicts.push({
          categoryId: g.categoryId,
          chartCount: charts.length,
          hasDefault: false,
          chartNames: charts.map((c) => c.name),
        })
      }
    }

    return { conflicts, count: conflicts.length }
  }

  // ── CUSTOMER MEASUREMENTS ─────────────────────────────────

  async getCustomerMeasurements(userId: string) {
    return this.prisma.customerMeasurement.findUnique({ where: { userId } })
  }

  async saveCustomerMeasurements(userId: string, data: any) {
    return this.prisma.customerMeasurement.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  }

  // ── SIZE RECOMMENDATION ───────────────────────────────────

  async getRecommendation(productId: string, measurements: {
    heightCm?: number; weightKg?: number; bustCm?: number
    waistCm?: number; hipCm?: number; footLengthCm?: number
  }) {
    const chart = await this.findChartForProduct(productId)
    if (!chart || !chart.entries.length) {
      return { recommendation: null, reason: 'no_chart' }
    }

    const entries = chart.entries
    let bestMatch: any = null
    let bestScore = Infinity

    for (const entry of entries) {
      let score = 0
      let factors = 0

      if (measurements.bustCm && entry.bust) {
        score += Math.abs(measurements.bustCm - Number(entry.bust))
        factors++
      }
      if (measurements.waistCm && entry.waist) {
        score += Math.abs(measurements.waistCm - Number(entry.waist))
        factors++
      }
      if (measurements.hipCm && entry.hip) {
        score += Math.abs(measurements.hipCm - Number(entry.hip))
        factors++
      }
      if (measurements.footLengthCm && entry.footLength) {
        score += Math.abs(measurements.footLengthCm - Number(entry.footLength)) * 3 // Shoes are more sensitive
        factors++
      }
      if (measurements.heightCm && entry.bodyHeight) {
        score += Math.abs(measurements.heightCm - Number(entry.bodyHeight))
        factors++
      }

      if (factors > 0) {
        const avgScore = score / factors
        if (avgScore < bestScore) {
          bestScore = avgScore
          bestMatch = entry
        }
      }
    }

    if (!bestMatch) {
      return { recommendation: null, reason: 'no_measurements_match' }
    }

    const confidence = bestScore < 2 ? 'high' : bestScore < 5 ? 'medium' : 'low'

    return {
      recommendation: bestMatch.size,
      confidence,
      score: Math.round(bestScore * 10) / 10,
      fitNote: chart.fitNote,
      fitNoteAr: (chart as any).fitNoteAr,
      fitNoteEn: (chart as any).fitNoteEn,
      chartName: chart.name,
      entry: bestMatch,
    }
  }
}
