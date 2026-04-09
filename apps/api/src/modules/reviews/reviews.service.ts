import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── PUBLIC: Get reviews for a product ─────────────────────

  async findByProduct(productId: string, query?: { limit?: number; offset?: number }) {
    const limit = query?.limit ?? 20
    const offset = query?.offset ?? 0

    const where = { productId, status: 'approved' as const, deletedAt: null }

    const [reviews, total, stats] = await Promise.all([
      this.prisma.productReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.aggregate({
        where,
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ])

    // Rating distribution
    const distribution = await this.prisma.productReview.groupBy({
      by: ['rating'],
      where,
      _count: true,
    })

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const d of distribution) {
      ratingDistribution[d.rating] = d._count
    }

    return {
      reviews: reviews.map(r => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        language: r.language,
        authorName: r.user ? `${r.user.firstName} ${r.user.lastName?.charAt(0) ?? ''}.` : null,
        createdAt: r.createdAt,
      })),
      meta: { total, limit, offset },
      stats: {
        averageRating: Math.round((stats._avg.rating ?? 0) * 10) / 10,
        totalReviews: stats._count.rating,
        distribution: ratingDistribution,
      },
    }
  }

  // ── CUSTOMER: Create review ───────────────────────────────

  async create(userId: string, data: { productId: string; rating: number; title?: string; body?: string; language?: string }) {
    if (data.rating < 1 || data.rating > 5) throw new BadRequestException('Rating must be 1-5')

    // Check if user already reviewed this product
    const existing = await this.prisma.productReview.findFirst({
      where: { productId: data.productId, userId, deletedAt: null },
    })
    if (existing) throw new BadRequestException('You have already reviewed this product')

    // Check if user purchased this product
    const purchased = await this.prisma.orderItem.findFirst({
      where: {
        order: { userId, status: { in: ['confirmed', 'processing', 'shipped', 'delivered'] } },
        variant: { productId: data.productId },
      },
    })

    return this.prisma.productReview.create({
      data: {
        productId: data.productId,
        userId,
        rating: data.rating,
        title: data.title,
        body: data.body,
        language: (data.language ?? 'de') as any,
        status: purchased ? 'approved' : 'pending', // Auto-approve if purchased
        orderItemId: purchased?.id,
      },
    })
  }

  // ── CUSTOMER: Delete own review ───────────────────────────

  async deleteOwn(userId: string, reviewId: string) {
    const review = await this.prisma.productReview.findUnique({ where: { id: reviewId } })
    if (!review) throw new NotFoundException('Review not found')
    if (review.userId !== userId) throw new ForbiddenException('Not your review')

    await this.prisma.productReview.update({
      where: { id: reviewId },
      data: { deletedAt: new Date() },
    })
  }

  // ── ADMIN: Moderate reviews ───────────────────────────────

  async findPending() {
    return this.prisma.productReview.findMany({
      where: { status: 'pending', deletedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        product: { include: { translations: { take: 1 } } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async approve(reviewId: string, adminId: string) {
    return this.prisma.productReview.update({
      where: { id: reviewId },
      data: { status: 'approved', moderatedBy: adminId, moderatedAt: new Date() },
    })
  }

  async reject(reviewId: string, adminId: string, reason?: string) {
    return this.prisma.productReview.update({
      where: { id: reviewId },
      data: {
        status: 'rejected',
        rejectionReason: reason as any ?? 'inappropriate',
        moderatedBy: adminId,
        moderatedAt: new Date(),
      },
    })
  }
}
