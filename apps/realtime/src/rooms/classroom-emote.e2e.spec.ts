import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  AVATAR_EMOTE_COOLDOWN_MS,
  AVATAR_EMOTE_MESSAGE,
  AVATAR_EMOTED_EVENT,
  AVATAR_EMOTES,
  AVATAR_INPUT_MESSAGE,
  CLASSROOM_ROOM_NAME,
  INPUT_RATE_LIMIT_PER_SECOND,
  type AvatarEmoted,
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

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

describe('ClassroomRoom avatar emotes (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  let nowMs = 0;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier, { now: () => nowMs }), 2579);
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

  /** Joins and records every emote notification the connection receives. */
  const join = async (user: StubUser): Promise<{ room: SdkRoom; seen: AvatarEmoted[] }> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
    const seen: AvatarEmoted[] = [];
    room.onMessage(AVATAR_EMOTED_EVENT, (payload: AvatarEmoted) => seen.push(payload));
    return { room, seen };
  };

  it('shows the whole room each emote with the sender taken from the session', async () => {
    const adaClient = await join(ada);
    const bobClient = await join(bob);
    expect(AVATAR_EMOTES).toEqual(['Wave', 'Cheer', 'Clap', 'Dance', 'RaiseHand']);

    for (const emote of AVATAR_EMOTES) {
      adaClient.room.send(AVATAR_EMOTE_MESSAGE, { emote });
      await waitUntil(() => bobClient.seen.at(-1)?.emote === emote, `bob sees ${emote}`);
      nowMs += AVATAR_EMOTE_COOLDOWN_MS;
    }

    const expected = AVATAR_EMOTES.map((emote) => ({ userId: ada.userId, emote }));
    expect(bobClient.seen).toEqual(expected);
    await waitUntil(() => adaClient.seen.length === expected.length, 'ada sees her own emotes');
    expect(adaClient.seen).toEqual(expected);
  });

  it('drops emotes during the per-member cooldown, across connections of the member', async () => {
    const first = await join(ada);
    const second = await join(ada);
    const observer = await join(bob);

    first.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Wave' });
    await waitUntil(() => observer.seen.length === 1, 'first emote');
    nowMs += AVATAR_EMOTE_COOLDOWN_MS - 1;
    second.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Clap' });
    await sleep(150);
    expect(observer.seen).toHaveLength(1);

    // The cooldown is per member: another member is not affected.
    observer.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Cheer' });
    await waitUntil(() => observer.seen.length === 2, 'bob emotes');

    nowMs += 1; // the dropped attempt did not extend the cooldown
    second.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Dance' });
    await waitUntil(() => observer.seen.length === 3, 'ada emotes again');
    expect(observer.seen.at(-1)).toEqual({ userId: ada.userId, emote: 'Dance' });
  });

  it('drops an emote once the connection spent its message budget', async () => {
    const adaClient = await join(ada);

    // The clock is frozen, so the bucket does not refill.
    for (let i = 0; i < INPUT_RATE_LIMIT_PER_SECOND; i++) {
      adaClient.room.send(AVATAR_INPUT_MESSAGE, { x: 0, z: 0 });
    }
    adaClient.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Wave' });
    await sleep(200);
    expect(adaClient.seen).toEqual([]);

    nowMs += 1_000;
    adaClient.room.send(AVATAR_EMOTE_MESSAGE, { emote: 'Wave' });
    await waitUntil(() => adaClient.seen.length === 1, 'emote once the budget refills');
  });

  it.each([
    ['an unknown emote', { emote: 'Backflip' }],
    ['a missing emote', {}],
    ['a spoofed sender', { emote: 'Wave', userId: bob.userId }],
    ['no payload', undefined],
  ])('rejects %s and closes that connection', async (_label, payload) => {
    const observer = await join(bob);
    const bad = await join(ada);
    let left = false;
    bad.room.onLeave(() => {
      left = true;
    });

    bad.room.send(AVATAR_EMOTE_MESSAGE, payload);

    await waitUntil(() => left, 'offending connection closed');
    expect(observer.seen).toEqual([]);
  });
});
