import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
} from '../platform/outbox/outbox.registry';
import {
  CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from '../platform/realtime/realtime-events';
import { ClassroomContextEventsService } from './context-events/classroom-context-events.service';

const classroomChange = z.object({ classroomId: z.uuid() });
const sessionChange = z.object({ userId: z.uuid(), sessionId: z.uuid().optional() });

/** Hints only, delivered after commit. Existing live-room eviction handlers remain authoritative. */
@Injectable()
export class ClassroomContextDeliveryHandler implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly stream: ClassroomContextEventsService,
  ) {}

  onModuleInit(): void {
    for (const type of [
      'classroom.context.changed',
      CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
      REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
    ]) {
      this.registry.register(type, async (event) => {
        const payload = this.parse(classroomChange, event);
        // Whole-classroom hints also cover parents whose linked child's membership ended.
        this.stream.invalidateClassroom(payload.classroomId);
      });
    }
    this.registry.register(REALTIME_SESSIONS_REVOKED_EVENT, async (event) => {
      const payload = this.parse(sessionChange, event);
      this.stream.invalidateSession(payload.userId, payload.sessionId);
    });
  }

  private parse<T>(schema: z.ZodType<T>, event: OutboxEventEnvelope): T {
    const result = schema.safeParse(event.payload);
    // Outbox stores error messages: never include the failed payload.
    if (!result.success) throw new Error('Invalid classroom context event');
    return result.data;
  }
}
