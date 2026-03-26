import { BadRequestException } from '@nestjs/common'

export class InvalidOrderStateException extends BadRequestException {
  constructor(currentStatus: string, targetStatus: string) {
    super({
      statusCode: 400,
      error: 'InvalidOrderState',
      message: {
        de: `Statuswechsel von "${currentStatus}" zu "${targetStatus}" ist nicht erlaubt`,
        en: `Transition from "${currentStatus}" to "${targetStatus}" is not allowed`,
        ar: `لا يُسمح بالانتقال من "${currentStatus}" إلى "${targetStatus}"`,
      },
      currentStatus,
      targetStatus,
    })
  }
}
