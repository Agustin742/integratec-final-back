import { describe, expect, it, vi } from 'vitest';
import { ServerError } from '@colyseus/core';
import { authenticateCallJoin } from './authenticate-call-join';
import { deriveCallKey } from './call-key';
import { JoinDeniedError, type JoinVerifier } from '../join/join-verifier';
import { makeStubAppearance } from '../testing/stub-api';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const PEER = '00000000-0000-4000-8000-00000000000b';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM,
  role: 'STUDENT' as const,
  displayName: 'Ada',
  appearanceRevision: 1,
  appearance: makeStubAppearance(),
  deskCount: 12,
};

const verifierReturning = (impl: JoinVerifier['verify']) => ({
  verify: vi.fn(impl),
  reverify: vi.fn(),
});
const rejection = async (promise: Promise<unknown>): Promise<ServerError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServerError);
  return error as ServerError;
};

describe('authenticateCallJoin', () => {
  it('authenticates a classroom call join and derives the key server-side', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const auth = await authenticateCallJoin(verifier, 'token', {
      kind: 'classroom',
      classroomId: CLASSROOM,
    });
    expect(auth).toMatchObject({
      userId: IDENTITY.userId,
      classroomId: CLASSROOM,
      kind: 'classroom',
      callKey: deriveCallKey({ kind: 'classroom', classroomId: CLASSROOM }, IDENTITY.userId),
      canStart: false,
    });
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token', CLASSROOM);
  });

  it.each(['OWNER', 'ADMIN', 'TEACHER'] as const)(
    'lets %s start a classroom call',
    async (role) => {
      const verifier = verifierReturning(async () => ({ ...IDENTITY, role }));
      const auth = await authenticateCallJoin(verifier, 'token', {
        kind: 'classroom',
        classroomId: CLASSROOM,
      });
      expect(auth.canStart).toBe(true);
    },
  );

  it('lets either member of a pair start a direct call', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const auth = await authenticateCallJoin(verifier, 'token', {
      kind: 'direct',
      classroomId: CLASSROOM,
      peerUserId: PEER,
    });
    expect(auth).toMatchObject({ kind: 'direct', canStart: true, peerUserId: PEER });
    expect(auth.callKey).toBe(
      deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: PEER }, IDENTITY.userId),
    );
  });

  it('rejects calling yourself with 400', async () => {
    const verifier = verifierReturning(async () => IDENTITY);
    const error = await rejection(
      authenticateCallJoin(verifier, 'token', {
        kind: 'direct',
        classroomId: CLASSROOM,
        peerUserId: IDENTITY.userId,
      }),
    );
    expect(error.code).toBe(400);
  });

  it.each([undefined, '', '  '])('rejects a missing token (%j) with 401', async (token) => {
    const verifier = verifierReturning(async () => IDENTITY);
    const error = await rejection(
      authenticateCallJoin(verifier, token, { kind: 'classroom', classroomId: CLASSROOM }),
    );
    expect(error.code).toBe(401);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['no options', undefined],
    ['no kind', { classroomId: CLASSROOM }],
    ['unknown kind', { kind: 'broadcast', classroomId: CLASSROOM }],
    ['a forged call key', { kind: 'classroom', classroomId: CLASSROOM, callKey: 'x' }],
    ['a peer on a classroom call', { kind: 'classroom', classroomId: CLASSROOM, peerUserId: PEER }],
    ['a direct call without peer', { kind: 'direct', classroomId: CLASSROOM }],
    ['a malformed classroom', { kind: 'classroom', classroomId: 'nope' }],
  ])('rejects %s with 400 before calling the API', async (_label, options) => {
    const verifier = verifierReturning(async () => IDENTITY);
    const error = await rejection(authenticateCallJoin(verifier, 'token', options));
    expect(error.code).toBe(400);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects an API denial with a generic 401', async () => {
    const verifier = verifierReturning(async () => {
      throw new JoinDeniedError();
    });
    const error = await rejection(
      authenticateCallJoin(verifier, 'token', { kind: 'classroom', classroomId: CLASSROOM }),
    );
    expect(error).toMatchObject({ code: 401, message: 'Unauthorized' });
  });

  it('rejects an identity for another classroom with 401', async () => {
    const verifier = verifierReturning(async () => ({
      ...IDENTITY,
      classroomId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
    }));
    const error = await rejection(
      authenticateCallJoin(verifier, 'token', { kind: 'classroom', classroomId: CLASSROOM }),
    );
    expect(error.code).toBe(401);
  });
});
