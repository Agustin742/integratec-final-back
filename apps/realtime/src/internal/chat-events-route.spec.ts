import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { CHAT_MESSAGE_EVENT, CHAT_MESSAGE_HIDDEN_EVENT } from '@aula/contracts';
import { configureExpress } from '../server';
import { CHAT_EVENTS_PATH } from './chat-events-route';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const MESSAGE = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const USER = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const created = {
  classroomId: CLASSROOM,
  event: CHAT_MESSAGE_EVENT,
  payload: {
    id: MESSAGE,
    classroomId: CLASSROOM,
    authorId: USER,
    body: 'Persisted message',
    mentionedUserIds: [],
    createdAt: '2026-11-19T12:00:00.000Z',
  },
};

const makeApp = () => {
  const directory = {
    evict: vi.fn().mockReturnValue(0),
    applyAppearance: vi.fn(),
    applyDeskCount: vi.fn(),
    broadcastChatEvent: vi.fn(),
  };
  const app = configureExpress(express(), { internal: { serviceSecret: SECRET, directory } });
  return { app, directory };
};
const post = (app: ReturnType<typeof makeApp>['app'], body: object) =>
  request(app).post(CHAT_EVENTS_PATH).set('x-internal-service-secret', SECRET).send(body);

describe(`POST ${CHAT_EVENTS_PATH}`, () => {
  it('authenticates the internal caller and forwards committed events', async () => {
    const { app, directory } = makeApp();
    await post(app, created).expect(204);
    await post(app, {
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: { messageId: MESSAGE, hiddenAt: '2026-11-19T12:01:00.000Z' },
    }).expect(204);

    expect(directory.broadcastChatEvent).toHaveBeenNthCalledWith(1, created);
    expect(directory.broadcastChatEvent).toHaveBeenNthCalledWith(2, {
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: { messageId: MESSAGE, hiddenAt: '2026-11-19T12:01:00.000Z' },
    });
  });

  it.each([undefined, 'wrong-secret'])(
    'rejects missing or invalid service secret (%s)',
    async (secret) => {
      const { app, directory } = makeApp();
      const req = request(app).post(CHAT_EVENTS_PATH);
      if (secret !== undefined) req.set('x-internal-service-secret', secret);
      await req.send(created).expect(401);
      expect(directory.broadcastChatEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['malformed classroom', { ...created, classroomId: 'not-a-uuid' }],
    ['cross-classroom message', { ...created, classroomId: USER }],
    ['unexpected field', { ...created, ignored: true }],
    ['malformed message payload', { ...created, payload: { ...created.payload, authorId: 'x' } }],
    ['unsupported event', { ...created, event: 'chat:unknown' }],
  ])('rejects %s without broadcasting', async (_label, payload) => {
    const { app, directory } = makeApp();
    await post(app, payload).expect(400);
    expect(directory.broadcastChatEvent).not.toHaveBeenCalled();
  });

  it('does not mount when the internal service secret is not configured', async () => {
    await request(configureExpress(express())).post(CHAT_EVENTS_PATH).send(created).expect(404);
  });
});
