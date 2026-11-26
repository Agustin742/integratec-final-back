import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FamilyMessagesService } from './family-messages.service';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { ParentLinkMessagesController } from './parent-link-messages.controller';

@Module({
  imports: [PrismaModule, AccessModule, MetricsModule],
  controllers: [FamilyController, ParentLinkMessagesController],
  providers: [FamilyService, FamilyMessagesService],
  exports: [FamilyService, FamilyMessagesService],
})
export class FamilyModule {}
