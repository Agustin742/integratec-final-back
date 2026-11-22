import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { GamificationModule } from '../gamification/gamification.module';
import { GradesModule } from '../grades/grades.module';
import { MetricsModule } from '../metrics/metrics.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CHAT_MODEL_PORT, EMBEDDING_MODEL_PORT } from './ai-provider.ports';
import { AnswerKeyGuardService } from './answer-key-guard.service';
import { BotAskController } from './bot-ask.controller';
import { BotAskService } from './bot-ask.service';
import { BotMaterialsController } from './bot-materials.controller';
import { BotMaterialsService } from './bot-materials.service';
import { AiDailyReviewInferenceAdapter } from './ai-daily-review-inference.adapter';
import { BotRateLimiterService } from './bot-rate-limiter.service';
import { DailyReviewController } from './daily-review.controller';
import { DailyReviewService } from './daily-review.service';
import { DAILY_REVIEW_INFERENCE_PORT } from './daily-review-inference.port';
import { MATERIAL_INDEX_PORT } from './material-index.port';
import { MATERIAL_RETRIEVAL_PORT } from './material-retrieval.port';
import { OpenAiCompatibleAiAdapter } from './openai-compatible-ai.adapter';
import { PgVectorMaterialIndexAdapter } from './pgvector-material-index.adapter';
import { TextExtractorService } from './text-extractor.service';

@Module({
  imports: [
    AccessModule,
    ActivitiesModule,
    AnnouncementsModule,
    GamificationModule,
    GradesModule,
    MetricsModule,
    PrismaModule,
    StorageModule,
  ],
  controllers: [BotMaterialsController, BotAskController, DailyReviewController],
  providers: [
    BotMaterialsService,
    BotAskService,
    BotRateLimiterService,
    AnswerKeyGuardService,
    TextExtractorService,
    DailyReviewService,
    AiDailyReviewInferenceAdapter,
    OpenAiCompatibleAiAdapter,
    PgVectorMaterialIndexAdapter,
    { provide: CHAT_MODEL_PORT, useExisting: OpenAiCompatibleAiAdapter },
    { provide: EMBEDDING_MODEL_PORT, useExisting: OpenAiCompatibleAiAdapter },
    { provide: MATERIAL_INDEX_PORT, useExisting: PgVectorMaterialIndexAdapter },
    { provide: MATERIAL_RETRIEVAL_PORT, useExisting: PgVectorMaterialIndexAdapter },
    { provide: DAILY_REVIEW_INFERENCE_PORT, useExisting: AiDailyReviewInferenceAdapter },
  ],
  // Consumed by MaterialsModule to exclude soft-removed materials from the bot.
  exports: [BotMaterialsService],
})
export class BotModule {}
