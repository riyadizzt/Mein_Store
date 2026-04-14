import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AiModule } from '../ai/ai.module'
import { WhatsappController } from './whatsapp.controller'
import { WhatsappService } from './whatsapp.service'

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
