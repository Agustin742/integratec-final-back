import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassroomDesksController } from './desks.controller';
import { ClassroomDesksService } from './desks.service';

@Module({
  imports: [AccessModule, PrismaModule],
  controllers: [ClassroomDesksController],
  providers: [ClassroomDesksService],
})
export class ClassroomDesksModule {}
