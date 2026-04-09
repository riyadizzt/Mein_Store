import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe, Req,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { ReviewsService } from './reviews.service'

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // ── PUBLIC: Get reviews for product ───────────────────────
  @Get('products/:productId')
  async getProductReviews(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: { limit?: string; offset?: string },
  ) {
    return this.reviewsService.findByProduct(productId, {
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    })
  }

  // ── CUSTOMER: Create review ───────────────────────────────
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createReview(@Req() req: any, @Body() body: {
    productId: string; rating: number; title?: string; body?: string; language?: string
  }) {
    return this.reviewsService.create(req.user.id, body)
  }

  // ── CUSTOMER: Delete own review ───────────────────────────
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReview(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.reviewsService.deleteOwn(req.user.id, id)
  }

  // ── ADMIN: Pending reviews ────────────────────────────────
  @Get('admin/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getPending() {
    return this.reviewsService.findPending()
  }

  // ── ADMIN: Approve review ─────────────────────────────────
  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.reviewsService.approve(id, req.user.id)
  }

  // ── ADMIN: Reject review ──────────────────────────────────
  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Body() body: { reason?: string }) {
    return this.reviewsService.reject(id, req.user.id, body.reason)
  }
}
