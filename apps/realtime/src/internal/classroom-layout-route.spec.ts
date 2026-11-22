import express, { type Application } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { MAX_CLASSROOM_DESKS } from '@aula/contracts';
import { configureExpress } from '../server';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

const makeApp = (reached = 1) => {
  const directory = {
    evict: vi.fn(),
    applyAppearance: vi.fn(),
    applyDeskCount: vi.fn().mockReturnValue(reached),
    broadcastChatEvent: vi.fn(),
  };
  const app = configureExpress(express(), { internal: { serviceSecret: SECRET, directory } });
  return { app, directory };
};

const post = (app: Application, body: object, secret?: string | null) => {
  const req = request(app).post('/internal/classroom-layout');
  return (secret == null ? req : req.set('x-internal-service-secret', secret)).send(body);
};

describe('POST /internal/classroom-layout', () => {
  it('applies the desk count to the classroom and answers 204 without revealing the rooms', async () => {
    const { app, directory } = makeApp();

    const res = await post(app, { classroomId: CLASSROOM, deskCount: 13 }, SECRET).expect(204);

    expect(res.text).toBe('');
    expect(directory.applyDeskCount).toHaveBeenCalledExactlyOnceWith(CLASSROOM, 13);
  });

  it('answers 204 when no room is live, so replays are harmless', async () => {
    const { app } = makeApp(0);

    await post(app, { classroomId: CLASSROOM, deskCount: 13 }, SECRET).expect(204);
  });

  it('accepts the largest allowed desk count', async () => {
    const { app, directory } = makeApp();

    await post(app, { classroomId: CLASSROOM, deskCount: MAX_CLASSROOM_DESKS }, SECRET).expect(204);

    expect(directory.applyDeskCount).toHaveBeenCalledWith(CLASSROOM, MAX_CLASSROOM_DESKS);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'x'.repeat(SECRET.length)],
    ['a shorter secret', SECRET.slice(1)],
    ['an empty secret', ''],
  ])('answers 401 and applies nothing for %s', async (_label, secret) => {
    const { app, directory } = makeApp();

    await post(app, { classroomId: CLASSROOM, deskCount: 13 }, secret).expect(401);

    expect(directory.applyDeskCount).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['a missing classroomId', { deskCount: 13 }],
    ['a malformed classroomId', { classroomId: 'x', deskCount: 13 }],
    ['a missing deskCount', { classroomId: CLASSROOM }],
    ['a negative deskCount', { classroomId: CLASSROOM, deskCount: -1 }],
    ['a fractional deskCount', { classroomId: CLASSROOM, deskCount: 12.5 }],
    ['a string deskCount', { classroomId: CLASSROOM, deskCount: '13' }],
    [
      'a deskCount over the maximum',
      { classroomId: CLASSROOM, deskCount: MAX_CLASSROOM_DESKS + 1 },
    ],
    ['an unexpected field', { classroomId: CLASSROOM, deskCount: 13, everyone: true }],
  ])('answers 400 and applies nothing for %s', async (_label, body) => {
    const { app, directory } = makeApp();

    await post(app, body, SECRET).expect(400);

    expect(directory.applyDeskCount).not.toHaveBeenCalled();
  });

  it('is not mounted when no internal secret is configured', async () => {
    const app = configureExpress(express());
    await post(app, { classroomId: CLASSROOM, deskCount: 13 }).expect(404);
  });
});
