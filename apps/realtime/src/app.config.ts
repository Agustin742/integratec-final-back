import { CLASSROOM_ROOM_NAME } from '@aula/contracts';
import config from '@colyseus/tools';
import type { JoinVerifier } from './join/join-verifier';
import { createClassroomRoom, type ClassroomRoomOptions } from './rooms/classroom-room';
import { configureExpress } from './server';

/**
 * Builds the Colyseus app config around a join verifier. The verifier is injected (not read from
 * the environment here) so `start` stays the only place that validates configuration.
 */
export function createAppConfig(verifier: JoinVerifier, options: ClassroomRoomOptions = {}) {
  return config({
    initializeExpress: (app) => {
      configureExpress(app);
    },
    initializeGameServer: (gameServer) => {
      // One room per classroom: matchmaking filters on the `classroomId` join option.
      gameServer
        .define(CLASSROOM_ROOM_NAME, createClassroomRoom(verifier, options))
        .filterBy(['classroomId']);
    },
  });
}
