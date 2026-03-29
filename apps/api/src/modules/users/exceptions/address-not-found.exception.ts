import { NotFoundException } from '@nestjs/common'

export class AddressNotFoundException extends NotFoundException {
  constructor(id: string) {
    super({
      statusCode: 404,
      error: 'AddressNotFound',
      message: {
        de: `Adresse ${id} wurde nicht gefunden.`,
        en: `Address ${id} was not found.`,
        ar: `العنوان ${id} غير موجود.`,
      },
    })
  }
}
