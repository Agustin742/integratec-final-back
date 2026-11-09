/** Outbox event recorded when an email invitation is created. */
export const CLASSROOM_INVITATION_CREATED_EVENT = 'classroom.invitation-created';

export interface ClassroomInvitationCreatedPayload {
  invitationId: string;
  classroomId: string;
  targetEmail: string;
  role: string;
  token: string;
}
