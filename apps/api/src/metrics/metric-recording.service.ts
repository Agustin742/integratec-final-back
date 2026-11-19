import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { utcDayOf } from './utc-day';

/**
 * Adds raw counts to the per-day `ActivityMetric` row. Rows grow with UTC days, never with
 * instants (rules/data.md): each call increments the row of the UTC day the event happened,
 * so the composite formula (gap 17) can be decided later without losing any raw signal.
 *
 * Callers must run inside a context that already validated the classroom and the user; this
 * service never throws on foreign identifiers because there is nothing to reveal.
 */
@Injectable()
export class MetricRecordingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts one submission event. Call from the submission's own transaction. */
  recordSubmission(
    client: Prisma.TransactionClient | PrismaService,
    input: { classroomId: string; userId: string; at: Date },
  ): Promise<void> {
    return this.increment(client, input.classroomId, input.userId, input.at, 'submissionCount');
  }

  /** Counts one classroom-channel participation event (chat wires this when it ships). */
  recordMessage(
    client: Prisma.TransactionClient | PrismaService,
    input: { classroomId: string; userId: string; at: Date },
  ): Promise<void> {
    return this.increment(client, input.classroomId, input.userId, input.at, 'messageCount');
  }

  private async increment(
    client: Prisma.TransactionClient | PrismaService,
    classroomId: string,
    userId: string,
    at: Date,
    field: 'submissionCount' | 'messageCount',
  ): Promise<void> {
    const key = { classroomId, userId, day: utcDayOf(at) };
    const increment = { [field]: { increment: 1 } } as Prisma.ActivityMetricUpdateInput;
    try {
      await client.activityMetric.upsert({
        where: { classroomId_userId_day: key },
        create: { ...key, [field]: 1 },
        update: increment,
      });
    } catch (error) {
      // Two reports creating the same row at once: the loser adds to the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await client.activityMetric.update({
          where: { classroomId_userId_day: key },
          data: increment,
        });
        return;
      }
      throw error;
    }
  }
}
