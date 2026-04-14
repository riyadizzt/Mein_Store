import { Module } from '@nestjs/common'
import { ContactController } from './contact.controller'
import { ContactService } from './contact.service'
import { EmailModule } from '../email/email.module'
import { AdminModule } from '../admin/admin.module'

@Module({
  imports: [EmailModule, AdminModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
