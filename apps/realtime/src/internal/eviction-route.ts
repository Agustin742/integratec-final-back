import { timingSafeEqual } from 'node:crypto';
import type { Application, Request } from 'express';
import { z } from 'zod';
import { SERVICE_SECRET_HEADER } from '../join/api-join-verifier';
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

/** Constant-time comparison; a length mismatch is rejected first (the length is not a secret). */
function secretsMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes)
  );
}

const presentedSecret = (req: Request): string | undefined => {
  const header = req.headers[SERVICE_SECRET_HEADER];
  return typeof header === 'string' ? header : undefined;
};

/**
 * Mounts the internal route NestJS calls when a user loses access: it closes the matching
 * connections with `4001` and blocks their reconnection. It is for service-to-service use only:
 * the reverse proxy must never route `/internal/*`, and every call needs the service secret.
 * The answer is a bare 204 whether or not anything matched, so it reveals nothing and a retry is
 * harmless.
 */
export function mountEvictionRoute(app: Application, options: EvictionRouteOptions): void {
  app.post(EVICTION_PATH, (req, res) => {
    const secret = presentedSecret(req);
    if (secret === undefined || !secretsMatch(secret, options.serviceSecret)) {
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
