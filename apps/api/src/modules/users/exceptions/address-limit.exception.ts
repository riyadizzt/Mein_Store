import { BadRequestException } from '@nestjs/common'

export class AddressLimitException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      error: 'AddressLimitReached',
      message: {
        de: 'Maximal 10 Adressen pro Konto erlaubt.',
        en: 'Maximum 10 addresses per account allowed.',
        ar: 'الحد الأقصى 10 عناوين لكل حساب.',
      },
    })
  }
}
