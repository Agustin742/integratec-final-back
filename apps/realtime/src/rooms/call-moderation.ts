import type { CallModerate } from '@aula/contracts';
import { isCallModerator } from './call-key';
import type { CallParticipant, CallState } from './call-state';

/** Silences a participant for the whole room: forced mute plus no speaking indicator. */
function forceMute(participant: CallParticipant): void {
  participant.forcedMuted = true;
  participant.speaking = false;
}

function participantsOfUser(state: CallState, userId: string): CallParticipant[] {
  return [...state.participants.values()].filter((participant) => participant.userId === userId);
}

/**
 * Applies one moderator action to the call state. The caller has already established that the
 * sender is a moderator of a classroom call; this only decides what the action does.
 *
 * - Forced mute never targets moderators (a teacher cannot be silenced by another teacher's
 *   mute-all, and mute-all would otherwise gag the host).
 * - `unmute` only lifts the forced mute: whether the student's own mic is open (`selfMuted`) stays
 *   their choice.
 * - Focus mode is stored here; mirroring it to the classroom room is the call room's job.
 */
export function applyCallModeration(state: CallState, action: CallModerate): void {
  switch (action.action) {
    case 'mute-all':
      for (const participant of state.participants.values()) {
        if (!isCallModerator(participant.role)) forceMute(participant);
      }
      return;
    case 'mute':
      for (const participant of participantsOfUser(state, action.targetUserId)) {
        if (!isCallModerator(participant.role)) forceMute(participant);
      }
      return;
    case 'unmute':
      for (const participant of participantsOfUser(state, action.targetUserId)) {
        participant.forcedMuted = false;
      }
      return;
    case 'allow-self-unmute':
      state.allowSelfUnmute = action.value;
      return;
    case 'focus-mode':
      state.focusMode = action.value;
      return;
  }
}

/** Is any current participant a moderator? */
export function hasCallModerator(state: CallState): boolean {
  return [...state.participants.values()].some((participant) => isCallModerator(participant.role));
}
