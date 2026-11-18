import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [PrismaModule, AccessModule, NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
