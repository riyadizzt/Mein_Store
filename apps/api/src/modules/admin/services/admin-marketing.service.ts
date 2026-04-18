import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class AdminMarketingService {
  private readonly logger = new Logger(AdminMarketingService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  // COUPONS
  // ═══════════════════════════════════════════════════════════════

  async findAllCoupons(query: {
    search?: string
    isActive?: boolean
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 25, 200)
    const offset = query.offset ?? 0
    const where: Record<string, unknown> = {}

    if (query.isActive !== undefined) {
      where.isActive = query.isActive
    }

    if (query.search) {
      where.code = { contains: query.search, mode: 'insensitive' }
    }

    const [coupons, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        include: {
          appliesToCategory: {
            select: { id: true, translations: { select: { language: true, name: true } } },
          },
          appliesToProduct: {
            select: {
              id: true,
              translations: { select: { language: true, name: true } },
            },
          },
          _count: { select: { usages: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.coupon.count({ where }),
    ])

    return {
      data: coupons.map((c) => ({
        ...c,
        discountPercent: c.discountPercent ? Number(c.discountPercent) : null,
        discountAmount: c.discountAmount ? Number(c.discountAmount) : null,
        minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
        totalUsages: c._count.usages,
      })),
      meta: { total, limit, offset },
    }
  }

  async createCoupon(data: {
    code: string
    type: 'percentage' | 'fixed_amount' | 'free_shipping'
    description?: string
    discountPercent?: number
    discountAmount?: number
    freeShipping?: boolean
    minOrderAmount?: number
    maxUsageCount?: number
    onePerCustomer?: boolean
    startAt?: string | Date
    expiresAt?: string | Date
    appliesToCategoryId?: string
    appliesToProductId?: string
    isActive?: boolean
  }) {
    // Validate: code must be unique
    const existing = await this.prisma.coupon.findUnique({
      where: { code: data.code.toUpperCase().trim() },
    })
    if (existing) {
      throw new BadRequestException({
        de: 'Ein Gutschein mit diesem Code existiert bereits.',
        en: 'A coupon with this code already exists.',
        ar: 'يوجد قسيمة بهذا الرمز بالفعل.',
      })
    }

    // Validate: at least one discount field must be set
    const hasDiscount =
      (data.discountPercent != null && data.discountPercent > 0) ||
      (data.discountAmount != null && data.discountAmount > 0) ||
      data.freeShipping === true
    if (!hasDiscount) {
      throw new BadRequestException({
        de: 'Mindestens ein Rabattfeld muss gesetzt sein (Prozent, Betrag oder kostenloser Versand).',
        en: 'At least one discount field must be set (percent, amount, or free shipping).',
        ar: 'يجب تعيين حقل خصم واحد على الأقل (نسبة مئوية أو مبلغ أو شحن مجاني).',
      })
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code: data.code.toUpperCase().trim(),
        type: data.type,
        description: data.description ?? null,
        discountPercent: data.discountPercent ?? null,
        discountAmount: data.discountAmount ?? null,
        freeShipping: data.freeShipping ?? false,
        minOrderAmount: data.minOrderAmount ?? null,
        maxUsageCount: data.maxUsageCount ?? null,
        onePerCustomer: data.onePerCustomer ?? false,
        startAt: data.startAt ? new Date(data.startAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        appliesToCategoryId: data.appliesToCategoryId ?? null,
        appliesToProductId: data.appliesToProductId ?? null,
        isActive: data.isActive ?? true,
      },
    })

    this.logger.log(`Coupon created: ${coupon.code} (${coupon.id})`)
    return coupon
  }

  async updateCoupon(
    id: string,
    data: {
      code?: string
      type?: 'percentage' | 'fixed_amount' | 'free_shipping'
      description?: string
      discountPercent?: number | null
      discountAmount?: number | null
      freeShipping?: boolean
      minOrderAmount?: number | null
      maxUsageCount?: number | null
      onePerCustomer?: boolean
      startAt?: string | Date | null
      expiresAt?: string | Date | null
      appliesToCategoryId?: string | null
      appliesToProductId?: string | null
      isActive?: boolean
    },
  ) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } })
    if (!coupon) {
      throw new NotFoundException({
        de: 'Gutschein nicht gefunden.',
        en: 'Coupon not found.',
        ar: 'القسيمة غير موجودة.',
      })
    }

    // If code is being changed, check uniqueness
    if (data.code && data.code.toUpperCase().trim() !== coupon.code) {
      const existing = await this.prisma.coupon.findUnique({
        where: { code: data.code.toUpperCase().trim() },
      })
      if (existing) {
        throw new BadRequestException({
          de: 'Ein Gutschein mit diesem Code existiert bereits.',
          en: 'A coupon with this code already exists.',
          ar: 'يوجد قسيمة بهذا الرمز بالفعل.',
        })
      }
    }

    const updateData: Record<string, unknown> = {}
    if (data.code !== undefined) updateData.code = data.code.toUpperCase().trim()
    if (data.type !== undefined) updateData.type = data.type
    if (data.description !== undefined) updateData.description = data.description
    if (data.discountPercent !== undefined) updateData.discountPercent = data.discountPercent
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount
    if (data.freeShipping !== undefined) updateData.freeShipping = data.freeShipping
    if (data.minOrderAmount !== undefined) updateData.minOrderAmount = data.minOrderAmount
    if (data.maxUsageCount !== undefined) updateData.maxUsageCount = data.maxUsageCount
    if (data.onePerCustomer !== undefined) updateData.onePerCustomer = data.onePerCustomer
    if (data.startAt !== undefined) updateData.startAt = data.startAt ? new Date(data.startAt as string) : null
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt as string) : null
    if (data.appliesToCategoryId !== undefined) updateData.appliesToCategoryId = data.appliesToCategoryId
    if (data.appliesToProductId !== undefined) updateData.appliesToProductId = data.appliesToProductId
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: updateData,
    })

    this.logger.log(`Coupon updated: ${updated.code} (${updated.id})`)
    return updated
  }

  async toggleCoupon(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } })
    if (!coupon) {
      throw new NotFoundException({
        de: 'Gutschein nicht gefunden.',
        en: 'Coupon not found.',
        ar: 'القسيمة غير موجودة.',
      })
    }

    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { isActive: !coupon.isActive },
    })

    this.logger.log(`Coupon toggled: ${updated.code} → ${updated.isActive ? 'active' : 'inactive'}`)
    return updated
  }

  async getCouponStats(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } })
    if (!coupon) {
      throw new NotFoundException({
        de: 'Gutschein nicht gefunden.',
        en: 'Coupon not found.',
        ar: 'القسيمة غير موجودة.',
      })
    }

    // Total uses
    const totalUses = await this.prisma.couponUsage.count({
      where: { couponId: id },
    })

    // Revenue generated (sum of order totals where this coupon was used)
    const revenueResult = await this.prisma.couponUsage.findMany({
      where: { couponId: id },
      select: {
        order: { select: { totalAmount: true } },
      },
    })

    const totalRevenue = revenueResult.reduce(
      (sum, usage) => sum + Number(usage.order.totalAmount),
      0,
    )

    const averageOrderValue = totalUses > 0 ? totalRevenue / totalUses : 0

    return {
      couponId: id,
      code: coupon.code,
      totalUses,
      maxUsageCount: coupon.maxUsageCount,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    }
  }

  async validateCoupon(
    code: string,
    options?: {
      userId?: string
      email?: string
      subtotal?: number
      hasPromotion?: boolean
    },
  ): Promise<
    | {
        valid: true
        coupon: {
          code: string
          type: string
          discountPercent: number | null
          discountAmount: number | null
          freeShipping: boolean
          description: string | null
        }
      }
    | {
        valid: false
        // Machine-readable classification of the rejection. Lets downstream
        // callers (order-create, checkout UI) branch on semantic meaning
        // without pattern-matching the human-readable message.
        //
        // Backwards-compatibility: the existing `reason: { de, en, ar }` field
        // stays untouched — this is an ADDITION, not a replacement.
        reasonCode:
          | 'invalid'           // code does not exist
          | 'not_active'        // isActive=false
          | 'expired'           // past expiresAt
          | 'not_yet_started'   // before startAt
          | 'max_usage'         // global usage limit reached
          | 'one_per_customer'  // onePerCustomer guard hit
          | 'email_abuse'       // non-onePerCustomer email-rate-limit hit
          | 'min_order'         // subtotal below minOrderAmount
        reason: { de: string; en: string; ar: string }
      }
  > {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase().trim() },
    })

    // Check: exists
    if (!coupon) {
      return {
        valid: false,
        reasonCode: 'invalid',
        reason: {
          de: 'Dieser Gutscheincode ist ungültig.',
          en: 'This coupon code is invalid.',
          ar: 'رمز القسيمة هذا غير صالح.',
        },
      }
    }

    // Check: isActive
    if (!coupon.isActive) {
      return {
        valid: false,
        reasonCode: 'not_active',
        reason: {
          de: 'Dieser Gutschein ist derzeit nicht aktiv.',
          en: 'This coupon is currently not active.',
          ar: 'هذه القسيمة غير نشطة حاليًا.',
        },
      }
    }

    const now = new Date()

    // Check: not expired
    if (coupon.expiresAt && coupon.expiresAt < now) {
      return {
        valid: false,
        reasonCode: 'expired',
        reason: {
          de: 'Dieser Gutschein ist abgelaufen.',
          en: 'This coupon has expired.',
          ar: 'انتهت صلاحية هذه القسيمة.',
        },
      }
    }

    // Check: startAt reached
    if (coupon.startAt && coupon.startAt > now) {
      return {
        valid: false,
        reasonCode: 'not_yet_started',
        reason: {
          de: 'Dieser Gutschein ist noch nicht gültig.',
          en: 'This coupon is not yet valid.',
          ar: 'هذه القسيمة ليست صالحة بعد.',
        },
      }
    }

    // Check: maxUsageCount not exceeded
    if (coupon.maxUsageCount != null && coupon.usedCount >= coupon.maxUsageCount) {
      return {
        valid: false,
        reasonCode: 'max_usage',
        reason: {
          de: 'Dieser Gutschein wurde bereits zu oft eingelöst.',
          en: 'This coupon has reached its maximum usage limit.',
          ar: 'وصلت هذه القسيمة إلى الحد الأقصى للاستخدام.',
        },
      }
    }

    // Check: onePerCustomer — by userId OR email (abuse protection for guests)
    if (coupon.onePerCustomer) {
      const usageWhere: Record<string, unknown>[] = []
      if (options?.userId) {
        usageWhere.push({ couponId: coupon.id, userId: options.userId })
      }
      if (options?.email) {
        usageWhere.push({ couponId: coupon.id, email: options.email.toLowerCase().trim() })
      }

      if (usageWhere.length > 0) {
        const existingUsage = await this.prisma.couponUsage.findFirst({
          where: { OR: usageWhere },
        })

        if (existingUsage) {
          return {
            valid: false,
            reasonCode: 'one_per_customer',
            reason: {
              de: 'Sie haben diesen Gutschein bereits verwendet.',
              en: 'You have already used this coupon.',
              ar: 'لقد استخدمت هذه القسيمة بالفعل.',
            },
          }
        }
      }
    }

    // Abuse protection: check email even when NOT onePerCustomer
    // (prevents same guest email from using a coupon excessively)
    if (!coupon.onePerCustomer && options?.email) {
      const emailUsageCount = await this.prisma.couponUsage.count({
        where: {
          couponId: coupon.id,
          email: options.email.toLowerCase().trim(),
        },
      })
      // Allow max 3 uses per email for non-onePerCustomer coupons
      if (emailUsageCount >= 3) {
        return {
          valid: false,
          reasonCode: 'email_abuse',
          reason: {
            de: 'Sie haben diesen Gutschein bereits zu oft verwendet.',
            en: 'You have used this coupon too many times.',
            ar: 'لقد استخدمت هذه القسيمة مرات كثيرة جدًا.',
          },
        }
      }
    }

    // Check: minOrderAmount
    if (
      coupon.minOrderAmount != null &&
      options?.subtotal != null &&
      options.subtotal < Number(coupon.minOrderAmount)
    ) {
      const minAmount = Number(coupon.minOrderAmount).toFixed(2)
      return {
        valid: false,
        reasonCode: 'min_order',
        reason: {
          de: `Der Mindestbestellwert von ${minAmount} EUR wurde nicht erreicht.`,
          en: `The minimum order amount of ${minAmount} EUR has not been reached.`,
          ar: `لم يتم الوصول إلى الحد الأدنى لقيمة الطلب ${minAmount} يورو.`,
        },
      }
    }

    // Note: hasPromotion flag is accepted but coupons CAN be combined with promotions.
    // The "only 1 coupon per order" rule is enforced at order creation time, not here.

    return {
      valid: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        discountPercent: coupon.discountPercent ? Number(coupon.discountPercent) : null,
        discountAmount: coupon.discountAmount ? Number(coupon.discountAmount) : null,
        freeShipping: coupon.freeShipping,
        description: coupon.description,
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PROMOTIONS
  // ═══════════════════════════════════════════════════════════════

  async findAllPromotions(query: {
    isActive?: boolean
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(query.limit ?? 25, 200)
    const offset = query.offset ?? 0
    const where: Record<string, unknown> = {}

    if (query.isActive !== undefined) {
      where.isActive = query.isActive
    }

    const [promotions, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: {
          category: {
            select: { id: true, translations: { select: { language: true, name: true } } },
          },
          product: {
            select: {
              id: true,
              translations: { select: { language: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.promotion.count({ where }),
    ])

    const now = new Date()
    return {
      data: promotions.map((p) => ({
        ...p,
        discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
        discountAmount: p.discountAmount ? Number(p.discountAmount) : null,
        isCurrentlyActive: p.isActive && p.startAt <= now && p.endAt >= now,
      })),
      meta: { total, limit, offset },
    }
  }

  async createPromotion(data: {
    name: string
    type: 'seasonal' | 'quantity_discount' | 'flash_sale'
    description?: string
    discountPercent?: number
    discountAmount?: number
    minQuantity?: number
    categoryId?: string
    productId?: string
    startAt: string | Date
    endAt: string | Date
    isActive?: boolean
  }) {
    // Validate: at least one discount field
    const hasDiscount =
      (data.discountPercent != null && data.discountPercent > 0) ||
      (data.discountAmount != null && data.discountAmount > 0)
    if (!hasDiscount) {
      throw new BadRequestException({
        de: 'Mindestens ein Rabattfeld muss gesetzt sein (Prozent oder Betrag).',
        en: 'At least one discount field must be set (percent or amount).',
        ar: 'يجب تعيين حقل خصم واحد على الأقل (نسبة مئوية أو مبلغ).',
      })
    }

    // Validate: endAt must be after startAt
    const startAt = new Date(data.startAt)
    const endAt = new Date(data.endAt)
    if (endAt <= startAt) {
      throw new BadRequestException({
        de: 'Das Enddatum muss nach dem Startdatum liegen.',
        en: 'The end date must be after the start date.',
        ar: 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
      })
    }

    const promotion = await this.prisma.promotion.create({
      data: {
        name: data.name.trim(),
        type: data.type,
        description: data.description ?? null,
        discountPercent: data.discountPercent ?? null,
        discountAmount: data.discountAmount ?? null,
        minQuantity: data.minQuantity ?? null,
        categoryId: data.categoryId ?? null,
        productId: data.productId ?? null,
        startAt,
        endAt,
        isActive: data.isActive ?? true,
      },
    })

    this.logger.log(`Promotion created: ${promotion.name} (${promotion.id})`)
    return promotion
  }

  async updatePromotion(
    id: string,
    data: {
      name?: string
      type?: 'seasonal' | 'quantity_discount' | 'flash_sale'
      description?: string | null
      discountPercent?: number | null
      discountAmount?: number | null
      minQuantity?: number | null
      categoryId?: string | null
      productId?: string | null
      startAt?: string | Date
      endAt?: string | Date
      isActive?: boolean
    },
  ) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } })
    if (!promotion) {
      throw new NotFoundException({
        de: 'Aktion nicht gefunden.',
        en: 'Promotion not found.',
        ar: 'العرض الترويجي غير موجود.',
      })
    }

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name.trim()
    if (data.type !== undefined) updateData.type = data.type
    if (data.description !== undefined) updateData.description = data.description
    if (data.discountPercent !== undefined) updateData.discountPercent = data.discountPercent
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount
    if (data.minQuantity !== undefined) updateData.minQuantity = data.minQuantity
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId
    if (data.productId !== undefined) updateData.productId = data.productId
    if (data.startAt !== undefined) updateData.startAt = new Date(data.startAt as string)
    if (data.endAt !== undefined) updateData.endAt = new Date(data.endAt as string)
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    // Validate dates if both are being set or one is changing
    const effectiveStart = data.startAt ? new Date(data.startAt as string) : promotion.startAt
    const effectiveEnd = data.endAt ? new Date(data.endAt as string) : promotion.endAt
    if (effectiveEnd <= effectiveStart) {
      throw new BadRequestException({
        de: 'Das Enddatum muss nach dem Startdatum liegen.',
        en: 'The end date must be after the start date.',
        ar: 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
      })
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: updateData,
    })

    this.logger.log(`Promotion updated: ${updated.name} (${updated.id})`)
    return updated
  }

  async togglePromotion(id: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } })
    if (!promotion) {
      throw new NotFoundException({
        de: 'Aktion nicht gefunden.',
        en: 'Promotion not found.',
        ar: 'العرض الترويجي غير موجود.',
      })
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { isActive: !promotion.isActive },
    })

    this.logger.log(`Promotion toggled: ${updated.name} → ${updated.isActive ? 'active' : 'inactive'}`)
    return updated
  }

  async getActivePromotions() {
    const now = new Date()

    const promotions = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      include: {
        category: {
          select: { id: true, translations: { select: { language: true, name: true } } },
        },
        product: {
          select: {
            id: true,
            translations: { select: { language: true, name: true } },
          },
        },
      },
      orderBy: { endAt: 'asc' },
    })

    return promotions.map((p) => ({
      ...p,
      discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
      discountAmount: p.discountAmount ? Number(p.discountAmount) : null,
    }))
  }

  // ── Marketing Overview Stats ──────────────────────────────
  async getMarketingOverview() {
    const [totalCoupons, activeCoupons, usages, topCoupons] = await Promise.all([
      this.prisma.coupon.count(),
      this.prisma.coupon.count({ where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] } }),
      this.prisma.couponUsage.count(),
      this.prisma.couponUsage.groupBy({
        by: ['couponId'],
        _count: true,
        orderBy: { _count: { couponId: 'desc' } },
        take: 5,
      }),
    ])

    // Get coupon details + revenue for top 5
    const topCouponDetails = await Promise.all(
      topCoupons.map(async (tc) => {
        const coupon = await this.prisma.coupon.findUnique({
          where: { id: tc.couponId },
          select: { code: true, type: true, discountPercent: true, discountAmount: true },
        })
        const orders = await this.prisma.couponUsage.findMany({
          where: { couponId: tc.couponId },
          select: { order: { select: { totalAmount: true } } },
        })
        const totalRevenue = orders.reduce((s, u) => s + Number(u.order?.totalAmount ?? 0), 0)
        return {
          code: coupon?.code ?? '—',
          type: coupon?.type ?? 'percentage',
          discount: coupon?.type === 'percentage' ? `${Number(coupon.discountPercent)}%` : `€${Number(coupon?.discountAmount ?? 0).toFixed(2)}`,
          uses: tc._count,
          revenue: totalRevenue,
        }
      }),
    )

    // Total discount given (sum of discountAmount on orders that used a coupon)
    const discountSum = await this.prisma.order.aggregate({
      where: { couponCode: { not: null }, deletedAt: null, status: { notIn: ['cancelled'] } },
      _sum: { discountAmount: true },
    })

    return {
      totalCoupons,
      activeCoupons,
      totalRedemptions: usages,
      totalDiscountGiven: Number(discountSum._sum?.discountAmount ?? 0).toFixed(2),
      topCoupons: topCouponDetails,
    }
  }
}
