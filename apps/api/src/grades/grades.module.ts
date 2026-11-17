import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PointsModule } from '../points/points.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassroomSubmissionsController, SubmissionGradesController } from './grades.controller';
import { GradesService } from './grades.service';

/** Server-owned submission grading, revision history, weighted points, and staff review queue. */
@Module({
  imports: [PrismaModule, AccessModule, PointsModule, NotificationsModule, GamificationModule],
  controllers: [SubmissionGradesController, ClassroomSubmissionsController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
