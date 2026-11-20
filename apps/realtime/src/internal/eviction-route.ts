import type { Application } from 'express';
import { z } from 'zod';
import { hasValidServiceSecret } from './service-auth';
import type { EvictionFilter } from '../rooms/room-directory';

export const EVICTION_PATH = '/internal/evictions';

export interface EvictionRouteOptions {
  serviceSecret: string;
  directory: { evict(filter: EvictionFilter): number };
}

const evictionSchema = z.strictObject({
  userId: z.uuid(),
  classroomId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});

/**
 * Mounts the internal route NestJS calls when a user loses access: it closes the matching
 * connections with `4001` and blocks their reconnection. It is for service-to-service use only:
 * the reverse proxy must never route `/internal/*`, and every call needs the service secret.
 * The answer is a bare 204 whether or not anything matched, so it reveals nothing and a retry is
 * harmless.
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
}
