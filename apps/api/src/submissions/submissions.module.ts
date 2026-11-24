import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { GamificationModule } from '../gamification/gamification.module';
import { MetricsModule } from '../metrics/metrics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { PointsModule } from '../points/points.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SubmissionOnTimeHandler } from './submission-on-time.handler';
import { SubmissionReadController, SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [
    AccessModule,
    GamificationModule,
    MetricsModule,
    NotificationsModule,
    OutboxModule,
    PointsModule,
    PrismaModule,
    StorageModule,
  ],
  controllers: [SubmissionsController, SubmissionReadController],
  providers: [SubmissionsService, SubmissionOnTimeHandler],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
