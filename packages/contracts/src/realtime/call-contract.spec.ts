import { describe, it, expect } from 'vitest';
import {
  CALL_DECLINE_MESSAGE,
  CALL_DECLINED_EVENT,
  CALL_EMOTES,
  CALL_EMOTE_MESSAGE,
  CALL_END_MESSAGE,
  CALL_ENDED_EVENT,
  CALL_INCOMING_EVENT,
  CALL_MAX_PARTICIPANTS,
  CALL_MODERATE_MESSAGE,
  CALL_ROOM_NAME,
  CALL_SELF_MESSAGE,
  CALL_SIGNAL_MESSAGE,
  CLOSE_CODE_CALL_ENDED,
  CLOSE_CODE_CALL_FULL,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_CALL_ENDED,
  CLOSE_REASON_CALL_FULL,
  callDeclineSchema,
  callDeclinedPayloadSchema,
  callEmoteSchema,
  callEndSchema,
  callEndedPayloadSchema,
  callIncomingPayloadSchema,
  callJoinOptionsSchema,
  callModerateSchema,
  callSelfSchema,
  callSignalPayloadSchema,
  callSignalRelaySchema,
  callSignalSchema,
} from '../index';

const ID = '3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c';
const OTHER_ID = '7a1c2d3e-4b5f-4a6b-9c7d-8e9f0a1b2c3d';

