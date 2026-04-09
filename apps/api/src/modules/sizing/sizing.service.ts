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

  async findChartForProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
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

    // 3. Fallback: any chart for category
    return this.prisma.sizeChart.findFirst({
      where: { categoryId: product.categoryId, isActive: true },
      include: { entries: { orderBy: { sortOrder: 'asc' } } },
    })
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
