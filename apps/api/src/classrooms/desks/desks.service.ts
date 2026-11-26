import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccessVerificationService } from '../../access/access-verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { deskDecorFor } from '../../users/member-appearance';
import type { ClassroomDeskMapDto } from './desks.dto';

@Injectable()
export class ClassroomDesksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  async read(actorId: string, classroomId: string): Promise<ClassroomDeskMapDto> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId);
    // A parent link permits child-specific data, never a classroom-wide map.
    if (access.myRole === 'PARENT') {
      throw new ForbiddenException('Parents cannot read the classroom desk map');
    }
    const rows = await this.prisma.desk.findMany({
      where: { classroomId: access.classroom.id },
      orderBy: [{ deskIndex: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        deskIndex: true,
        membershipId: true,
        membership: { select: { userId: true } },
      },
    });
    const decor = await deskDecorFor(this.prisma, access.classroom.id);
    return {
      items: rows.map((row) => {
        const userId = row.membership?.userId ?? null;
        return {
          id: row.id,
          deskIndex: row.deskIndex,
          membershipId: row.membershipId,
          userId,
          deskDecor: (userId && decor.get(userId)) || null,
        };
      }),
    };
  }
}
