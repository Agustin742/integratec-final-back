import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassroomRosterController } from './roster.controller';
import { ClassroomRosterService } from './roster.service';

@Module({
  imports: [AccessModule, PrismaModule],
  controllers: [ClassroomRosterController],
  providers: [ClassroomRosterService],
  exports: [ClassroomRosterService],
})
export class ClassroomRosterModule {}
