import { describe, expect, it } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { AvatarAppearance, ClassroomState } from './classroom-state';
import { CallParticipant, CallState } from './call-state';

describe('CallState', () => {
  it('starts empty with moderation flags off', () => {
    const state = new CallState();
    expect(state).toMatchObject({
      kind: 'classroom',
      classroomId: '',
      hostUserId: '',
      focusMode: false,
      allowSelfUnmute: false,
    });
    expect(state.participants).toBeInstanceOf(MapSchema);
    expect(state.participants.size).toBe(0);
  });

  it('keys participants by session id and reuses the classroom appearance shape', () => {
    const state = new CallState();
    const participant = new CallParticipant();
    participant.userId = 'u1';
    participant.appearance.bodyId = 'female';
    state.participants.set('session-1', participant);
    expect(participant.appearance).toBeInstanceOf(AvatarAppearance);
    expect(participant).toMatchObject({
      selfMuted: false,
      forcedMuted: false,
      speaking: false,
      emote: '',
      emoteSeq: 0,
    });
    expect(state.participants.get('session-1')?.userId).toBe('u1');
  });
});

describe('ClassroomState call flags', () => {
  it('defaults classCallActive and focusMode to false', () => {
    expect(new ClassroomState()).toMatchObject({ classCallActive: false, focusMode: false });
  });
});
