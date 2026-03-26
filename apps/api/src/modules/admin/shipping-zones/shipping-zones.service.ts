import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { CreateShippingZoneDto } from './dto/create-shipping-zone.dto'

@Injectable()
export class ShippingZonesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.shippingZone.findMany({
      where: { deletedAt: null },
      orderBy: { basePrice: 'asc' },
    })
  }

  async create(dto: CreateShippingZoneDto) {
    return this.prisma.shippingZone.create({
      data: {
        zoneName: dto.zoneName,
        countryCodes: dto.countryCodes,
        basePrice: dto.basePrice,
        freeShippingThreshold: dto.freeShippingThreshold,
        weightSurchargePerKg: dto.weightSurchargePerKg,
        isActive: dto.isActive ?? true,
      },
    })
  }

  async update(id: string, dto: Partial<CreateShippingZoneDto>) {
    await this.findOneOrFail(id)
    return this.prisma.shippingZone.update({
      where: { id },
      data: {
        zoneName: dto.zoneName,
        countryCodes: dto.countryCodes,
        basePrice: dto.basePrice,
        freeShippingThreshold: dto.freeShippingThreshold,
        weightSurchargePerKg: dto.weightSurchargePerKg,
        isActive: dto.isActive,
      },
    })
  }

  async remove(id: string) {
    await this.findOneOrFail(id)
    return this.prisma.shippingZone.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    })
  }

  private async findOneOrFail(id: string) {
    const zone = await this.prisma.shippingZone.findFirst({
      where: { id, deletedAt: null },
    })
    if (!zone) throw new NotFoundException(`Versandzone "${id}" nicht gefunden`)
    return zone
  }
}
