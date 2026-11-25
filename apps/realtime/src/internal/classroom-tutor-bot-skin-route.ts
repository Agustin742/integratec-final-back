import type { Application } from 'express';
import { z } from 'zod';
import { TUTOR_BOT_SKINS, type TutorBotSkin } from '@aula/contracts';
import { presentedSecret, secretsMatch } from './service-secret';

export const CLASSROOM_TUTOR_BOT_SKIN_PATH = '/internal/classroom-tutor-bot-skin';

export interface ClassroomTutorBotSkinRouteOptions {
  serviceSecret: string;
  directory: {
    applyTutorBotSkin(classroomId: string, skin: TutorBotSkin, revision: number): void;
  };
}

const tutorBotSkinSchema = z.strictObject({
  classroomId: z.uuid(),
  tutorBotSkin: z.enum(TUTOR_BOT_SKINS),
  tutorBotSkinRevision: z.number().int().nonnegative(),
});

/**
 * Mounts the internal route NestJS calls when classroom staff change the tutor bot skin (#154).
 * Rooms drop an older revision, so replayed or reordered deliveries are harmless. Like the other
 * internal routes it needs the service secret, is never routed by the reverse proxy, and answers
 * a bare 204 whether or not a room was live.
 */
export function mountClassroomTutorBotSkinRoute(
  app: Application,
  options: ClassroomTutorBotSkinRouteOptions,
): void {
  app.post(CLASSROOM_TUTOR_BOT_SKIN_PATH, (req, res) => {
    const secret = presentedSecret(req);
    if (secret === undefined || !secretsMatch(secret, options.serviceSecret)) {
      res.sendStatus(401);
      return;
    }
    const parsed = tutorBotSkinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.sendStatus(400);
      return;
    }
    const { classroomId, tutorBotSkin, tutorBotSkinRevision } = parsed.data;
    options.directory.applyTutorBotSkin(classroomId, tutorBotSkin, tutorBotSkinRevision);
    res.sendStatus(204);
  });
}
