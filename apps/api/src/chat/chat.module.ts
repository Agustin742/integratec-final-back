import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MetricsModule } from '../metrics/metrics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeEventsModule } from '../platform/realtime/realtime-events.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [PrismaModule, AccessModule, NotificationsModule, MetricsModule, RealtimeEventsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
