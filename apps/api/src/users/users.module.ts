import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeEventsModule } from '../platform/realtime/realtime-events.module';
import { AvatarAccessPort, FreeBaseAvatarAccess } from './avatar-access.port';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule, AccessModule, RealtimeEventsModule],
  controllers: [UsersController],
  providers: [UsersService, { provide: AvatarAccessPort, useClass: FreeBaseAvatarAccess }],
})
export class UsersModule {}
