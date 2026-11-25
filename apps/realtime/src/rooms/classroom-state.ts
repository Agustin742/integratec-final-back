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
 * A server-driven NPC of the classroom: the pet or the tutor bot (#147). Every enum-like field is a
 * plain string here (generated client types must not depend on server imports): `id` is an
 * `NPC_IDS` entry, `state` a `NpcState`, `emote` a name from `NPC_EMOTES`.
 */
export class Npc extends Schema {
  @type('string') id = '';
  @type('float32') x = 0;
  @type('float32') z = 0;
  /** Facing angle in radians around the vertical axis, same convention as {@link Avatar.rotation}. */
  @type('float32') rotation = 0;
  @type('string') state = 'idle';
  /** Emote or clip name being played, `''` when none. */
  @type('string') emote = '';
  /** `''`, `'greet'`, `'askForPets'` or `'phrase'`: the reaction to a member pressing E. */
  @type('string') reaction = '';
  /** Index into `TUTOR_BOT_PHRASES` while `reaction` is `'phrase'`, `-1` otherwise. */
  @type('int16') phraseId = -1;
  /** Increments on every new reaction so clients can replay the same reaction twice in a row. */
  @type('uint32') reactionSeq = 0;
  /** Connection (session) that triggered the current reaction, `''` when none. */
  @type('string') reactingSessionId = '';
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
  /** The pet and the tutor bot, keyed by NPC id (#147). */
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
}
