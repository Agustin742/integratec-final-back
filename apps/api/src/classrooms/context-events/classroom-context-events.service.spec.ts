import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../../access/access-verification.service';
import { SessionVerifier } from '../../auth/session-verifier.service';
import {
  ClassroomContextEventsService,
  CONTEXT_HEARTBEAT_MS,
  CONTEXT_MAX_LIFETIME_MS,
  CONTEXT_SETUP_TIMEOUT_MS,
} from './classroom-context-events.service';

const identity = { userId: 'verified-user', sessionId: 'verified-session' };
const classroomId = '00000000-0000-4000-8000-000000000001';
const foreignId = '00000000-0000-4000-8000-000000000002';
const hint = `event: classroom.context-invalidated\ndata: ${JSON.stringify({ classroomId })}\n\n`;
class Sink extends EventEmitter {
  destroyed = false;
  status = vi.fn().mockReturnThis();
  setHeader = vi.fn();
  write = vi.fn().mockReturnValue(true);
  end = vi.fn(() => {
    this.emit('close');
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.emit('close');
    return this;
  });
  asResponse() {
    return this as unknown as Response;
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('classroom context stream lifecycle', () => {
  let broker: ClassroomContextEventsService;
  let sinks: Sink[];
  const access = { verifyClassroomAccess: vi.fn() };
  const sessions = { verifySession: vi.fn() };
  const sink = () => {
    const value = new Sink();
    sinks.push(value);
    return value;
  };
  const connect = (value: Sink, session = identity, id = classroomId) =>
    broker.connect(session, id, value.asResponse());
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    access.verifyClassroomAccess.mockResolvedValue({ myRole: 'PARENT' });
    sessions.verifySession.mockResolvedValue(identity);
    broker = new ClassroomContextEventsService(
      access as unknown as AccessVerificationService,
      sessions as unknown as SessionVerifier,
    );
    sinks = [];
  });
  afterEach(() => {
    broker.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
    for (const value of sinks) {
      expect(value.listenerCount('close')).toBe(0);
      expect(value.listenerCount('error')).toBe(0);
    }
    vi.useRealTimers();
  });

  it('registers a minimal initial hint and sends heartbeat comments only after successful checks', async () => {
    const value = sink();
    await connect(value);
    expect(value.write.mock.calls).toEqual([[hint]]);
    expect(value.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CONTEXT_HEARTBEAT_MS);
    expect(sessions.verifySession).toHaveBeenCalledWith(identity.userId, identity.sessionId);
    expect(access.verifyClassroomAccess).toHaveBeenLastCalledWith(identity.userId, classroomId, {
      requiredRole: 'ANY',
    });
    expect(value.write).toHaveBeenLastCalledWith(': heartbeat\n\n');
  });
  it('isolates classrooms and verified session/user targets; duplicate invalidations are harmless', async () => {
    const first = sink();
    const second = sink();
    const other = sink();
    await connect(first);
    await connect(second, { ...identity, sessionId: 'second-session' });
    await connect(other, { userId: 'other-user', sessionId: 'other-session' }, foreignId);
    broker.invalidateSession('other-user', identity.sessionId);
    expect(other.end).not.toHaveBeenCalled();
    broker.invalidateSession(identity.userId, identity.sessionId);
    broker.invalidateSession(identity.userId, identity.sessionId);
    expect(first.write.mock.calls).toEqual([[hint], [hint]]);
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(second.end).not.toHaveBeenCalled();
    broker.invalidateSession(identity.userId);
    expect(second.end).toHaveBeenCalledTimes(1);
    expect(other.end).not.toHaveBeenCalled();
    broker.invalidateClassroom(foreignId);
    expect(other.end).toHaveBeenCalledTimes(1);
  });
  it.each(['initial', 'heartbeat', 'invalidation'])(
    'destroys a slow consumer on %s writefalse without further buffering',
    async (phase) => {
      const value = sink();
      if (phase === 'initial') value.write.mockReturnValue(false);
      await connect(value);
      if (phase !== 'initial') {
        value.write.mockReturnValue(false);
        if (phase === 'heartbeat') await vi.advanceTimersByTimeAsync(CONTEXT_HEARTBEAT_MS);
        else broker.invalidateClassroom(classroomId);
      }
      expect(value.destroy).toHaveBeenCalledTimes(1);
      expect(value.end).not.toHaveBeenCalled();
      const count = value.write.mock.calls.length;
      broker.invalidateClassroom(classroomId);
      await vi.advanceTimersByTimeAsync(CONTEXT_MAX_LIFETIME_MS);
      expect(value.write).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([new UnauthorizedException(), new Error('synthetic backend failure')])(
    'closes fail-closed on session revalidation failure %s',
    async (error) => {
      const value = sink();
      await connect(value);
      sessions.verifySession.mockRejectedValueOnce(error);
      await vi.advanceTimersByTimeAsync(CONTEXT_HEARTBEAT_MS);
      expect(value.write.mock.calls).toEqual([[hint], [hint]]);
      expect(value.end).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('closes when current classroom access disappears even if no producer hint arrives', async () => {
    const value = sink();
    await connect(value);
    access.verifyClassroomAccess.mockRejectedValueOnce(new NotFoundException());
    await vi.advanceTimersByTimeAsync(CONTEXT_HEARTBEAT_MS);
    expect(value.write.mock.calls).toEqual([[hint], [hint]]);
    expect(value.end).toHaveBeenCalledTimes(1);
  });
  it('bounds a hung check by maximum lifetime without overlapping revalidation', async () => {
    const value = sink();
    await connect(value);
    const pending = deferred();
    sessions.verifySession.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(CONTEXT_MAX_LIFETIME_MS);
    expect(sessions.verifySession).toHaveBeenCalledTimes(1);
    expect(value.end).toHaveBeenCalledTimes(1);
    expect(value.write.mock.calls).toEqual([[hint], [hint]]);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(access.verifyClassroomAccess).toHaveBeenCalledTimes(1);
  });
  it('removes subscriptions, listeners and timers on disconnect', async () => {
    const value = sink();
    await connect(value);
    value.destroy();
    broker.invalidateClassroom(classroomId);
    broker.invalidateSession(identity.userId);
    await vi.advanceTimersByTimeAsync(CONTEXT_MAX_LIFETIME_MS);
    expect(value.write.mock.calls).toEqual([[hint]]);
    expect(sessions.verifySession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels disconnected async setup before authorization completes and never registers later', async () => {
    const value = sink();
    const pending = deferred();
    access.verifyClassroomAccess.mockReturnValueOnce(pending.promise);
    const connected = connect(value);
    value.destroy();
    await connected;
    pending.resolve();
    await vi.advanceTimersByTimeAsync(CONTEXT_MAX_LIFETIME_MS);
    broker.invalidateClassroom(classroomId);
    expect(value.status).not.toHaveBeenCalled();
    expect(value.write).not.toHaveBeenCalled();
  });
  it('bounds async setup before SSE headers are committed', async () => {
    const value = sink();
    const pending = deferred();
    access.verifyClassroomAccess.mockReturnValueOnce(pending.promise);
    const rejected = expect(connect(value)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await vi.advanceTimersByTimeAsync(CONTEXT_SETUP_TIMEOUT_MS);
    await rejected;
    expect(value.status).not.toHaveBeenCalled();
    expect(value.write).not.toHaveBeenCalled();
    pending.resolve();
  });
  it('tears down active and pending streams on module shutdown and refuses new streams', async () => {
    const active = sink();
    await connect(active);
    const waiting = sink();
    const pending = deferred();
    access.verifyClassroomAccess.mockReturnValueOnce(pending.promise);
    const connected = connect(waiting);
    broker.onModuleDestroy();
    await connected;
    pending.resolve();
    expect(active.destroy).toHaveBeenCalledOnce();
    expect(waiting.destroy).toHaveBeenCalledOnce();
    expect(waiting.write).not.toHaveBeenCalled();
    await expect(connect(sink())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('does not install timers if the transport disconnects during the initial write', async () => {
    const value = sink();
    value.write.mockImplementation(() => {
      value.destroy();
      return true;
    });
    await connect(value);
    expect(vi.getTimerCount()).toBe(0);
    broker.invalidateClassroom(classroomId);
    expect(value.write).toHaveBeenCalledOnce();
  });
  it('fails closed on a synchronous transport write exception', async () => {
    const value = sink();
    value.write.mockImplementation(() => {
      throw new Error('synthetic write failure');
    });
    await connect(value);
    expect(value.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
