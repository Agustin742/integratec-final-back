import type { Application } from 'express';
import { z } from 'zod';
import { mountAppearanceRoute } from './appearance-route';
import { mountClassroomLayoutRoute } from './classroom-layout-route';
import { mountClassroomTutorBotSkinRoute } from './classroom-tutor-bot-skin-route';
import { hasValidServiceSecret } from './service-auth';
import type { RoomDirectoryLike } from '../rooms/room-directory';

export const EVICTION_PATH = '/internal/evictions';

export interface EvictionRouteOptions {
  serviceSecret: string;
  /** The live rooms: evictions close connections, appearance updates write avatar state. */
  directory: RoomDirectoryLike;
}

const evictionSchema = z.strictObject({
  userId: z.uuid(),
  classroomId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});

/**
 * Mounts the internal service-to-service routes of this process: evictions (a user lost access)
 * appearance updates (a member's look changed, #114), classroom layout updates (desks were
 * added, #79) and tutor bot skin changes (#154). They share the service secret and the
 * room directory, so they are mounted together by this one call, which `server.ts` makes when
 * internal options are present. These routes are for service-to-service use only: the reverse
 * proxy must never route `/internal/*`, and every call needs the service secret. Each answers a
 * bare 204 whether or not anything matched, so it reveals nothing and a retry is harmless.
 */
export function mountEvictionRoute(app: Application, options: EvictionRouteOptions): void {
  app.post(EVICTION_PATH, (req, res) => {
    if (!hasValidServiceSecret(req, options.serviceSecret)) {
      res.sendStatus(401);
      return;
    }
    const parsed = evictionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.sendStatus(400);
      return;
    }
    options.directory.evict(parsed.data);
    res.sendStatus(204);
  });
  mountAppearanceRoute(app, options);
  mountClassroomLayoutRoute(app, options);
  mountClassroomTutorBotSkinRoute(app, options);
}
