import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { FeedsService } from './feeds.service'
import { FeedsController } from './feeds.controller'

@Module({
  imports: [PrismaModule],
  controllers: [FeedsController],
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
