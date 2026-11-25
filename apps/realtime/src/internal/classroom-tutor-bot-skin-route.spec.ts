import express, { type Application } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { configureExpress } from '../server';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const BODY = { classroomId: CLASSROOM, tutorBotSkin: 'boca', tutorBotSkinRevision: 3 };

const makeApp = () => {
  const directory = {
    evict: vi.fn(),
    applyAppearance: vi.fn(),
    applyDeskCount: vi.fn(),
    applyTutorBotSkin: vi.fn(),
    broadcastChatEvent: vi.fn(),
  };
  const app = configureExpress(express(), { internal: { serviceSecret: SECRET, directory } });
  return { app, directory };
};

const post = (app: Application, body: object, secret?: string) => {
  const req = request(app).post('/internal/classroom-tutor-bot-skin');
  return (secret === undefined ? req : req.set('x-internal-service-secret', secret)).send(body);
};

describe('POST /internal/classroom-tutor-bot-skin (#154)', () => {
  it('applies the skin to the classroom and answers a bare 204', async () => {
    const { app, directory } = makeApp();

    const res = await post(app, BODY, SECRET).expect(204);

    expect(res.text).toBe('');
    expect(directory.applyTutorBotSkin).toHaveBeenCalledExactlyOnceWith(CLASSROOM, 'boca', 3);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'x'.repeat(SECRET.length)],
  ])('answers 401 and applies nothing for %s', async (_label, secret) => {
    const { app, directory } = makeApp();

    await post(app, BODY, secret).expect(401);

    expect(directory.applyTutorBotSkin).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['a malformed classroomId', { ...BODY, classroomId: 'x' }],
    ['an unknown skin', { ...BODY, tutorBotSkin: 'river' }],
    ['a negative revision', { ...BODY, tutorBotSkinRevision: -1 }],
    ['a fractional revision', { ...BODY, tutorBotSkinRevision: 1.5 }],
    ['an unexpected field', { ...BODY, everyone: true }],
  ])('answers 400 and applies nothing for %s', async (_label, body) => {
    const { app, directory } = makeApp();

    await post(app, body, SECRET).expect(400);

    expect(directory.applyTutorBotSkin).not.toHaveBeenCalled();
  });

  it('is not mounted when no internal secret is configured', async () => {
    await post(configureExpress(express()), BODY).expect(404);
  });
});
