import {
  Controller, Get, Post, Put, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ShippingZonesService } from './shipping-zones.service'
import { CreateShippingZoneDto } from './dto/create-shipping-zone.dto'
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'

@ApiTags('Admin / Shipping Zones')
@Controller('admin/shipping-zones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ShippingZonesController {
  constructor(private readonly shippingZonesService: ShippingZonesService) {}

  @Get()
  @ApiOperation({ summary: 'Alle Versandzonen' })
  findAll() {
    return this.shippingZonesService.findAll()
  }

  @Post()
  @ApiOperation({ summary: 'Neue Versandzone anlegen' })
  create(@Body() dto: CreateShippingZoneDto) {
    return this.shippingZonesService.create(dto)
  }

  @Put(':id')
  @ApiOperation({ summary: 'Versandzone aktualisieren (Preise, Länder)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateShippingZoneDto>) {
    return this.shippingZonesService.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Versandzone deaktivieren (Soft Delete)' })
  remove(@Param('id') id: string) {
    return this.shippingZonesService.remove(id)
  }
}
