import { NotFoundException } from '@nestjs/common'

export class UserNotFoundException extends NotFoundException {
  constructor(id: string) {
    super({
      statusCode: 404,
      error: 'UserNotFound',
      message: {
        de: `Benutzer ${id} wurde nicht gefunden.`,
        en: `User ${id} was not found.`,
        ar: `المستخدم ${id} غير موجود.`,
      },
    })
  }
}
