import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  CreateAddressDto,
  UpdateAddressDto,
  validatePostalCode,
} from './dto/address.dto'
import { AddressNotFoundException } from './exceptions/address-not-found.exception'
import { AddressLimitException } from './exceptions/address-limit.exception'
import { BadRequestException } from '@nestjs/common'

const MAX_ADDRESSES = 10

@Injectable()
export class AddressService {
  private readonly logger = new Logger(AddressService.name)

  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'asc' }],
    })
  }

  async findOne(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
    })
    if (!address) throw new AddressNotFoundException(addressId)
    return address
  }

  async create(userId: string, dto: CreateAddressDto) {
    // Count active addresses
    const count = await this.prisma.address.count({
      where: { userId, deletedAt: null },
    })
    if (count >= MAX_ADDRESSES) throw new AddressLimitException()

    // PLZ validation
    if (!validatePostalCode(dto.postalCode, dto.country)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidPostalCode',
        message: {
          de: `Die Postleitzahl "${dto.postalCode}" ist für ${dto.country} ungültig.`,
          en: `Postal code "${dto.postalCode}" is invalid for ${dto.country}.`,
          ar: `الرمز البريدي "${dto.postalCode}" غير صالح لـ ${dto.country}.`,
        },
      })
    }

    return this.prisma.$transaction(async (tx) => {
      // If setting as default shipping, clear existing default
      if (dto.isDefaultShipping) {
        await tx.address.updateMany({
          where: { userId, isDefaultShipping: true, deletedAt: null },
          data: { isDefaultShipping: false },
        })
      }
      // If setting as default billing, clear existing default
      if (dto.isDefaultBilling) {
        await tx.address.updateMany({
          where: { userId, isDefaultBilling: true, deletedAt: null },
          data: { isDefaultBilling: false },
        })
      }

      return tx.address.create({
        data: {
          userId,
          label: dto.label,
          firstName: dto.firstName,
          lastName: dto.lastName,
          company: dto.company,
          street: dto.street,
          houseNumber: dto.houseNumber,
          addressLine2: dto.addressLine2,
          city: dto.city,
          state: dto.state,
          postalCode: dto.postalCode,
          country: dto.country,
          isDefaultShipping: dto.isDefaultShipping ?? false,
          isDefaultBilling: dto.isDefaultBilling ?? false,
        },
      })
    })
  }

  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    await this.findOne(userId, addressId) // guard

    // PLZ validation if both country and postalCode provided
    const country = dto.country
    const postalCode = dto.postalCode
    if (country && postalCode && !validatePostalCode(postalCode, country)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'InvalidPostalCode',
        message: {
          de: `Die Postleitzahl "${postalCode}" ist für ${country} ungültig.`,
          en: `Postal code "${postalCode}" is invalid for ${country}.`,
          ar: `الرمز البريدي "${postalCode}" غير صالح لـ ${country}.`,
        },
      })
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefaultShipping) {
        await tx.address.updateMany({
          where: { userId, isDefaultShipping: true, deletedAt: null, id: { not: addressId } },
          data: { isDefaultShipping: false },
        })
      }
      if (dto.isDefaultBilling) {
        await tx.address.updateMany({
          where: { userId, isDefaultBilling: true, deletedAt: null, id: { not: addressId } },
          data: { isDefaultBilling: false },
        })
      }

      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.company !== undefined && { company: dto.company }),
          ...(dto.street !== undefined && { street: dto.street }),
          ...(dto.houseNumber !== undefined && { houseNumber: dto.houseNumber }),
          ...(dto.addressLine2 !== undefined && { addressLine2: dto.addressLine2 }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.state !== undefined && { state: dto.state }),
          ...(dto.postalCode !== undefined && { postalCode: dto.postalCode }),
          ...(dto.country !== undefined && { country: dto.country }),
          ...(dto.isDefaultShipping !== undefined && { isDefaultShipping: dto.isDefaultShipping }),
          ...(dto.isDefaultBilling !== undefined && { isDefaultBilling: dto.isDefaultBilling }),
        },
      })
    })
  }

  async softDelete(userId: string, addressId: string): Promise<void> {
    await this.findOne(userId, addressId) // guard

    // Unlink address from active orders (order keeps inline address snapshot)
    // No longer block deletion — address data is already snapshotted on the order

    await this.prisma.address.update({
      where: { id: addressId },
      data: { deletedAt: new Date(), isDefaultShipping: false, isDefaultBilling: false },
    })

    this.logger.log(`Address ${addressId} soft-deleted by user ${userId}`)
  }
}
