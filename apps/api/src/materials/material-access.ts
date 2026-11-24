import { ForbiddenException } from '@nestjs/common';
import type { AccessVerificationService } from '../access/access-verification.service';

/**
 * Shared material authorization: staff and current students read, teacher-level staff
 * write, parents have no material permission. Used by materials and material modules so
 * both resources keep identical visibility and error semantics.
 */
export async function authorizeMaterialAccess(
  access: AccessVerificationService,
  actorId: string,
  classroomId: string,
  write = false,
) {
  const verified = await access.verifyClassroomAccess(actorId, classroomId, {
    requiredRole: write ? 'STAFF' : 'ANY',
  });
  if (verified.myRole === 'PARENT') {
    throw new ForbiddenException('Material is for staff and students');
  }
  return verified;
}
