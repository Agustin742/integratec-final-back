import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Prisma } from '@prisma/client';
import type { AppearanceSlotName } from '@aula/contracts';
import { AccessVerificationService } from '../../access/access-verification.service';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { SLOT_NAME_BY_ENUM } from '../../equipment/equipment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { compatibilityErrors } from '../../users/avatar-access.port';
import { AvatarDto, DEFAULT_AVATAR, avatarSnapshot } from '../../users/avatar.dto';
import type { EquippedItemPayloadDto, JoinVerificationResponseDto } from './realtime-join.dto';

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, avatarConfig: { select: { appearance: true } } },
    });
    if (user === null) throw new UnauthorizedException();
    const equipped = await this.prisma.equippedItem.findMany({
      where: { classroomId: classroom.id, studentId: userId },
      select: {
        slot: true,
        shopItem: { select: { id: true, code: true, name: true, kind: true } },
      },
    });
    // All four slots are always present, null when nothing is equipped (#114).
    const items: Record<AppearanceSlotName, EquippedItemPayloadDto | null> = {
      head: null,
      face: null,
      back: null,
      desk_decor: null,
    };
    for (const row of equipped) {
      const slot = SLOT_NAME_BY_ENUM[row.slot];
      items[slot] = {
        slot,
        shopItemId: row.shopItem.id,
        shopItemCode: row.shopItem.code,
        shopItemName: row.shopItem.name,
        kind: row.shopItem.kind,
      };
    }
    return {
      userId,
      sessionId,
      classroomId: classroom.id,
      role: myRole,
      displayName: user.displayName,
      appearance: {
        baseAvatar: this.readAppearance(user.avatarConfig?.appearance),
        items,
      },
    };
  }

  /**
   * Same semantics as `UsersService.readAppearance`: unsupported stored JSON falls back to the
   * default avatar with a constant-only warning.
   */
  private readAppearance(value: Prisma.JsonValue | undefined): AvatarDto {
    if (
      value === undefined ||
      (value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0)
    ) {
      return { ...DEFAULT_AVATAR };
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return this.unsupportedAppearance();
    }
    const appearance = plainToInstance(AvatarDto, avatarSnapshot(value as unknown as AvatarDto));
    if (validateSync(appearance).length || compatibilityErrors(appearance).length) {
      return this.unsupportedAppearance();
    }
    return avatarSnapshot(appearance);
  }

  private unsupportedAppearance(): AvatarDto {
    // Constant diagnostic only: stored JSON and identity must never enter this warning.
    this.logger.warn('Unsupported stored base appearance; using default avatar.');
    return { ...DEFAULT_AVATAR };
  }
}
