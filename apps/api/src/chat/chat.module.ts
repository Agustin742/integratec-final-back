import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MetricsModule } from '../metrics/metrics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeEventsModule } from '../platform/realtime/realtime-events.module';
import { ChatController } from './chat.controller';
import { ChatInboxController } from './chat-inbox.controller';
import { ChatInboxService } from './chat-inbox.service';
import { ChatService } from './chat.service';

@Module({
  imports: [
    PrismaModule,
    AccessModule,
    NotificationsModule,
    MetricsModule,
    RealtimeEventsModule,
    OutboxModule,
  ],
  controllers: [ChatController, ChatInboxController],
  providers: [ChatService, ChatInboxService],
})
export class ChatModule {}
