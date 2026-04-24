import { Module } from '@nestjs/common'
import { CategoriesController } from './categories.controller'
import { CategoriesService } from './categories.service'
import { AdminModule } from '../admin/admin.module'

@Module({
  // AdminModule exports AuditService. Verified (2026-04-24): AdminModule
  // does NOT import CategoriesModule → no circular-dep risk.
  imports: [AdminModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
