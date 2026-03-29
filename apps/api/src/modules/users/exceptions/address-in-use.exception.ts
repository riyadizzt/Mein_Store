import { ConflictException } from '@nestjs/common'

export class AddressInUseException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'AddressInUse',
      message: {
        de: 'Diese Adresse wird von einer aktiven Bestellung verwendet und kann nicht gelöscht werden.',
        en: 'This address is used by an active order and cannot be deleted.',
        ar: 'هذا العنوان مستخدم في طلب نشط ولا يمكن حذفه.',
      },
    })
  }
}
