import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessVerificationService } from '../../access/access-verification.service';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { JoinVerificationResponseDto } from './realtime-join.dto';

/**
 * Answers the realtime server's access questions from persisted state, so NestJS stays the single
 * authorization service (rules/architecture.md). Parents have no live classroom access.
 */
@Injectable()
export class RealtimeAccessService {
  constructor(
    private readonly sessions: SessionVerifier,
    private readonly access: AccessVerificationService,
    private readonly prisma: PrismaService,
  ) {}

  /** Join check: the access token must be valid and its user must have live access. */
  async verifyJoin(accessToken: string, classroomId: string): Promise<JoinVerificationResponseDto> {
    const { userId, sessionId } = await this.sessions.verifyToken(accessToken);
    return this.identityFor(userId, sessionId, classroomId);
  }

  private async identityFor(
    userId: string,
    sessionId: string,
    classroomId: string,
  ): Promise<JoinVerificationResponseDto> {
    const { classroom, myRole } = await this.access.verifyClassroomAccess(userId, classroomId, {
      requiredRole: 'ANY',
    });
    // Parents have no live classroom access (rules/realtime-and-presence.md, Join authorization).
    if (myRole === 'PARENT') {
      throw new ForbiddenException('Live classroom access is not available for this role');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    if (user === null) throw new UnauthorizedException();
    return {
      userId,
      sessionId,
      classroomId: classroom.id,
      role: myRole,
      displayName: user.displayName,
    };
  }
}
