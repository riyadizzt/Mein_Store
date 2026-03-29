import { UnauthorizedException } from '@nestjs/common'

export class InvalidPasswordException extends UnauthorizedException {
  constructor() {
    super({
      statusCode: 401,
      error: 'InvalidPassword',
      message: {
        de: 'Das eingegebene Passwort ist falsch.',
        en: 'The provided password is incorrect.',
        ar: 'كلمة المرور المدخلة غير صحيحة.',
      },
    })
  }
}
