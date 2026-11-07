import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AvatarAccessPort, FreeBaseAvatarAccess } from './avatar-access.port';
import { OwnSessionGuard } from './own-session.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    OwnSessionGuard,
    { provide: AvatarAccessPort, useClass: FreeBaseAvatarAccess },
  ],
})
export class UsersModule {}
