import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ClassroomContextRecorder } from './classroom-context.recorder';

@Module({
  imports: [OutboxModule],
  providers: [ClassroomContextRecorder],
  exports: [ClassroomContextRecorder],
})
export class ClassroomContextModule {}
