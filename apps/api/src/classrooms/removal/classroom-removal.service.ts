import { Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomRole, MembershipState } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../../access/access-verification.service';
import { CLASSROOM_MEMBERSHIP_REMOVED_EVENT } from '../../platform/realtime/realtime-events';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassroomRemovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly outbox: OutboxWriter,
  ) {}

  async remove(actorUserId: string, classroomId: string, studentId: string): Promise<void> {
    if (!UUID_PATTERN.test(classroomId) || !UUID_PATTERN.test(studentId)) {
      throw new NotFoundException('Student membership not found');
    }
    await this.access.verifyClassroomAccess(actorUserId, classroomId, { requiredRole: 'TEACHER' });

    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.classroomMembership.findFirst({
        where: { classroomId, userId: studentId, role: ClassroomRole.STUDENT },
        select: { id: true, state: true, deletedAt: true },
      });
      if (!membership) throw new NotFoundException('Student membership not found');
      // Historical inactive/deleted rows are terminal: no repair, reenrollment,
      // timestamp rewrite or synthetic removal event on an idempotent request.
      if (membership.state !== MembershipState.ACTIVE || membership.deletedAt !== null) return;

      const changed = await tx.classroomMembership.updateMany({
        where: {
          id: membership.id,
          classroomId,
          userId: studentId,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
          deletedAt: null,
        },
        data: { state: MembershipState.INACTIVE, deletedAt: new Date() },
      });
      // PostgreSQL rechecks the predicate after a competing updater commits.
      // Only the winning transition may release resources and record an event.
      if (changed.count === 0) return;

      await tx.desk.updateMany({
        where: { membershipId: membership.id },
        data: { membershipId: null },
      });
      await tx.parentLink.updateMany({
        where: { classroomId, childId: studentId, state: MembershipState.ACTIVE },
        data: { state: MembershipState.INACTIVE },
      });
      await this.outbox.record(tx, {
        type: CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
        payload: { classroomId, membershipId: membership.id, userId: studentId },
      });
    });
  }
}
