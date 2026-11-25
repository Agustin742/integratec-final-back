import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  AVATAR_INPUT_MESSAGE,
  buildClassroomLayout,
  CLASSROOM_ROOM_NAME,
  deriveNpcHomes,
  INPUT_RATE_LIMIT_PER_SECOND,
  MIN_CLASSROOM_DESKS,
  NPC_INTERACT_MESSAGE,
  TUTOR_BOT_PHRASES,
} from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';
import {
  STUB_SECRET,
  makeUser,
  startStubApi,
  type StubApi,
  type StubUser,
} from '../testing/stub-api';
import { sleep, waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const HOMES = deriveNpcHomes(buildClassroomLayout(MIN_CLASSROOM_DESKS));

describe('ClassroomRoom NPC interaction (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  let nowMs = 0;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier, { now: () => nowMs }), 2578);
  });

  beforeEach(() => {
    nowMs = 1_000_000;
  });

  afterEach(async () => {
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  const join = (user: StubUser): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    return colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  /** Client-side decoded NPC; undefined until the client has decoded the room state. */
  const decodedBot = (room: SdkRoom) =>
    (
      room.state as unknown as {
        npcs?: Map<string, { state: string; reaction: string; phraseId: number }>;
      }
    ).npcs?.get('tutorBot');

  it('shows the whole room the tutor bot reaction a member triggered', async () => {
    const adaRoom = await join(ada);
    const bobRoom = await join(bob);
    const avatar = serverRoom(adaRoom).state.avatars.get(ada.userId)!;
    avatar.x = HOMES.tutorBot.x + 1;
    avatar.z = HOMES.tutorBot.z;

    adaRoom.send(NPC_INTERACT_MESSAGE, { npcId: 'tutorBot' });

    await waitUntil(() => decodedBot(bobRoom)?.reaction === 'phrase', 'bob sees the reaction');
    const seenByBob = decodedBot(bobRoom)!;
    expect(seenByBob.state).toBe('reacting');
    expect(seenByBob.phraseId).toBeGreaterThanOrEqual(0);
    expect(seenByBob.phraseId).toBeLessThan(TUTOR_BOT_PHRASES.length);
    await waitUntil(() => decodedBot(adaRoom)?.reaction === 'phrase', 'ada sees it too');
  });

  it('drops avatar input after an npc:interact burst spends the shared connection budget', async () => {
    const adaRoom = await join(ada);
    const avatar = serverRoom(adaRoom).state.avatars.get(ada.userId)!;
    const startX = avatar.x;

    // The clock is frozen, so the bucket does not refill: only the first 30 messages count.
    for (let i = 0; i < INPUT_RATE_LIMIT_PER_SECOND; i++) {
      adaRoom.send(NPC_INTERACT_MESSAGE, { npcId: 'tutorBot' });
    }
    adaRoom.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });
    await sleep(200);

    expect(avatar.x).toBe(startX); // over budget: dropped silently
    expect(serverRoom(adaRoom).clients).toHaveLength(1); // not even disconnected

    nowMs += 1_000; // one second later the budget is back
    adaRoom.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });
    await waitUntil(() => avatar.x > startX + 0.3, 'avatar moves once the budget refills');
  });

  it.each([
    ['an unknown npc id', { npcId: 'dog' }],
    ['a missing npc id', {}],
    ['an extra field', { npcId: 'pet', speed: 100 }],
    ['no payload', undefined],
  ])('rejects %s and closes that connection', async (_label, payload) => {
    const good = await join(ada);
    const bad = await join(ada);
    const pet = serverRoom(good).state.npcs.get('pet')!;
    const before = { reaction: pet.reaction, reactionSeq: pet.reactionSeq };

    bad.send(NPC_INTERACT_MESSAGE, payload);

    await waitUntil(() => serverRoom(good).clients.length === 1, 'offending connection closed');
    expect({ reaction: pet.reaction, reactionSeq: pet.reactionSeq }).toEqual(before);
  });
});
