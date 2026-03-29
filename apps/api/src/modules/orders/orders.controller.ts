import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, Request, UseGuards,
  HttpCode, HttpStatus, Headers,
} from '@nestjs/common'
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiHeader,
} from '@nestjs/swagger'
import { OrdersService } from './orders.service'
import { CreateOrderDto } from './dto/create-order.dto'
import { UpdateOrderStatusDto } from './dto/update-order-status.dto'
import { QueryOrdersDto } from './dto/query-orders.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { JwtOptionalGuard } from '../../common/guards/jwt-optional.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CorrelationId } from '../../common/decorators/correlation-id.decorator'

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ── Bestellung erstellen (Customer oder Gast) ─────────────────

  @Post()
  @UseGuards(JwtOptionalGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bestellung aufgeben' })
  @ApiHeader({ name: 'x-idempotency-key', description: 'UUID zur Duplikat-Prävention', required: false })
  @ApiHeader({ name: 'x-correlation-id', description: 'Tracing-ID', required: false })
  create(
    @Body() dto: CreateOrderDto,
    @Request() req: any,
    @CorrelationId() correlationId: string,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.ordersService.create(dto, req.user?.id ?? null, correlationId, idempotencyKey)
  }

  // ── Meine Bestellungen (paginiert, cursor-based) ──────────────

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eigene Bestellungen (cursor-paginiert)' })
  findMy(@Query() query: QueryOrdersDto, @Request() req: any) {
    return this.ordersService.findAll(query, req.user.id, false)
  }

  // ── Admin: alle Bestellungen ──────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Alle Bestellungen' })
  findAll(@Query() query: QueryOrdersDto) {
    return this.ordersService.findAll(query, undefined, true)
  }

  // ── Einzelne Bestellung ───────────────────────────────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bestelldetails abrufen' })
  findOne(@Param('id') id: string, @Request() req: any) {
    const isAdmin = ['admin', 'super_admin'].includes(req.user?.role)
    return this.ordersService.findOne(id, req.user?.id, isAdmin)
  }

  // ── Status ändern (Admin) ─────────────────────────────────────

  @Put(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin', 'warehouse_staff')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Admin] Bestellstatus aktualisieren' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Request() req: any,
    @CorrelationId() correlationId: string,
  ) {
    return this.ordersService.updateStatus(id, dto, 'admin', req.user.id, correlationId)
  }

  // ── Soft Delete (Admin) ───────────────────────────────────────

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Bestellung archivieren (Soft Delete)' })
  remove(@Param('id') id: string, @CorrelationId() correlationId: string) {
    return this.ordersService.softDelete(id, correlationId)
  }
}
