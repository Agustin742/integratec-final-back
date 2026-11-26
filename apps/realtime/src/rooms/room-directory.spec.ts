import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  type ChatRealtimeBroadcast,
} from '@aula/contracts';
import { RoomDirectory } from './room-directory';

const room = (result = 1) => ({
  evict: vi.fn().mockReturnValue(result),
  applyAppearance: vi.fn().mockReturnValue(result > 0),
  applyDeskCount: vi.fn(),
  applyCallStatus: vi.fn(),
  sendToUser: vi.fn().mockReturnValue(1),
  broadcastChatMessage: vi.fn(),
  broadcastChatMessageHidden: vi.fn(),
});
const APPEARANCE = {
  baseAvatar: {
    bodyId: 'female',
    hairId: 'afro',
    topId: 'basic-tshirt',
    hairColor: '#353849',
    clothingColor: '#75B7DA',
  },
  items: { head: null, face: null, back: null, desk_decor: null },
} as const;
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const FOREIGN = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';

describe('RoomDirectory call rooms', () => {
  it('evicts from the call rooms of the classroom too, and forgets them once unregistered', () => {
    const directory = new RoomDirectory();
    const call = { evict: vi.fn().mockReturnValue(1) };
    directory.registerCall('A', call);

    expect(directory.evict({ userId: 'u', classroomId: 'A' })).toBe(1);
    expect(directory.evict({ userId: 'u', classroomId: 'B' })).toBe(0);
    expect(directory.evict({ userId: 'u' })).toBe(1);

    directory.unregisterCall('A', call);
    expect(directory.evict({ userId: 'u', classroomId: 'A' })).toBe(0);
  });
});

