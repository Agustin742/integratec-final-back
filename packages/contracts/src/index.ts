export interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export type UserRole = 'TEACHER' | 'STUDENT' | 'PARENT' | 'SCHOOL_ADMIN';

export const RegistrationPath = {
  INDEPENDENT_TEACHER: 'INDEPENDENT_TEACHER',
  SCHOOL: 'SCHOOL',
} as const;

export type RegistrationPath = (typeof RegistrationPath)[keyof typeof RegistrationPath];

export const REGISTRATION_PATHS = [
  RegistrationPath.INDEPENDENT_TEACHER,
  RegistrationPath.SCHOOL,
] as const;

/**
 * Realtime (Colyseus) contract shared with the frontend (decision D8).
 * The room state client types are generated into `./realtime/generated` by `pnpm realtime:codegen`.
 * This stays in `index.ts` (no relative import): Node loads the package entry as TypeScript source.
 */

/** Name the room is registered under; clients join it with `client.joinOrCreate`. */
export const CLASSROOM_ROOM_NAME = 'classroom';

/**
 * Options a client passes when joining a classroom room.
 * The access token is NOT an option: the client sets `client.auth.token`, which the SDK sends as
 * the `Authorization: Bearer` header of the matchmake request.
 */
export interface ClassroomJoinOptions {
  classroomId: string;
}
