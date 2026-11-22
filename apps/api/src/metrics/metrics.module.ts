import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricRecordingService } from './metric-recording.service';
import { ClassroomMetricsController, StudentMetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/** Raw per-day activity signals: submissions now, classroom-channel participation later. */
@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [StudentMetricsController, ClassroomMetricsController],
  providers: [MetricRecordingService, MetricsService],
  // MetricsService is also consumed by the bot's daily review (composition via
  // services, rules/architecture.md), not only by this module's controllers.
  exports: [MetricRecordingService, MetricsService],
})
export class MetricsModule {}
