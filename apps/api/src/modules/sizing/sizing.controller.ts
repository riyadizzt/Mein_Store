import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, ParseUUIDPipe, Req,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
// JwtOptionalGuard available if needed for guest sizing
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { SizingService } from './sizing.service'
import {
  CreateSizeChartDto, UpdateSizeChartDto,
  SizeChartEntryDto, BulkUpsertEntriesDto,
} from './dto/size-chart.dto'

@Controller('sizing')
export class SizingController {
  constructor(private readonly sizingService: SizingService) {}

  // ── PUBLIC: Size chart for a product ──────────────────────

  @Get('products/:productId/chart')
  async getChartForProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.sizingService.findChartForProduct(productId)
  }

  @Post('products/:productId/recommend')
  @HttpCode(HttpStatus.OK)
  async getRecommendation(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: {
      heightCm?: number; weightKg?: number; bustCm?: number
      waistCm?: number; hipCm?: number; footLengthCm?: number
    },
  ) {
    return this.sizingService.getRecommendation(productId, body)
  }

  // ── CUSTOMER: My measurements ─────────────────────────────

  @Get('me/measurements')
  @UseGuards(JwtAuthGuard)
  async getMyMeasurements(@Req() req: any) {
    return this.sizingService.getCustomerMeasurements(req.user.id)
  }

  @Patch('me/measurements')
  @UseGuards(JwtAuthGuard)
  async saveMyMeasurements(@Req() req: any, @Body() body: any) {
    return this.sizingService.saveCustomerMeasurements(req.user.id, body)
  }

  // ── ADMIN: Size charts CRUD ───────────────────────────────

  @Get('charts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getAllCharts(@Query() query: { supplierId?: string; categoryId?: string; chartType?: string }) {
    return this.sizingService.findAllCharts(query)
  }

  @Get('charts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async getChart(@Param('id', ParseUUIDPipe) id: string) {
    return this.sizingService.findChartById(id)
  }

  @Post('charts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.CREATED)
  async createChart(@Body() body: CreateSizeChartDto) {
    return this.sizingService.createChart(body)
  }

  @Patch('charts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async updateChart(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSizeChartDto) {
    return this.sizingService.updateChart(id, body)
  }

  // Preview which chart a product would resolve to if its category
  // were changed to the target categoryId. Lets the admin UI warn
  // the user before saving that the customer will see a different
  // size chart. See frontend product-edit page.
  @Get('admin/chart-preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async chartPreviewForCategory(
    @Query('productId', ParseUUIDPipe) productId: string,
    @Query('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.sizingService.previewChartForCategory(productId, categoryId)
  }

  // Admin sizing page surfaces a warning badge on every category that
  // has more than one non-default chart (non-deterministic tier-3
  // fallback). This endpoint enumerates them once so the UI can
  // render the flag without N queries.
  @Get('admin/categories-with-conflicts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async categoriesWithConflicts() {
    return this.sizingService.listCategoriesWithChartConflicts()
  }

  @Delete('charts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteChart(@Param('id', ParseUUIDPipe) id: string) {
    await this.sizingService.deleteChart(id)
  }

  // ── ADMIN: Chart entries ──────────────────────────────────

  @Post('charts/:chartId/entries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async addEntry(@Param('chartId', ParseUUIDPipe) chartId: string, @Body() body: SizeChartEntryDto) {
    return this.sizingService.addEntry(chartId, body)
  }

  @Post('charts/:chartId/entries/bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async bulkUpsertEntries(@Param('chartId', ParseUUIDPipe) chartId: string, @Body() body: BulkUpsertEntriesDto) {
    await this.sizingService.bulkUpsertEntries(chartId, body.entries)
    return { success: true }
  }

  @Patch('entries/:entryId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  async updateEntry(@Param('entryId', ParseUUIDPipe) entryId: string, @Body() body: SizeChartEntryDto) {
    return this.sizingService.updateEntry(entryId, body)
  }

  @Delete('entries/:entryId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEntry(@Param('entryId', ParseUUIDPipe) entryId: string) {
    await this.sizingService.deleteEntry(entryId)
  }
}
