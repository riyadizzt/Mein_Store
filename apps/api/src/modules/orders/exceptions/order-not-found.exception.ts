import { NotFoundException } from '@nestjs/common'

export class OrderNotFoundException extends NotFoundException {
  constructor(identifier: string) {
    super({
      statusCode: 404,
      error: 'OrderNotFound',
      message: {
        de: `Bestellung "${identifier}" nicht gefunden`,
        en: `Order "${identifier}" not found`,
        ar: `الطلب "${identifier}" غير موجود`,
      },
    })
  }
}
