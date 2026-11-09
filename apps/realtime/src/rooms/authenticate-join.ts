import type { ClassroomJoinOptions } from '@aula/contracts';
import { ServerError } from '@colyseus/core';
import { z } from 'zod';
import type { JoinVerifier, VerifiedJoin } from '../join/join-verifier';

const UNAUTHORIZED = 401;
const BAD_REQUEST = 400;

// Compile-time check that the runtime schema and the shared contract describe the same shape.
const joinOptionsSchema: z.ZodType<ClassroomJoinOptions> = z.object({ classroomId: z.uuid() });

/** Reads the classroom a client asks for; undefined when absent or not a UUID. */
export function parseClassroomId(options: unknown): string | undefined {
  const parsed = joinOptionsSchema.safeParse(options);
  return parsed.success ? parsed.data.classroomId : undefined;
}

/**
 * Authenticates one join attempt. `token` is the Colyseus-native credential (the `Authorization`
 * header of the matchmake request); it is never read from `options`. Every denial is a
 * `ServerError` with a generic message so the client cannot tell why it was refused.
 */
export async function authenticateJoin(
  verifier: JoinVerifier,
  token: string | undefined,
  options: unknown,
): Promise<VerifiedJoin> {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  const classroomId = parseClassroomId(options);
  if (classroomId === undefined) {
    throw new ServerError(BAD_REQUEST, 'Bad request');
  }
  let identity: VerifiedJoin;
  try {
    identity = await verifier.verify(token, classroomId);
  } catch {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  // Defense in depth: the identity must be for the classroom that was asked for.
  if (identity.classroomId !== classroomId) {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  return identity;
}
