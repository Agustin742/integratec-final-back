/** Outbox event recorded when an email invitation is created. */
export const CLASSROOM_INVITATION_CREATED_EVENT = 'classroom.invitation-created';

import type { SealedSecret } from '../platform/crypto/secret-box';

/**
 * Outbox payload. The raw invitation token is sealed (AES-256-GCM, bound to the invitation id)
 * so it is never persisted in plaintext; only the email handler opens it at delivery time.
 */
export type ClassroomInvitationCreatedPayload = {
  invitationId: string;
  classroomId: string;
  targetEmail: string;
  role: string;
  encryptedToken: SealedSecret;
};
