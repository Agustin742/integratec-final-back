import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessVerificationService } from '../../access/access-verification.service';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { memberAppearanceFor, type ReadBaseAppearanceOptions } from '../../users/member-appearance';
import type { JoinVerificationResponseDto } from './realtime-join.dto';

/**
 * Answers the realtime server's access questions from persisted state, so NestJS stays the single
 * authorization service (rules/architecture.md). Parents have no live classroom access.
 */
@Injectable()
export class RealtimeAccessService {
  private readonly logger = new Logger(RealtimeAccessService.name);

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

  /**
   * Re-verification of a user already admitted: the session must still be live and the access
   * must still hold. It takes ids instead of a token because the join token may have expired
   * while the session is still valid, which would make a reconnection impossible.
   */
  async reverify(
    userId: string,
    sessionId: string,
    classroomId: string,
  ): Promise<JoinVerificationResponseDto> {
    await this.sessions.verifySession(userId, sessionId);
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
    const [{ displayName, appearanceRevision, appearance }, deskCount] = await Promise.all([
      memberAppearanceFor(this.prisma, userId, classroom.id, this.unsupportedAppearanceOptions()),
      this.prisma.desk.count({ where: { classroomId: classroom.id } }),
    ]);
    return {
      userId,
      sessionId,
      classroomId: classroom.id,
      role: myRole,
      displayName,
      appearance,
      appearanceRevision,
      deskCount,
    };
  }

  /**
   * Same semantics as `UsersService.readAppearance`: unsupported stored JSON falls back to the
   * default avatar with a constant-only warning.
   */
  private unsupportedAppearanceOptions(): ReadBaseAppearanceOptions {
    return {
      onUnsupported: () =>
        this.logger.warn('Unsupported stored base appearance; using default avatar.'),
    };
  }
}
