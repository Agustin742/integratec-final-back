import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { ClassroomContextEventsController } from './classroom-context-events.controller';
import { ClassroomContextEventsService } from './classroom-context-events.service';

@Module({
  imports: [AccessModule, AuthModule],
  controllers: [ClassroomContextEventsController],
  providers: [ClassroomContextEventsService],
  exports: [ClassroomContextEventsService],
})
export class ClassroomContextEventsModule {}
