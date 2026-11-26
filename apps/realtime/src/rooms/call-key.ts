import type { CallJoinOptions, CallKind } from '@aula/contracts';
import type { ClassroomRole } from '../join/join-verifier';

/** Roles that may start and moderate a classroom call (teacher-level authority). */
const MODERATOR_ROLES: readonly ClassroomRole[] = ['OWNER', 'ADMIN', 'TEACHER'];

/** Takes a plain string too: the role stored in synchronized call state is a string. */
export const isCallModerator = (role: string): boolean =>
  MODERATOR_ROLES.includes(role as ClassroomRole);

/** A direct call is a pair; a classroom call takes up to the configured maximum. */
export const callCapacity = (kind: CallKind, maxParticipants: number): number =>
  kind === 'direct' ? 2 : maxParticipants;

/**
 * The matchmaking key of a call, derived on the server from verified data only, so one call is one
 * room: `classroom:<classroomId>`, or `direct:<classroomId>:<lower id>:<higher id>` for the
 * unordered pair. A third user naming either member derives another key and can never reach the
 * pair's room.
 */
export function deriveCallKey(options: CallJoinOptions, userId: string): string {
  const classroomId = options.classroomId.toLowerCase();
  if (options.kind === 'classroom') return `classroom:${classroomId}`;
  const pair = [userId.toLowerCase(), options.peerUserId.toLowerCase()].sort();
  return `direct:${classroomId}:${pair[0]}:${pair[1]}`;
}
