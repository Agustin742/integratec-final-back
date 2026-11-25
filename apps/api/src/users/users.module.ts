import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeEventsModule } from '../platform/realtime/realtime-events.module';
import { AvatarAccessPort } from './avatar-access.port';
import { AvatarStylesService } from './avatar-styles.service';
import { ShopAvatarAccess } from './shop-avatar-access';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule, AccessModule, RealtimeEventsModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    AvatarStylesService,
    { provide: AvatarAccessPort, useClass: ShopAvatarAccess },
  ],
})
export class UsersModule {}
