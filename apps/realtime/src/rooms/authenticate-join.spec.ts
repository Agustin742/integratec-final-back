import { describe, it, expect, vi } from 'vitest';
import { ServerError } from '@colyseus/core';
import { authenticateJoin } from './authenticate-join';
import { JoinDeniedError, type JoinVerifier } from '../join/join-verifier';

const CLASSROOM_ID = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM_ID,
  role: 'STUDENT' as const,
  displayName: 'Ada Lovelace',
};

const verifierReturning = (impl: JoinVerifier['verify']) => ({ verify: vi.fn(impl) });

const rejection = async (promise: Promise<unknown>): Promise<ServerError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServerError);
  return error as ServerError;
};

describe('authenticateJoin', () => {
  it('returns the verified identity for a valid token and classroomId', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const auth = await authenticateJoin(verifier, 'token-1', { classroomId: CLASSROOM_ID });

    expect(auth).toEqual({
      userId: IDENTITY.userId,
      authSessionId: IDENTITY.sessionId,
      classroomId: CLASSROOM_ID,
      role: 'STUDENT',
      displayName: 'Ada Lovelace',
    });
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token-1', CLASSROOM_ID);
  });

  it('never exposes a `sessionId` key: Colyseus would adopt it as the id of every connection', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const auth = await authenticateJoin(verifier, 'token-1', { classroomId: CLASSROOM_ID });

    expect(auth).not.toHaveProperty('sessionId');
  });

  it.each([undefined, '', '   '])(
    'rejects a missing or blank token (%j) with 401',
    async (token) => {
      const verifier = verifierReturning(async () => IDENTITY);
      const error = await rejection(
        authenticateJoin(verifier, token as string, { classroomId: CLASSROOM_ID }),
      );
      expect(error.code).toBe(401);
      expect(verifier.verify).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing options', undefined],
    ['missing classroomId', {}],
    ['a non-uuid classroomId', { classroomId: 'room-1' }],
    ['a numeric classroomId', { classroomId: 7 }],
  ])('rejects %s with 400 without calling the API', async (_label, options) => {
    const verifier = verifierReturning(async () => IDENTITY);
    const error = await rejection(authenticateJoin(verifier, 'token-1', options));
    expect(error.code).toBe(400);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('does not read the token from the join options', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const error = await rejection(
      authenticateJoin(verifier, undefined as unknown as string, {
        classroomId: CLASSROOM_ID,
        accessToken: 'from-options',
        token: 'from-options',
      }),
    );
    expect(error.code).toBe(401);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects with a generic 401 when the verifier denies', async () => {
    const verifier = verifierReturning(async () => {
      throw new JoinDeniedError();
    });
    const error = await rejection(
      authenticateJoin(verifier, 'secret-token', { classroomId: CLASSROOM_ID }),
    );
    expect(error.code).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });

  it('rejects with the same generic 401 when the verifier fails unexpectedly', async () => {
    const verifier = verifierReturning(async () => {
      throw new Error('connect ECONNREFUSED secret-token');
    });
    const error = await rejection(
      authenticateJoin(verifier, 'secret-token', { classroomId: CLASSROOM_ID }),
    );
    expect(error.code).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });

  it('rejects when the verified classroom differs from the requested one', async () => {
    const verifier = verifierReturning(async () => ({
      ...IDENTITY,
      classroomId: '11111111-1111-4111-8111-111111111111',
    }));
    const error = await rejection(
      authenticateJoin(verifier, 'token-1', { classroomId: CLASSROOM_ID }),
    );
    expect(error.code).toBe(401);
  });
});
