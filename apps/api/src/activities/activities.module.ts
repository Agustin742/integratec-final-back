import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivitiesController } from './activities.controller';

@Module({
  imports: [AccessModule, PrismaModule],
  controllers: [ActivitiesController],
})
export class ActivitiesModule {}
