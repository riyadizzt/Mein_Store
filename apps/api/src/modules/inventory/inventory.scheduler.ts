import { Injectable, Logger } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'
import { SafeCron } from '../../common/decorators/safe-cron.decorator'
import { ReservationService } from './reservation.service'

@Injectable()
export class InventoryScheduler {
  private readonly logger = new Logger(InventoryScheduler.name)

  constructor(private readonly reservationService: ReservationService) {}

  // Jede Minute: abgelaufene Reservierungen freigeben
  @SafeCron(CronExpression.EVERY_MINUTE)
  async releaseExpiredReservations() {
    try {
      const count = await this.reservationService.releaseExpired()
      if (count > 0) {
        this.logger.log(`Expired reservations released: ${count}`)
      }
    } catch (err) {
      this.logger.error('Fehler beim automatischen Freigeben von Reservierungen', err)
    }
  }
}
