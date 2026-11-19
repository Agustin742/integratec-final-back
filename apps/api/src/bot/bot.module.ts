import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BotMaterialsController } from './bot-materials.controller';
import { BotMaterialsService } from './bot-materials.service';
import { InProcessMaterialIndexAdapter } from './in-process-material-index.adapter';
import { MATERIAL_INDEX_PORT } from './material-index.port';

@Module({
  imports: [AccessModule, PrismaModule],
  controllers: [BotMaterialsController],
  providers: [
    BotMaterialsService,
    // Default adapter until the retrieval technology decision (HU-BOT-002).
    { provide: MATERIAL_INDEX_PORT, useClass: InProcessMaterialIndexAdapter },
  ],
})
export class BotModule {}
