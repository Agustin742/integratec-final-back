import { describe, expect, it, vi } from 'vitest';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
} from '../platform/outbox/outbox.registry';
import {
  CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from '../platform/realtime/realtime-events';
import { ClassroomContextDeliveryHandler } from './context-delivery.handler';
import type { ClassroomContextEventsService } from './context-events/classroom-context-events.service';

const classroomId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
function fixture() {
  const registry = new OutboxHandlerRegistry();
  const stream = { invalidateClassroom: vi.fn(), invalidateSession: vi.fn() };
  const handler = new ClassroomContextDeliveryHandler(
    registry,
    stream as unknown as ClassroomContextEventsService,
  );
  handler.onModuleInit();
  const dispatch = async (type: string, payload: OutboxEventEnvelope['payload']) => {
    const event = { id: 'event', type, payload, occurredAt: new Date() };
    for (const deliver of registry.handlersFor(type)) await deliver(event);
  };
  return { registry, stream, dispatch };
}

describe('classroom context outbox delivery', () => {
  it.each([
    'classroom.context.changed',
    CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
    REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  ])(
    'invalidates the classroom from committed %s events, including parent streams',
    async (type) => {
      const { dispatch, stream } = fixture();
      await dispatch(type, { classroomId, userId, membershipId: sessionId });
      expect(stream.invalidateClassroom).toHaveBeenCalledExactlyOnceWith(classroomId);
      expect(stream.invalidateSession).not.toHaveBeenCalled();
    },
  );

  it('limits one-session revocation and supports account-wide revocation', async () => {
    const { dispatch, stream } = fixture();
    await dispatch(REALTIME_SESSIONS_REVOKED_EVENT, { userId, sessionId });
    await dispatch(REALTIME_SESSIONS_REVOKED_EVENT, { userId });
    expect(stream.invalidateSession.mock.calls).toEqual([
      [userId, sessionId],
      [userId, undefined],
    ]);
    expect(stream.invalidateClassroom).not.toHaveBeenCalled();
  });

  it('rejects malformed events without publishing payload details or touching subscribers', async () => {
    const { dispatch, stream } = fixture();
    await expect(
      dispatch('classroom.context.changed', { classroomId: 'private-bad-id' }),
    ).rejects.toThrow('Invalid classroom context event');
    await expect(
      dispatch(REALTIME_SESSIONS_REVOKED_EVENT, { userId: 'private-user' }),
    ).rejects.toThrow('Invalid classroom context event');
    expect(stream.invalidateClassroom).not.toHaveBeenCalled();
    expect(stream.invalidateSession).not.toHaveBeenCalled();
  });

  it('adds delivery without replacing existing live-room eviction handlers or retry policy', async () => {
    const registry = new OutboxHandlerRegistry();
    const previous = vi.fn(async () => {});
    registry.register(CLASSROOM_MEMBERSHIP_REMOVED_EVENT, previous);
    registry.setRetryPolicy(CLASSROOM_MEMBERSHIP_REMOVED_EVENT, { maxAttempts: 12 });
    const stream = { invalidateClassroom: vi.fn(), invalidateSession: vi.fn() };
    new ClassroomContextDeliveryHandler(
      registry,
      stream as unknown as ClassroomContextEventsService,
    ).onModuleInit();
    const event = {
      id: 'event',
      type: CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
      payload: { classroomId, userId },
      occurredAt: new Date(),
    };
    for (const deliver of registry.handlersFor(event.type)) await deliver(event);
    expect(previous).toHaveBeenCalledExactlyOnceWith(event);
    expect(stream.invalidateClassroom).toHaveBeenCalledExactlyOnceWith(classroomId);
    expect(registry.retryPolicyFor(event.type)).toEqual({ maxAttempts: 12 });
  });
});
