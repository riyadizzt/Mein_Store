import { Module, forwardRef } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AdminModule } from '../admin/admin.module'
import { MasterBoxController } from './master-box.controller'
import { MasterBoxService } from './master-box.service'

@Module({
  imports: [PrismaModule, forwardRef(() => AdminModule)],
  controllers: [MasterBoxController],
  providers: [MasterBoxService],
  exports: [MasterBoxService],
})
export class MasterBoxModule {}
