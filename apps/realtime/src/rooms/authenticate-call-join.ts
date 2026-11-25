import { callJoinOptionsSchema, type CallJoinOptions, type CallKind } from '@aula/contracts';
import { ServerError } from '@colyseus/core';
import {
  toClassroomAuth,
  type ClassroomAuth,
  type JoinVerifier,
  type VerifiedJoin,
} from '../join/join-verifier';
import { deriveCallKey, isCallModerator } from './call-key';

const UNAUTHORIZED = 401;
const BAD_REQUEST = 400;

/** What a call connection carries as `client.auth`: the classroom identity plus the call it is for. */
export interface CallAuth extends ClassroomAuth {
  kind: CallKind;
  /** Server-derived matchmaking key; see {@link deriveCallKey}. */
  callKey: string;
  /** May this user create the room? Moderators for a classroom call, either member for a direct one. */
  canStart: boolean;
  peerUserId?: string;
}

/**
 * Authenticates one call join, like `authenticateJoin` does for the classroom room: the token comes
 * from the `Authorization` header only, options are strictly validated (so a client cannot supply
 * the server-derived fields) and every denial is a generic `ServerError`.
 */
export async function authenticateCallJoin(
  verifier: JoinVerifier,
  token: string | undefined,
  options: unknown,
): Promise<CallAuth> {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  const parsed = callJoinOptionsSchema.safeParse(options);
  if (!parsed.success) throw new ServerError(BAD_REQUEST, 'Bad request');
  const joinOptions: CallJoinOptions = parsed.data;
  let identity: VerifiedJoin;
  try {
    identity = await verifier.verify(token, joinOptions.classroomId);
  } catch {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  if (identity.classroomId !== joinOptions.classroomId) {
    throw new ServerError(UNAUTHORIZED, 'Unauthorized');
  }
  if (
    joinOptions.kind === 'direct' &&
    joinOptions.peerUserId.toLowerCase() === identity.userId.toLowerCase()
  ) {
    throw new ServerError(BAD_REQUEST, 'Bad request');
  }
  return {
    ...toClassroomAuth(identity),
    kind: joinOptions.kind,
    callKey: deriveCallKey(joinOptions, identity.userId),
    canStart: joinOptions.kind === 'direct' || isCallModerator(identity.role),
    ...(joinOptions.kind === 'direct' ? { peerUserId: joinOptions.peerUserId } : {}),
  };
}
