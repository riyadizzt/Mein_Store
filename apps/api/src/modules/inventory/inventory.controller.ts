import {
  Controller, Get, Post, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus, Request,
} from '@nestjs/common'
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiParam, ApiQuery,
} from '@nestjs/swagger'
import { InventoryService } from './inventory.service'
import { ReservationService } from './reservation.service'
import { AdjustInventoryDto } from './dto/adjust-inventory.dto'
import { TransferInventoryDto } from './dto/transfer-inventory.dto'
import { ReserveStockDto } from './dto/reserve-stock.dto'
import { QueryHistoryDto } from './dto/query-history.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly reservationService: ReservationService,
  ) {}

  // ── Public ──────────────────────────────────────────────────

  @Get('sku/:sku/availability')
  @ApiOperation({ summary: 'Verfügbarkeit einer SKU (public)' })
  @ApiParam({ name: 'sku', example: 'JACK-BLK-L' })
  getAvailability(@Param('sku') sku: string) {
    return this.inventoryService.getAvailabilityBySku(sku)
  }

  // ── Admin: Lagerübersicht ────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Gesamtübersicht aller Bestände' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getOverview(
    @Query('warehouseId') warehouseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.getOverview(
      warehouseId,
      page ? Number(page) : 1,
      limit ? Math.min(Number(limit), 100) : 50,
    )
  }

  @Get('variant/:variantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Bestand einer Variante nach Lagerort' })
  getByVariant(@Param('variantId') variantId: string) {
    return this.inventoryService.getStockByVariantId(variantId)
  }

  @Get('variant/:variantId/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Bewegungshistorie einer Variante' })
  getHistory(@Param('variantId') variantId: string, @Query() query: QueryHistoryDto) {
    return this.inventoryService.getHistory(variantId, query)
  }

  // ── Admin: Korrekturen & Transfers ───────────────────────────

  @Post('adjust')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Bestand manuell korrigieren (Pflicht-Begründung)' })
  adjust(@Body() dto: AdjustInventoryDto, @Request() req: any) {
    return this.inventoryService.adjust(dto, req.user.id)
  }

  @Post('transfer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Bestand zwischen Lagerorten transferieren' })
  transfer(@Body() dto: TransferInventoryDto, @Request() req: any) {
    return this.inventoryService.transfer(dto, req.user.id)
  }

  // ── Internal: Reservierungssystem ────────────────────────────

  @Post('reserve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Checkout] Bestand reservieren (15 Min.)' })
  reserve(@Body() dto: ReserveStockDto) {
    return this.reservationService.reserve(dto)
  }

  @Post('reservations/:id/release')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Checkout] Reservierung manuell freigeben (Abbruch)' })
  release(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.reservationService.release(id, reason)
  }

  @Post('reservations/:id/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Order] Reservierung bestätigen → Bestand abziehen (SOLD)' })
  confirm(@Param('id') id: string, @Body('orderId') orderId: string) {
    return this.reservationService.confirm(id, orderId)
  }
}
