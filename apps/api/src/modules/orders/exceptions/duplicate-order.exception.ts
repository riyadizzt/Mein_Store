import { ConflictException } from '@nestjs/common'

export class DuplicateOrderException extends ConflictException {
  constructor(idempotencyKey: string) {
    super({
      statusCode: 409,
      error: 'DuplicateOrder',
      message: {
        de: `Diese Bestellung wurde bereits verarbeitet (Idempotency-Key: ${idempotencyKey})`,
        en: `This order has already been processed (Idempotency-Key: ${idempotencyKey})`,
        ar: `تمت معالجة هذا الطلب مسبقًا (مفتاح الأمان: ${idempotencyKey})`,
      },
      idempotencyKey,
    })
  }
}
