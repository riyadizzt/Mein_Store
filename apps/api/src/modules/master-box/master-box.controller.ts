import { Controller, Get, Post, Delete, Patch, Param, Body, Query, Req, Ip, UseGuards, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { MasterBoxService } from './master-box.service'

@Controller('admin/master-boxes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class MasterBoxController {
  constructor(private readonly service: MasterBoxService) {}

  @Get()
  list(
    @Query('season') season?: string,
    @Query('year') year?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll({
      season,
      year: year ? +year : undefined,
      warehouseId,
      status,
    })
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: { name: string; season: string; year: number; warehouseId: string; notes?: string },
    @Req() req: any,
  ) {
    return this.service.create({ ...body, adminId: req.user.id })
  }

  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  scan(@Param('id', ParseUUIDPipe) id: string, @Body('sku') sku: string) {
    return this.service.scanIntoBox(id, sku)
  }

  @Patch(':id/items/:itemId')
  updateItemQuantity(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body('quantity') quantity: number,
  ) {
    return this.service.updateItemQuantity(id, itemId, quantity)
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.service.removeItem(id, itemId)
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: 'packing' | 'sealed' | 'opened',
  ) {
    return this.service.updateStatus(id, status)
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('targetWarehouseId') targetWarehouseId: string,
    @Req() req: any,
    @Ip() ip: string,
  ) {
    return this.service.transferBox(id, targetWarehouseId, req.user.id, ip)
  }

  @Delete(':id')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id)
  }
}
