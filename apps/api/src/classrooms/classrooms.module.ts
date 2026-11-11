import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { MeClassroomsController } from './me-classrooms.controller';
import { ClassroomRosterModule } from './roster/roster.module';

@Module({
  imports: [PrismaModule, AccessModule, ClassroomRosterModule],
  controllers: [ClassroomsController, MeClassroomsController],
  providers: [ClassroomsService],
  exports: [ClassroomsService],
})
export class ClassroomsModule {}
