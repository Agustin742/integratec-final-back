import { MapSchema, Schema, type } from '@colyseus/schema';
import { AvatarAppearance } from './classroom-state';

/**
 * One participant of a call, keyed by session id in `CallState.participants`. `appearance` reuses the
 * classroom avatar appearance so the client renders the same avatar. `emoteSeq` increments on every
 * emote so a repeated emote still triggers the client animation.
 */
export class CallParticipant extends Schema {
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('string') role = '';
  @type('boolean') selfMuted = false;
  @type('boolean') forcedMuted = false;
  @type('boolean') speaking = false;
  /** Current emote (one of `CALL_EMOTES` in `@aula/contracts`) or '' when none. */
  @type('string') emote = '';
  @type('uint32') emoteSeq = 0;
  @type(AvatarAppearance) appearance = new AvatarAppearance();
}

/**
 * Synchronized state of a call room. `kind` is `'classroom'` or `'direct'` (see `CALL_KINDS` in
 * `@aula/contracts`); plain string so generated client types do not depend on server imports.
 */
export class CallState extends Schema {
  @type('string') kind = 'classroom';
  @type('string') classroomId = '';
  @type('string') hostUserId = '';
  @type('boolean') focusMode = false;
  @type('boolean') allowSelfUnmute = false;
  @type({ map: CallParticipant }) participants = new MapSchema<CallParticipant>();
}
