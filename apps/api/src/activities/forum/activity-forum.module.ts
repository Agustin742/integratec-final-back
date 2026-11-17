import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityForumController } from './activity-forum.controller';
import { ActivityForumService } from './activity-forum.service';

/** Per-activity query threads (HU-COM-003); the teacher-reply notification is outbox-backed. */
@Module({
  imports: [AccessModule, NotificationsModule, PrismaModule],
  controllers: [ActivityForumController],
  providers: [ActivityForumService],
  exports: [ActivityForumService],
})
export class ActivityForumModule {}
