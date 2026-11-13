import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConnectedTimeReportDto } from './connected-time.dto';

/** Reports are sent when a session ends, so an end far in the future means a broken clock. */
const MAX_FUTURE_SKEW_MS = 3_600_000;

/**
 * Adds connected-time aggregates to the activity metric. There is one row per user, classroom and
 * UTC day, so the table grows with days of attendance and never with movement or sessions; the
 * counter is incremented in the database so concurrent reports cannot overwrite each other.
 */
@Injectable()
export class ConnectedTimeService {
  constructor(private readonly prisma: PrismaService) {}

  async add(report: ConnectedTimeReportDto): Promise<void> {
    const endedAt = new Date(report.endedAt);
    if (endedAt.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException('endedAt must not be in the future');
    }
    const [user, classroom] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: report.userId }, select: { id: true } }),
      this.prisma.classroom.findFirst({
        where: { id: report.classroomId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (user === null || classroom === null) throw new NotFoundException();

    const day = new Date(
      Date.UTC(endedAt.getUTCFullYear(), endedAt.getUTCMonth(), endedAt.getUTCDate()),
    );
    const key = { classroomId: report.classroomId, userId: report.userId, day };
    const increment = { connectedSeconds: { increment: report.connectedSeconds } };
    try {
      await this.prisma.activityMetric.upsert({
        where: { classroomId_userId_day: key },
        create: { ...key, connectedSeconds: report.connectedSeconds },
        update: increment,
      });
    } catch (error) {
      // Two reports creating the same row at once: the loser adds to the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.prisma.activityMetric.update({
          where: { classroomId_userId_day: key },
          data: increment,
        });
        return;
      }
      throw error;
    }
  }
}
