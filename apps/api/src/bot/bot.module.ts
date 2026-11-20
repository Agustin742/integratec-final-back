import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { GradesModule } from '../grades/grades.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BotMaterialsController } from './bot-materials.controller';
import { BotMaterialsService } from './bot-materials.service';
import { BedrockInferenceAdapter } from './bedrock-inference.adapter';
import { DailyReviewController } from './daily-review.controller';
import { DailyReviewService } from './daily-review.service';
import { DAILY_REVIEW_INFERENCE_PORT } from './daily-review-inference.port';
import { InProcessMaterialIndexAdapter } from './in-process-material-index.adapter';
import { MATERIAL_INDEX_PORT } from './material-index.port';

@Module({
  imports: [
    AccessModule,
    ActivitiesModule,
    AnnouncementsModule,
    GradesModule,
    MetricsModule,
    PrismaModule,
  ],
  controllers: [BotMaterialsController, DailyReviewController],
  providers: [
    BotMaterialsService,
    DailyReviewService,
    // Default adapters: in-process index until the retrieval decision (HU-BOT-002),
    // Bedrock for the daily-review summary. Tests override both ports with fakes.
    { provide: MATERIAL_INDEX_PORT, useClass: InProcessMaterialIndexAdapter },
    { provide: DAILY_REVIEW_INFERENCE_PORT, useClass: BedrockInferenceAdapter },
  ],
  // Consumed by MaterialsModule to exclude soft-removed materials from the bot.
  exports: [BotMaterialsService],
})
export class BotModule {}
