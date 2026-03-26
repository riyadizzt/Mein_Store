import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  ShippingCalculator,
  ShippingInput,
  ShippingResult,
} from './shipping-calculator.interface'

@Injectable()
export class ZoneBasedCalculator implements ShippingCalculator {
  private readonly logger = new Logger(ZoneBasedCalculator.name)

  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: ShippingInput): Promise<ShippingResult> {
    const { countryCode, weightGrams, subtotal } = input

    // Passende Zone für dieses Land finden
    const zone = await this.prisma.shippingZone.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        countryCodes: { has: countryCode },
      },
    })

    if (!zone) {
      // Fallback: International-Zone (falls DE-Zone vorhanden, nie null)
      const fallback = await this.prisma.shippingZone.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { basePrice: 'desc' },
      })

      if (!fallback) {
        throw new NotFoundException(
          `Keine Versandzone für Land "${countryCode}" gefunden`,
        )
      }

      this.logger.warn(
        `Keine Zone für "${countryCode}" — Fallback auf "${fallback.zoneName}"`,
      )

      return this.computeCost(
        Number(fallback.basePrice),
        fallback.freeShippingThreshold ? Number(fallback.freeShippingThreshold) : null,
        fallback.weightSurchargePerKg ? Number(fallback.weightSurchargePerKg) : null,
        subtotal,
        weightGrams,
        fallback.zoneName,
      )
    }

    return this.computeCost(
      Number(zone.basePrice),
      zone.freeShippingThreshold ? Number(zone.freeShippingThreshold) : null,
      zone.weightSurchargePerKg ? Number(zone.weightSurchargePerKg) : null,
      subtotal,
      weightGrams,
      zone.zoneName,
    )
  }

  private computeCost(
    basePrice: number,
    freeThreshold: number | null,
    surchargePerKg: number | null,
    subtotal: number,
    weightGrams: number,
    zoneName: string,
  ): ShippingResult {
    // Gratisversand prüfen
    if (freeThreshold !== null && subtotal >= freeThreshold) {
      return { cost: 0, zoneName, isFreeShipping: true, carrier: 'zone_based' }
    }

    let cost = basePrice

    // Gewichtszuschlag (wenn definiert)
    if (surchargePerKg !== null && weightGrams > 0) {
      const weightKg = weightGrams / 1000
      cost += surchargePerKg * weightKg
    }

    // Auf 2 Dezimalstellen runden
    cost = Math.round(cost * 100) / 100

    return { cost, zoneName, isFreeShipping: false, carrier: 'zone_based' }
  }
}
