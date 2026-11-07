import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { compatibilityErrors } from './avatar-access.port';
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
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<OwnProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelection,
    });
    if (!user) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<OwnProfileDto> {
    // Ensure an unsupported stored avatar does not turn a profile write into an uncertain success.
    await this.getMe(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: dto.displayName },
      select: profileSelection,
    });
    return this.toProfile(user);
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
      throw new InternalServerErrorException();
    }
    const appearance = plainToInstance(AvatarDto, avatarSnapshot(value as unknown as AvatarDto));
    if (validateSync(appearance).length || compatibilityErrors(appearance).length) {
      throw new InternalServerErrorException();
    }
    return avatarSnapshot(appearance);
  }
}
