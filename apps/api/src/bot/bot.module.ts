import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CHAT_MODEL_PORT, EMBEDDING_MODEL_PORT } from './ai-provider.ports';
import { AnswerKeyGuardService } from './answer-key-guard.service';
import { BotAskController } from './bot-ask.controller';
import { BotAskService } from './bot-ask.service';
import { BotMaterialsController } from './bot-materials.controller';
import { BotMaterialsService } from './bot-materials.service';
import { BotRateLimiterService } from './bot-rate-limiter.service';
import { MATERIAL_INDEX_PORT } from './material-index.port';
import { MATERIAL_RETRIEVAL_PORT } from './material-retrieval.port';
import { OpenAiCompatibleAiAdapter } from './openai-compatible-ai.adapter';
import { PgVectorMaterialIndexAdapter } from './pgvector-material-index.adapter';
import { TextExtractorService } from './text-extractor.service';

@Module({
  imports: [AccessModule, ActivitiesModule, PrismaModule, StorageModule],
  controllers: [BotMaterialsController, BotAskController],
  providers: [
    BotMaterialsService,
    BotAskService,
    BotRateLimiterService,
    AnswerKeyGuardService,
    TextExtractorService,
    OpenAiCompatibleAiAdapter,
    PgVectorMaterialIndexAdapter,
    { provide: CHAT_MODEL_PORT, useExisting: OpenAiCompatibleAiAdapter },
    { provide: EMBEDDING_MODEL_PORT, useExisting: OpenAiCompatibleAiAdapter },
    { provide: MATERIAL_INDEX_PORT, useExisting: PgVectorMaterialIndexAdapter },
    { provide: MATERIAL_RETRIEVAL_PORT, useExisting: PgVectorMaterialIndexAdapter },
  ],
  // Consumed by MaterialsModule to exclude soft-removed materials from the bot.
  exports: [BotMaterialsService],
})
export class BotModule {}
