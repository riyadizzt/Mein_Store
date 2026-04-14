import { Module, forwardRef } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { UsersController } from './users.controller'
import { ProfileService } from './profile.service'
import { AddressService } from './address.service'
import { WishlistService } from './wishlist.service'
import { SessionService } from './session.service'
import { GdprService } from './gdpr.service'
import { GdprWorker } from './gdpr.worker'
import { UserOrdersService } from './user-orders.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { AdminModule } from '../admin/admin.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [PrismaModule, PassportModule, forwardRef(() => AdminModule), EmailModule],
  controllers: [UsersController],
  providers: [
    ProfileService,
    AddressService,
    WishlistService,
    SessionService,
    GdprService,
    GdprWorker,
    UserOrdersService,
  ],
  exports: [ProfileService, SessionService],
})
export class UsersModule {}
