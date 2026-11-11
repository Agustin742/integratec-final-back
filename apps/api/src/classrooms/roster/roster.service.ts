import { Injectable } from '@nestjs/common';
import { ClassroomRole, type Prisma } from '@prisma/client';
import { AccessVerificationService } from '../../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../../http/pagination/paginated';
import { PrismaService } from '../../prisma/prisma.service';
import { type RosterQueryDto, type RosterStudentDto } from './roster.dto';

@Injectable()
export class ClassroomRosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  async list(
    actorId: string,
    classroomId: string,
    query: RosterQueryDto,
  ): Promise<Paginated<RosterStudentDto>> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    const where: Prisma.ClassroomMembershipWhereInput = {
      classroomId,
      role: ClassroomRole.STUDENT,
      ...(query.state !== undefined ? { state: query.state } : {}),
      ...(query.q !== undefined
        ? {
            user: {
              displayName: {
                // Prisma's PostgreSQL startsWith uses LIKE; keep the prefix literal.
                startsWith: query.q.replace(/[\\%_]/g, '\\$&'),
                mode: 'insensitive',
              },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classroomMembership.findMany({
        where,
        ...toSkipTake(query),
        orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          state: true,
          deletedAt: true,
          user: {
            select: {
              displayName: true,
              // The relation scopes by this child; the predicate scopes by classroom.
              // Do not discard inactive links: this is staff history, not D12.
              childInLinks: {
                where: { classroomId },
                orderBy: { id: 'asc' },
                select: { state: true, parent: { select: { id: true, displayName: true } } },
              },
            },
          },
        },
      }),
      this.prisma.classroomMembership.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        membershipId: row.id,
        userId: row.userId,
        displayName: row.user.displayName,
        state: row.state,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        guardians: row.user.childInLinks.map((link) => ({
          id: link.parent.id,
          displayName: link.parent.displayName,
          state: link.state,
        })),
      })),
      total,
      query,
    );
  }
}
