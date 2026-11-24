import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BotModule } from '../bot/bot.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MaterialModulesController } from './material-modules.controller';
import { MaterialModulesService } from './material-modules.service';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [AccessModule, BotModule, PrismaModule, StorageModule],
  controllers: [MaterialsController, MaterialModulesController],
  providers: [MaterialsService, MaterialModulesService],
})
export class MaterialsModule {}
