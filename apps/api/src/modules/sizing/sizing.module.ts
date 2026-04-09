import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { SizingController } from './sizing.controller'
import { SizingService } from './sizing.service'

@Module({
  imports: [PrismaModule],
  controllers: [SizingController],
  providers: [SizingService],
  exports: [SizingService],
})
export class SizingModule {}
