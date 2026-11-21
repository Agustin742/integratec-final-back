import type { Application } from 'express';
import { z } from 'zod';
import { memberAppearanceSchema, type MemberAppearance } from '@aula/contracts';
import { presentedSecret, secretsMatch } from './service-secret';

export const APPEARANCE_PATH = '/internal/appearance';

export interface AppearanceRouteOptions {
  serviceSecret: string;
  directory: {
    applyAppearance(
      classroomId: string,
      userId: string,
      appearanceRevision: number,
      appearance: MemberAppearance,
    ): number;
  };
}

const appearanceSchema = z.strictObject({
  classroomId: z.uuid(),
  userId: z.uuid(),
  appearanceRevision: z.number().int().nonnegative(),
  appearance: memberAppearanceSchema,
});

/**
 * Mounts the internal route NestJS calls when a member's appearance changes: it applies the
 * API-verified snapshot to the user's avatar in that classroom's rooms, which reject stale
 * revisions. For service-to-service use only: the reverse proxy must never route `/internal/*`,
 * and every call needs the service secret. Appearance is applied only from this verified path,
 * never from client messages.
 *
 * The answer is a bare 204 whether or not the room or the avatar existed: it reveals nothing, and
 * delivery is at-least-once, so a replay after a partial outage must succeed as a no-op.
 */
export function mountAppearanceRoute(app: Application, options: AppearanceRouteOptions): void {
  app.post(APPEARANCE_PATH, (req, res) => {
    const secret = presentedSecret(req);
    if (secret === undefined || !secretsMatch(secret, options.serviceSecret)) {
      res.sendStatus(401);
      return;
    }
    const parsed = appearanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.sendStatus(400);
      return;
    }
    options.directory.applyAppearance(
      parsed.data.classroomId,
      parsed.data.userId,
      parsed.data.appearanceRevision,
      parsed.data.appearance,
    );
    res.sendStatus(204);
  });
}
