import { describe, expect, it } from 'vitest';
import { applyCallModeration, hasCallModerator } from './call-moderation';
import { CallParticipant, CallState } from './call-state';

const TEACHER = '11111111-1111-4111-8111-111111111111';
const ADA = '22222222-2222-4222-8222-222222222222';
const BOB = '33333333-3333-4333-8333-333333333333';

function build(): CallState {
  const state = new CallState();
  const add = (sessionId: string, userId: string, role: string, speaking = false) => {
    const participant = new CallParticipant();
    participant.userId = userId;
    participant.role = role;
    participant.speaking = speaking;
    state.participants.set(sessionId, participant);
  };
  add('s-teacher', TEACHER, 'TEACHER');
  add('s-ada', ADA, 'STUDENT', true);
  add('s-bob', BOB, 'STUDENT');
  return state;
}
const forced = (state: CallState, sessionId: string) =>
  state.participants.get(sessionId)?.forcedMuted;

describe('applyCallModeration', () => {
  it('mutes every non-moderator on mute-all and silences their speaking flag', () => {
    const state = build();

    applyCallModeration(state, { action: 'mute-all' });

    expect(forced(state, 's-ada')).toBe(true);
    expect(forced(state, 's-bob')).toBe(true);
    expect(forced(state, 's-teacher')).toBe(false);
    expect(state.participants.get('s-ada')?.speaking).toBe(false);
  });

  it('mutes and unmutes one student by user id without touching their own mic choice', () => {
    const state = build();
    const ada = state.participants.get('s-ada')!;
    ada.selfMuted = true;

    applyCallModeration(state, { action: 'mute', targetUserId: ADA });
    expect(ada.forcedMuted).toBe(true);
    expect(forced(state, 's-bob')).toBe(false);

    applyCallModeration(state, { action: 'unmute', targetUserId: ADA });
    expect(ada.forcedMuted).toBe(false);
    expect(ada.selfMuted).toBe(true);
  });

  it('ignores a target that is unknown or a moderator', () => {
    const state = build();

    applyCallModeration(state, { action: 'mute', targetUserId: TEACHER });
    applyCallModeration(state, {
      action: 'mute',
      targetUserId: '44444444-4444-4444-8444-444444444444',
    });

    expect([...state.participants.values()].some((p) => p.forcedMuted)).toBe(false);
  });

  it('sets allow-self-unmute and focus-mode flags', () => {
    const state = build();

    applyCallModeration(state, { action: 'allow-self-unmute', value: false });
    applyCallModeration(state, { action: 'focus-mode', value: true });

    expect(state.allowSelfUnmute).toBe(false);
    expect(state.focusMode).toBe(true);
  });
});

describe('hasCallModerator', () => {
  it('tells whether any participant holds a moderator role', () => {
    const state = build();
    expect(hasCallModerator(state)).toBe(true);

    state.participants.delete('s-teacher');
    expect(hasCallModerator(state)).toBe(false);
  });
});
