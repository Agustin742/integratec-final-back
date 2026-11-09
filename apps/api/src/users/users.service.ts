import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AvatarAccessPort, compatibilityErrors } from './avatar-access.port';
import { AvatarDto, avatarSnapshot, DEFAULT_AVATAR } from './avatar.dto';
import { OwnProfileDto, UpdateProfileDto } from './profile.dto';

const profileSelection = {
  id: true,
  email: true,
  displayName: true,
  avatarConfig: { select: { appearance: true } },
} satisfies Prisma.UserSelect;
type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelection }>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AvatarAccessPort,
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
    await this.prisma.avatarConfiguration.upsert({
      where: { userId },
      create: { userId, appearance: { ...snapshot } },
      update: { appearance: { ...snapshot } },
      select: { userId: true },
    });
    return snapshot;
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
