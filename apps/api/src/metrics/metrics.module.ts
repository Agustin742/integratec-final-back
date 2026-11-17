import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricRecordingService } from './metric-recording.service';

/** Raw per-day activity signals: submissions now, classroom-channel participation later. */
@Module({
  imports: [PrismaModule],
  providers: [MetricRecordingService],
  exports: [MetricRecordingService],
})
export class MetricsModule {}
