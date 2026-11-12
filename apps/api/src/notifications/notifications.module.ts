import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationRecorder } from './notification-recorder.service';
import { NotificationRequestedHandler } from './notification-requested.handler';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/** Durable producer API and session-protected notification center. */
@Module({
  imports: [PrismaModule, AccessModule, OutboxModule],
  controllers: [NotificationsController],
  providers: [NotificationRecorder, NotificationRequestedHandler, NotificationsService],
  exports: [NotificationRecorder, NotificationsService],
})
export class NotificationsModule {}
