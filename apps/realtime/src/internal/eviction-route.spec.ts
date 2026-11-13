import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { configureExpress } from '../server';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const USER = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const SESSION = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';

const makeApp = () => {
  const directory = { evict: vi.fn().mockReturnValue(2) };
  const app = configureExpress(express(), { internal: { serviceSecret: SECRET, directory } });
  return { app, directory };
};

describe('POST /internal/evictions', () => {
  it('evicts the user and answers 204 without revealing how many connections matched', async () => {
    const { app, directory } = makeApp();

    const res = await request(app)
      .post('/internal/evictions')
      .set('x-internal-service-secret', SECRET)
      .send({ userId: USER, classroomId: CLASSROOM })
      .expect(204);

    expect(res.text).toBe('');
    expect(directory.evict).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      classroomId: CLASSROOM,
    });
  });

  it('passes a session filter and a bare user filter through', async () => {
    const { app, directory } = makeApp();
    const post = (body: object) =>
      request(app).post('/internal/evictions').set('x-internal-service-secret', SECRET).send(body);

    await post({ userId: USER, sessionId: SESSION }).expect(204);
    await post({ userId: USER }).expect(204);

    expect(directory.evict).toHaveBeenNthCalledWith(1, { userId: USER, sessionId: SESSION });
    expect(directory.evict).toHaveBeenNthCalledWith(2, { userId: USER });
  });

  it('answers 204 when nobody matched, so retries are harmless', async () => {
    const { app, directory } = makeApp();
    directory.evict.mockReturnValue(0);

    await request(app)
      .post('/internal/evictions')
      .set('x-internal-service-secret', SECRET)
      .send({ userId: USER })
      .expect(204);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'x'.repeat(SECRET.length)],
    ['a shorter secret', SECRET.slice(1)],
    ['an empty secret', ''],
  ])('answers 401 and evicts nobody for %s', async (_label, secret) => {
    const { app, directory } = makeApp();
    const req = request(app).post('/internal/evictions');

    await (secret === undefined ? req : req.set('x-internal-service-secret', secret))
      .send({ userId: USER })
      .expect(401);

    expect(directory.evict).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['a malformed userId', { userId: 'x' }],
    ['a malformed classroomId', { userId: USER, classroomId: 'x' }],
    ['a malformed sessionId', { userId: USER, sessionId: 'x' }],
    ['an unexpected field', { userId: USER, everyone: true }],
  ])('answers 400 and evicts nobody for %s', async (_label, body) => {
    const { app, directory } = makeApp();

    await request(app)
      .post('/internal/evictions')
      .set('x-internal-service-secret', SECRET)
      .send(body)
      .expect(400);

    expect(directory.evict).not.toHaveBeenCalled();
  });

  it('is not mounted when no internal secret is configured', async () => {
    const app = configureExpress(express());
    await request(app).post('/internal/evictions').send({ userId: USER }).expect(404);
  });
});
