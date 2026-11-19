import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccessVerificationService } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeEventsRecorder } from '../platform/realtime/realtime-events.recorder';
import { AvatarAccessPort } from './avatar-access.port';
import { AvatarDto, avatarSnapshot } from './avatar.dto';
import { equippedItemsFor, readBaseAppearance } from './member-appearance';
import { OwnProfileDto, UpdateProfileDto } from './profile.dto';

const profileSelection = {
  id: true,
  email: true,
  displayName: true,
  avatarConfig: { select: { appearance: true } },
} satisfies Prisma.UserSelect;
type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelection }>;

/** Page size of the accessible-classroom listing that scopes a base-avatar broadcast (#114). */
const ACCESSIBLE_CLASSROOMS_PAGE = 100;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AvatarAccessPort,
    private readonly classroomAccess: AccessVerificationService,
    private readonly realtimeEvents: RealtimeEventsRecorder,
  ) {}

  async getMe(userId: string): Promise<OwnProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelection,
    });
    if (!user) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<OwnProfileDto> {
    // The global guard already verified this user; update and project in one query.
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: dto.displayName },
      select: profileSelection,
    });
    return this.toProfile(user);
  }

  async updateAvatar(userId: string, dto: AvatarDto): Promise<AvatarDto> {
    await this.access.assertCanUse(userId, dto);
    const snapshot = avatarSnapshot(dto);
    // The base avatar is global, so the change is broadcast to every classroom where the user
    // has live access in practice (the same derivation as join verification, parents excluded).
    // Equipped items are classroom-scoped, so each event carries that classroom's full snapshot.
    const classroomIds = await this.liveAccessClassroomIds(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.avatarConfiguration.upsert({
        where: { userId },
        create: { userId, appearance: { ...snapshot } },
        update: { appearance: { ...snapshot } },
        select: { userId: true },
      });
      for (const classroomId of classroomIds) {
        const items = await equippedItemsFor(tx, userId, classroomId);
        await this.realtimeEvents.recordClassroomAppearanceChanged(tx, {
          classroomId,
          userId,
          appearance: { baseAvatar: snapshot, items },
        });
      }
    });
    return snapshot;
  }

  /**
   * Classrooms where the user has live access in practice (#114): the same hierarchy as
   * `verifyClassroomAccess` (school Owner/Admin, independent-teacher ownership, active teacher or
   * student memberships), minus parents, who can read a classroom but never join its live room.
   */
  private async liveAccessClassroomIds(userId: string): Promise<string[]> {
    const classroomIds: string[] = [];
    for (let skip = 0; ; skip += ACCESSIBLE_CLASSROOMS_PAGE) {
      const { total, items } = await this.classroomAccess.listAccessibleClassrooms(userId, {
        skip,
        take: ACCESSIBLE_CLASSROOMS_PAGE,
        sort: { field: 'createdAt', direction: 'asc' },
      });
      for (const item of items) {
        if (item.myRole !== 'PARENT') classroomIds.push(item.classroom.id);
      }
      if (skip + items.length >= total) return classroomIds;
    }
  }

  private toProfile(user: ProfileRecord): OwnProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: this.readAppearance(user.avatarConfig?.appearance),
    };
  }

  private readAppearance(value: Prisma.JsonValue | undefined): AvatarDto {
    return readBaseAppearance(value, { onUnsupported: () => this.unsupportedAppearance() });
  }

  private unsupportedAppearance(): void {
    // Constant diagnostic only: stored JSON and identity must never enter this warning.
    this.logger.warn('Unsupported stored base appearance; using default avatar.');
  }
}
