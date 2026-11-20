import { describe, it, expect } from 'vitest';
import {
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  chatRealtimeBroadcastSchema,
  type HealthStatus,
} from './index';

describe('@aula/contracts smoke test', () => {
  it('should define HealthStatus shape correctly', () => {
    const health: HealthStatus = {
      status: 'ok',
      service: 'contracts',
      timestamp: new Date().toISOString(),
    };
    expect(health.status).toBe('ok');
    expect(health.service).toBe('contracts');
  });

  it('validates classroom-scoped chat notifications and rejects cross-room or unknown fields', () => {
    const classroomId = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
    const message = {
      id: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
      classroomId,
      authorId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
      body: 'Hello',
      mentionedUserIds: [],
      createdAt: '2026-11-19T12:00:00.000Z',
    };
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_EVENT,
        payload: message,
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: {
          messageId: message.id,
          hiddenAt: '2026-11-19T12:01:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_EVENT,
        payload: { ...message, classroomId: '11111111-1111-4111-8111-111111111111' },
      }).success,
    ).toBe(false);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { messageId: message.id, hiddenAt: '2026-11-19T12:01:00.000Z', body: 'secret' },
      }).success,
    ).toBe(false);
  });
});
