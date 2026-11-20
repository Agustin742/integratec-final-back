import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BotMaterialsController } from './bot-materials.controller';
import { BotMaterialsService } from './bot-materials.service';
import { DailyReviewController } from './daily-review.controller';
import { DailyReviewService } from './daily-review.service';
import { InProcessMaterialIndexAdapter } from './in-process-material-index.adapter';
import { MATERIAL_INDEX_PORT } from './material-index.port';

@Module({
  imports: [AccessModule, ActivitiesModule, PrismaModule],
  controllers: [BotMaterialsController, DailyReviewController],
  providers: [
    BotMaterialsService,
    DailyReviewService,
    // Default adapter until the retrieval technology decision (HU-BOT-002).
    { provide: MATERIAL_INDEX_PORT, useClass: InProcessMaterialIndexAdapter },
  ],
  // Consumed by MaterialsModule to exclude soft-removed materials from the bot.
  exports: [BotMaterialsService],
})
export class BotModule {}
