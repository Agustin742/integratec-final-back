import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../platform/email/email.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { NotificationEmailHandler } from './notification-email.handler';
import { NotificationEmailService } from './notification-email.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** Classroom bulletin board: announcement CRUD, mentions and post-commit notifications. */
@Module({
  imports: [PrismaModule, AccessModule, NotificationsModule, EmailModule, OutboxModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, NotificationEmailService, NotificationEmailHandler],
})
export class AnnouncementsModule {}
