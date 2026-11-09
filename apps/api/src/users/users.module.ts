import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AvatarAccessPort, FreeBaseAvatarAccess } from './avatar-access.port';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, { provide: AvatarAccessPort, useClass: FreeBaseAvatarAccess }],
})
export class UsersModule {}
