import { MapSchema, Schema, type } from '@colyseus/schema';

/**
 * One user in the classroom. A user has a single avatar however many connections they hold.
 * `status` is `'online'` or `'reconnecting'` (see `AVATAR_STATUSES` in `@aula/contracts`); it is a
 * plain string here because the generated client types must not depend on server imports.
 */
export class Avatar extends Schema {
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('string') role = '';
  @type('float32') x = 0;
  @type('float32') z = 0;
  /** Facing angle in radians around the vertical axis: `atan2(dirX, dirZ)` of the last movement. */
  @type('float32') rotation = 0;
  @type('string') status = 'online';
}

/**
 * Synchronized state: who is in the classroom and where. Avatars are keyed by user id.
 * Client types are generated from this file (`pnpm realtime:codegen`), so keep it free of server
 * imports.
 */
export class ClassroomState extends Schema {
  @type('string') classroomId = '';
  @type({ map: Avatar }) avatars = new MapSchema<Avatar>();
}
