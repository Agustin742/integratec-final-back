import { CLASSROOM_ROOM_NAME } from '@aula/contracts';
import config from '@colyseus/tools';
import type { JoinVerifier } from './join/join-verifier';
import { createClassroomRoom, type ClassroomRoomOptions } from './rooms/classroom-room';
import { RoomDirectory } from './rooms/room-directory';
import { configureExpress } from './server';

export interface AppOptions extends Omit<ClassroomRoomOptions, 'directory'> {
  /**
   * Shared secret for the internal routes. Without it the internal eviction route is not mounted
   * (tests that do not exercise it).
   */
  internalServiceSecret?: string;
}

/**
 * Builds the Colyseus app config around a join verifier. The verifier and the options are
 * injected (not read from the environment here) so `start` stays the only place that validates
 * configuration.
 */
export function createAppConfig(verifier: JoinVerifier, options: AppOptions = {}) {
  const { internalServiceSecret, ...roomOptions } = options;
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
    },
  });
}
