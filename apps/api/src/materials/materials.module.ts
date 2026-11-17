import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [AccessModule, PrismaModule, StorageModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
})
export class MaterialsModule {}
