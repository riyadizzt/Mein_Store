import { BadRequestException } from '@nestjs/common'

export class PaymentFailedException extends BadRequestException {
  constructor(reason: string) {
    super({
      statusCode: 400,
      error: 'PaymentFailed',
      message: {
        de: `Zahlung fehlgeschlagen: ${reason}`,
        en: `Payment failed: ${reason}`,
        ar: `فشل الدفع: ${reason}`,
      },
    })
  }
}
