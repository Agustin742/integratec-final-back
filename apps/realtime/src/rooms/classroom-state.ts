import { MapSchema, Schema, type } from '@colyseus/schema';

/**
 * One equipped avatar item of a member, as broadcast in their appearance. Public catalog fields
 * only; a slot that is not equipped is simply absent from the items map.
 */
export class EquippedItemView extends Schema {
  @type('string') slot = '';
  @type('string') shopItemId = '';
  @type('string') shopItemCode = '';
  @type('string') shopItemName = '';
  @type('string') kind = '';
}

/** The member's public appearance: base avatar plus equipped items keyed by slot name (#114). */
export class AvatarAppearance extends Schema {
  @type('string') bodyId = '';
  @type('string') hairId = '';
  @type('string') topId = '';
  @type('string') hairColor = '';
  @type('string') clothingColor = '';
  @type({ map: EquippedItemView }) items = new MapSchema<EquippedItemView>();
}

/**
 * One user in the classroom. A user has a single avatar however many connections they hold.
 * `status` is `'online'` or `'reconnecting'` (see `AVATAR_STATUSES` in `@aula/contracts`); it is a
 * plain string here because the generated client types must not depend on server imports.
 */
export class Avatar extends Schema {
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('string') role = '';
  @type(AvatarAppearance) appearance = new AvatarAppearance();
  /** Internal ordering token; deliberately excluded from synchronized client state. */
  appearanceRevision = 0;
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
  /**
   * Student desks of the classroom. The client builds the same walkable layout the server collides
   * against with `buildClassroomLayout(deskCount)` (#79), so this always mirrors the server's layout.
   */
  @type('uint16') deskCount = 12;
  @type({ map: Avatar }) avatars = new MapSchema<Avatar>();
  /** A class voice call is running; clients show the join banner (#149). */
  @type('boolean') classCallActive = false;
  /** Focus mode: students cannot move and the client hides the 3D world (#149). */
  @type('boolean') focusMode = false;
}
