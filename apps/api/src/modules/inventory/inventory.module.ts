import { Module } from '@nestjs/common'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { ReservationService } from './reservation.service'
import { InventoryScheduler } from './inventory.scheduler'

// QueueModule ist @Global() — 'INVENTORY_SYNC_QUEUE' ist automatisch verfügbar

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, ReservationService, InventoryScheduler],
  exports: [InventoryService, ReservationService],
})
export class InventoryModule {}
