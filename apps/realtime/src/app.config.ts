import { CALL_ROOM_NAME, CLASSROOM_ROOM_NAME } from '@aula/contracts';
import config from '@colyseus/tools';
import type { JoinVerifier } from './join/join-verifier';
import { createCallRoom } from './rooms/call-room';
import { createClassroomRoom, type ClassroomRoomOptions } from './rooms/classroom-room';
import { RoomDirectory } from './rooms/room-directory';
import { configureExpress } from './server';

export interface AppOptions extends Omit<ClassroomRoomOptions, 'directory'> {
  /** Participants one call admits; defaults to `CALL_MAX_PARTICIPANTS` from the contracts. */
  callMaxParticipants?: number;
  /** Milliseconds a direct call rings before it times out; defaults to 30 seconds. */
  callRingTimeoutMs?: number;
  /**
   * Shared secret for the internal routes. Without it the internal eviction route is not mounted
   * (or chat broadcast route; tests that do not exercise them).
   */
  internalServiceSecret?: string;
}

/**
 * Builds the Colyseus app config around a join verifier. The verifier and the options are
 * injected (not read from the environment here) so `start` stays the only place that validates
 * configuration.
 */
export function createAppConfig(verifier: JoinVerifier, options: AppOptions = {}) {
  const { internalServiceSecret, callMaxParticipants, callRingTimeoutMs, ...roomOptions } = options;
  // Rooms announce themselves here so the internal eviction route can find them.
  const directory = new RoomDirectory();
  return config({
    initializeExpress: (app) => {
      configureExpress(app, {
        internal:
          internalServiceSecret === undefined
            ? undefined
            : { serviceSecret: internalServiceSecret, directory },
      });
    },
    initializeGameServer: (gameServer) => {
      // One room per classroom: matchmaking filters on the `classroomId` join option.
      gameServer
        .define(CLASSROOM_ROOM_NAME, createClassroomRoom(verifier, { ...roomOptions, directory }))
        .filterBy(['classroomId']);
      // One room per call: `callKey` is derived on the server during `onAuth` (never sent by the
      // client, which the strict join options enforce), so it is what keeps one call in one room.
      gameServer
        .define(
          CALL_ROOM_NAME,
          createCallRoom(verifier, {
            now: roomOptions.now,
            maxParticipants: callMaxParticipants,
            ringTimeoutMs: callRingTimeoutMs,
            directory,
          }),
        )
        .filterBy(['callKey']);
    },
  });
}