describe('RoomDirectory', () => {
  it('evicts from the room of the given classroom only', () => {
    const directory = new RoomDirectory();
    const a = room();
    const b = room();
    directory.register('A', a);
    directory.register('B', b);

    expect(directory.evict({ userId: 'u', classroomId: 'A' })).toBe(1);

    expect(a.evict).toHaveBeenCalledExactlyOnceWith({ userId: 'u' });
    expect(b.evict).not.toHaveBeenCalled();
  });

  it('evicts from every room when no classroom is given and sums the connections', () => {
    const directory = new RoomDirectory();
    directory.register('A', room(2));
    directory.register('B', room(1));

    expect(directory.evict({ userId: 'u', sessionId: 's' })).toBe(3);
  });

  it('forwards the session filter to the rooms', () => {
    const directory = new RoomDirectory();
    const a = room();
    directory.register('A', a);

    directory.evict({ userId: 'u', sessionId: 's' });

    expect(a.evict).toHaveBeenCalledExactlyOnceWith({ userId: 'u', sessionId: 's' });
  });

  it('forgets a room once it is unregistered', () => {
    const directory = new RoomDirectory();
    const a = room();
    directory.register('A', a);
    directory.unregister('A', a);

    expect(directory.evict({ userId: 'u' })).toBe(0);
    expect(a.evict).not.toHaveBeenCalled();
  });

  it('keeps every room when two are registered for one classroom', () => {
    const directory = new RoomDirectory();
    const first = room();
    const second = room();
    directory.register('A', first);
    directory.register('A', second);
    directory.unregister('A', first);

    directory.evict({ userId: 'u', classroomId: 'A' });

    expect(first.evict).not.toHaveBeenCalled();
    expect(second.evict).toHaveBeenCalledTimes(1);
  });

  it('matches nothing for an unknown classroom', () => {
    expect(new RoomDirectory().evict({ userId: 'u', classroomId: 'nope' })).toBe(0);
  });

  it('applies an appearance only to the rooms of the given classroom', () => {
    const directory = new RoomDirectory();
    const a = room();
    const b = room();
    directory.register('A', a);
    directory.register('B', b);

    expect(directory.applyAppearance('A', 'u', 3, APPEARANCE)).toBe(1);

    expect(a.applyAppearance).toHaveBeenCalledExactlyOnceWith('u', 3, APPEARANCE);
    expect(b.applyAppearance).not.toHaveBeenCalled();
  });

  it('reports how many rooms actually had that avatar', () => {
    const directory = new RoomDirectory();
    const withAvatar = room(1);
    const withoutAvatar = room(0);
    directory.register('A', withAvatar);
    directory.register('A', withoutAvatar);

    expect(directory.applyAppearance('A', 'u', 3, APPEARANCE)).toBe(1);
  });

  it('applies nothing for an unknown classroom', () => {
    expect(new RoomDirectory().applyAppearance('nope', 'u', 3, APPEARANCE)).toBe(0);
  });

  it('applies a desk count only to the rooms of the given classroom', () => {
    const directory = new RoomDirectory();
    const a = room();
    const twin = room();
    const other = room();
    directory.register(CLASSROOM, a);
    directory.register(CLASSROOM, twin);
    directory.register(FOREIGN, other);

    directory.applyDeskCount(CLASSROOM, 13);

    expect(a.applyDeskCount).toHaveBeenCalledExactlyOnceWith(13);
    expect(twin.applyDeskCount).toHaveBeenCalledExactlyOnceWith(13);
    expect(other.applyDeskCount).not.toHaveBeenCalled();
  });

  it('applies a desk count to nothing for an unknown classroom', () => {
    expect(() => new RoomDirectory().applyDeskCount(CLASSROOM, 13)).not.toThrow();
  });

  it('broadcasts chat events to every room for that classroom and nowhere else', () => {
    const directory = new RoomDirectory();
    const first = room();
    const second = room();
    const foreign = room();
    directory.register(CLASSROOM, first);
    directory.register(CLASSROOM, second);
    directory.register(FOREIGN, foreign);
    const message = {
      id: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
      classroomId: CLASSROOM,
      authorId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
      body: 'Hello',
      mentionedUserIds: [],
      createdAt: '2026-11-19T12:00:00.000Z',
    };
    const event: ChatRealtimeBroadcast = {
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_EVENT,
      payload: message,
    };

    directory.broadcastChatEvent(event);

    expect(first.broadcastChatMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(second.broadcastChatMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(foreign.broadcastChatMessage).not.toHaveBeenCalled();

    const hidden: ChatRealtimeBroadcast = {
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: {
        messageId: message.id,
        hiddenAt: '2026-11-19T12:01:00.000Z',
      },
    };
    directory.broadcastChatEvent(hidden);
    expect(first.broadcastChatMessageHidden).toHaveBeenCalledExactlyOnceWith(hidden.payload);
    expect(second.broadcastChatMessageHidden).toHaveBeenCalledExactlyOnceWith(hidden.payload);
    expect(foreign.broadcastChatMessageHidden).not.toHaveBeenCalled();
  });
});

describe('RoomDirectory class call status', () => {
  const statusRoom = () => room();
  const owner = {};

  it('tells the classroom rooms of that classroom only, and tells a room registered later', () => {
    const directory = new RoomDirectory();
    const here = statusRoom();
    const elsewhere = statusRoom();
    directory.register(CLASSROOM, here);
    directory.register(FOREIGN, elsewhere);

    directory.setClassCallStatus(CLASSROOM, owner, { active: true, focusMode: true });

    expect(here.applyCallStatus).toHaveBeenLastCalledWith({ active: true, focusMode: true });
    expect(elsewhere.applyCallStatus).not.toHaveBeenCalled();
    const late = statusRoom();
    directory.register(CLASSROOM, late);
    expect(late.applyCallStatus).toHaveBeenCalledWith({ active: true, focusMode: true });
  });

  it('resets the rooms when the call is cleared and stops replaying it', () => {
    const directory = new RoomDirectory();
    const here = statusRoom();
    directory.register(CLASSROOM, here);
    directory.setClassCallStatus(CLASSROOM, owner, { active: true, focusMode: true });

    directory.clearClassCallStatus(CLASSROOM, owner);

    expect(here.applyCallStatus).toHaveBeenLastCalledWith({ active: false, focusMode: false });
    const late = statusRoom();
    directory.register(CLASSROOM, late);
    expect(late.applyCallStatus).not.toHaveBeenCalled();
  });

  it('ignores a clear from a call room that no longer owns the status', () => {
    const directory = new RoomDirectory();
    const here = statusRoom();
    directory.register(CLASSROOM, here);
    const oldCall = {};
    const newCall = {};
    directory.setClassCallStatus(CLASSROOM, oldCall, { active: true, focusMode: false });
    directory.setClassCallStatus(CLASSROOM, newCall, { active: true, focusMode: true });
    here.applyCallStatus.mockClear();

    directory.clearClassCallStatus(CLASSROOM, oldCall);

    expect(here.applyCallStatus).not.toHaveBeenCalled();
    const late = statusRoom();
    directory.register(CLASSROOM, late);
    expect(late.applyCallStatus).toHaveBeenCalledWith({ active: true, focusMode: true });
    directory.clearClassCallStatus(CLASSROOM, newCall);
    expect(here.applyCallStatus).toHaveBeenCalledWith({ active: false, focusMode: false });
  });
});

describe('RoomDirectory direct call ringing', () => {
  const ring = () => ({ declineRing: vi.fn() });

  it('sends an event to the live connections of one user in one classroom only', () => {
    const directory = new RoomDirectory();
    const here = room(1);
    const elsewhere = room(1);
    here.sendToUser.mockReturnValue(2);
    directory.register('A', here);
    directory.register('B', elsewhere);

    expect(directory.sendToUser('A', 'u', 'call:incoming', { x: 1 })).toBe(2);
    expect(here.sendToUser).toHaveBeenCalledWith('u', 'call:incoming', { x: 1 });
    expect(elsewhere.sendToUser).not.toHaveBeenCalled();
    expect(directory.sendToUser('C', 'u', 'call:incoming', {})).toBe(0);
  });

  it('declines a ringing call only for exactly that classroom, caller and callee', () => {
    const directory = new RoomDirectory();
    const call = ring();
    directory.registerRing('A', 'caller', 'callee', call);

    expect(directory.declineRing('B', 'caller', 'callee')).toBe(false);
    expect(directory.declineRing('A', 'other', 'callee')).toBe(false);
    expect(directory.declineRing('A', 'caller', 'other')).toBe(false);
    expect(directory.declineRing('A', 'callee', 'caller')).toBe(false);
    expect(call.declineRing).not.toHaveBeenCalled();

    expect(directory.declineRing('A', 'caller', 'callee')).toBe(true);
    expect(call.declineRing).toHaveBeenCalledTimes(1);
  });

  it('forgets a ring once unregistered, and a stale owner cannot unregister a newer ring', () => {
    const directory = new RoomDirectory();
    const first = ring();
    const second = ring();
    directory.registerRing('A', 'caller', 'callee', first);
    directory.registerRing('A', 'caller', 'callee', second);

    directory.unregisterRing('A', 'caller', 'callee', first);
    expect(directory.declineRing('A', 'caller', 'callee')).toBe(true);
    expect(second.declineRing).toHaveBeenCalledTimes(1);

    directory.unregisterRing('A', 'caller', 'callee', second);
    expect(directory.declineRing('A', 'caller', 'callee')).toBe(false);
  });
});
