import { Module } from '@nestjs/common';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ClassroomContextDeliveryHandler } from './context-delivery.handler';
import { ClassroomContextEventsModule } from './context-events/classroom-context-events.module';

/** API-root integration: do not introduce AuthModule's global guard into classroom consumers. */
@Module({
  imports: [OutboxModule, ClassroomContextEventsModule],
  providers: [ClassroomContextDeliveryHandler],
})
export class ClassroomContextDeliveryModule {}
