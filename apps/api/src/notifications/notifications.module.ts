import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationRecorder } from './notification-recorder.service';
import { NotificationRequestedHandler } from './notification-requested.handler';
import { NotificationsService } from './notifications.service';

/** Import-ready; root REST integration is a separate work unit. */
@Module({
  imports: [PrismaModule, AccessModule, OutboxModule],
  providers: [NotificationRecorder, NotificationRequestedHandler, NotificationsService],
  exports: [NotificationRecorder, NotificationsService],
})
export class NotificationsModule {}