describe('call room contract', () => {
  it('pins names and limits', () => {
    expect(CALL_ROOM_NAME).toBe('call');
    expect(CALL_MAX_PARTICIPANTS).toBe(12);
    expect(CALL_SIGNAL_MESSAGE).toBe('call:signal');
    expect(CALL_SELF_MESSAGE).toBe('call:self');
    expect(CALL_EMOTE_MESSAGE).toBe('call:emote');
    expect(CALL_MODERATE_MESSAGE).toBe('call:moderate');
    expect(CALL_END_MESSAGE).toBe('call:end');
    expect(CALL_DECLINE_MESSAGE).toBe('call:decline');
    expect(CALL_INCOMING_EVENT).toBe('call:incoming');
    expect(CALL_DECLINED_EVENT).toBe('call:declined');
    expect(CALL_ENDED_EVENT).toBe('call:ended');
    expect(CALL_EMOTES).toEqual(['wave', 'happy', 'sad', 'angry', 'think', 'celebrate']);
  });

  it('adds close codes outside the Colyseus and existing room codes', () => {
    const taken = [
      4000,
      4001,
      4002,
      4003,
      4010,
      CLOSE_CODE_ACCESS_REVOKED,
      CLOSE_CODE_TOO_MANY_CONNECTIONS,
      CLOSE_CODE_VERIFICATION_UNAVAILABLE,
    ];
    expect(CLOSE_CODE_CALL_FULL).toBe(4101);
    expect(CLOSE_CODE_CALL_ENDED).toBe(4102);
    expect(taken).not.toContain(CLOSE_CODE_CALL_FULL);
    expect(taken).not.toContain(CLOSE_CODE_CALL_ENDED);
    expect(CLOSE_REASON_CALL_FULL).toBe('call_full');
    expect(CLOSE_REASON_CALL_ENDED).toBe('call_ended');
  });

  describe('join options', () => {
    it.each([
      { classroomId: ID, kind: 'classroom' },
      { classroomId: ID, kind: 'direct', peerUserId: OTHER_ID },
    ])('accepts %j', (payload) => {
      expect(callJoinOptionsSchema.safeParse(payload).success).toBe(true);
    });

    it.each([
      ['direct without a peer', { classroomId: ID, kind: 'direct' }],
      ['classroom with a peer', { classroomId: ID, kind: 'classroom', peerUserId: OTHER_ID }],
      ['a non-uuid classroom', { classroomId: 'x', kind: 'classroom' }],
      ['an unknown kind', { classroomId: ID, kind: 'group' }],
      ['an extra field', { classroomId: ID, kind: 'classroom', extra: 1 }],
    ])('rejects %s', (_label, payload) => {
      expect(callJoinOptionsSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe('call:signal', () => {
    const offer = { type: 'offer', sdp: 'v=0' } as const;
    const ice = {
      type: 'ice',
      candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' },
    } as const;

    it.each([
      { to: 'abc123', payload: offer },
      { to: 'abc123', payload: { type: 'answer', sdp: 'v=0' } },
      { to: 'abc123', payload: ice },
      {
        to: 'abc123',
        payload: { type: 'ice', candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: 0 } },
      },
      {
        to: 'abc123',
        payload: { type: 'ice', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: null } },
      },
    ])('accepts %j', (payload) => {
      expect(callSignalSchema.safeParse(payload).success).toBe(true);
    });

    it.each([
      ['an oversized sdp', { to: 'a', payload: { type: 'offer', sdp: 'x'.repeat(16001) } }],
      [
        'an oversized candidate',
        { to: 'a', payload: { type: 'ice', candidate: { candidate: 'x'.repeat(2049) } } },
      ],
      ['an empty target', { to: '', payload: offer }],
      ['an oversized target', { to: 'x'.repeat(65), payload: offer }],
      ['an unknown payload type', { to: 'a', payload: { type: 'pranswer', sdp: 'v=0' } }],
      ['an extra field', { to: 'a', payload: offer, extra: 1 }],
      ['an extra payload field', { to: 'a', payload: { ...offer, extra: 1 } }],
      [
        'a negative mline index',
        { to: 'a', payload: { type: 'ice', candidate: { candidate: 'c', sdpMLineIndex: -1 } } },
      ],
      [
        'a fractional mline index',
        { to: 'a', payload: { type: 'ice', candidate: { candidate: 'c', sdpMLineIndex: 0.5 } } },
      ],
    ])('rejects %s', (_label, payload) => {
      expect(callSignalSchema.safeParse(payload).success).toBe(false);
    });

    it('validates the relayed shape with the sender session id', () => {
      expect(callSignalRelaySchema.safeParse({ from: 's1', payload: offer }).success).toBe(true);
      expect(callSignalRelaySchema.safeParse({ to: 's1', payload: offer }).success).toBe(false);
      expect(callSignalPayloadSchema.safeParse(offer).success).toBe(true);
    });
  });

  describe('call:self', () => {
    it.each([{ muted: true }, { speaking: false }, { muted: false, speaking: true }])(
      'accepts %j',
      (p) => {
        expect(callSelfSchema.safeParse(p).success).toBe(true);
      },
    );
    it.each([
      ['an empty object', {}],
      ['a non-boolean', { muted: 'yes' }],
      ['an extra field', { muted: true, extra: 1 }],
    ])('rejects %s', (_l, p) => {
      expect(callSelfSchema.safeParse(p).success).toBe(false);
    });
  });

  describe('call:emote', () => {
    it.each(['wave', 'happy', 'sad', 'angry', 'think', 'celebrate'])('accepts %s', (emote) => {
      expect(callEmoteSchema.safeParse({ emote }).success).toBe(true);
    });
    it.each([{ emote: 'dance' }, {}, { emote: 'wave', extra: 1 }])('rejects %j', (p) => {
      expect(callEmoteSchema.safeParse(p).success).toBe(false);
    });
  });

  describe('call:moderate', () => {
    it.each([
      { action: 'mute-all' },
      { action: 'mute', targetUserId: ID },
      { action: 'unmute', targetUserId: ID },
      { action: 'allow-self-unmute', value: true },
      { action: 'focus-mode', value: false },
    ])('accepts %j', (p) => {
      expect(callModerateSchema.safeParse(p).success).toBe(true);
    });
    it.each([
      ['mute without a target', { action: 'mute' }],
      ['a non-uuid target', { action: 'unmute', targetUserId: 'x' }],
      ['focus-mode without a value', { action: 'focus-mode' }],
      ['a non-boolean value', { action: 'allow-self-unmute', value: 1 }],
      ['mute-all with a field', { action: 'mute-all', targetUserId: ID }],
      ['an unknown action', { action: 'kick', targetUserId: ID }],
    ])('rejects %s', (_l, p) => {
      expect(callModerateSchema.safeParse(p).success).toBe(false);
    });
  });

  it('call:end takes an empty object only', () => {
    expect(callEndSchema.safeParse({}).success).toBe(true);
    expect(callEndSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('call:decline needs the caller user id', () => {
    expect(callDeclineSchema.safeParse({ callerUserId: ID }).success).toBe(true);
    expect(callDeclineSchema.safeParse({ callerUserId: 'x' }).success).toBe(false);
    expect(callDeclineSchema.safeParse({}).success).toBe(false);
  });

  describe('server events', () => {
    it('validates call:incoming', () => {
      const ok = { classroomId: ID, callerUserId: OTHER_ID, callerDisplayName: 'Ada' };
      expect(callIncomingPayloadSchema.safeParse(ok).success).toBe(true);
      expect(callIncomingPayloadSchema.safeParse({ ...ok, callerDisplayName: '' }).success).toBe(
        false,
      );
      expect(callIncomingPayloadSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    });
    it('validates call:declined', () => {
      expect(callDeclinedPayloadSchema.safeParse({ byUserId: ID }).success).toBe(true);
      expect(callDeclinedPayloadSchema.safeParse({ byUserId: 'x' }).success).toBe(false);
    });
    it('validates call:ended with a known reason', () => {
      expect(callEndedPayloadSchema.safeParse({ reason: 'moderator_ended' }).success).toBe(true);
      expect(callEndedPayloadSchema.safeParse({ reason: 'whatever' }).success).toBe(false);
    });
  });
});
