import type { Application } from 'express';
import { z } from 'zod';
import { MAX_CLASSROOM_DESKS } from '@aula/contracts';
import { presentedSecret, secretsMatch } from './service-secret';

export const CLASSROOM_LAYOUT_PATH = '/internal/classroom-layout';

export interface ClassroomLayoutRouteOptions {
  serviceSecret: string;
  directory: {
    applyDeskCount(classroomId: string, deskCount: number): void;
  };
}

const classroomLayoutSchema = z.strictObject({
  classroomId: z.uuid(),
  deskCount: z.number().int().min(0).max(MAX_CLASSROOM_DESKS),
});

/**
 * Mounts the internal route NestJS calls when desks are added to a classroom (auto-expansion,
 * #79): it tells the classroom's live rooms the new desk count so they rebuild their layout. The
 * rooms only ever grow, so a replayed or reordered delivery cannot shrink one. For
 * service-to-service use only: the reverse proxy must never route `/internal/*`, and every call
 * needs the service secret.
 *
 * The answer is a bare 204 whether or not a room was live: it reveals nothing, and delivery is
 * at-least-once, so a replay after a partial outage must succeed as a no-op.
 */
export function mountClassroomLayoutRoute(
  app: Application,
  options: ClassroomLayoutRouteOptions,
): void {
  app.post(CLASSROOM_LAYOUT_PATH, (req, res) => {
    const secret = presentedSecret(req);
    if (secret === undefined || !secretsMatch(secret, options.serviceSecret)) {
      res.sendStatus(401);
      return;
    }
    const parsed = classroomLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.sendStatus(400);
      return;
    }
    options.directory.applyDeskCount(parsed.data.classroomId, parsed.data.deskCount);
    res.sendStatus(204);
  });
}
