import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MembershipState, Prisma, SchoolRole } from '@prisma/client';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { slugify } from './slugify';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterRequestDto): Promise<RegisterResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1. Proactive uniqueness check against existing users
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email address already exists');
    }

    // 2. Hash password securely with per-password salt
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    // 3. Atomically create User, AvatarConfiguration and organization structure
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            displayName: dto.displayName.trim(),
          },
        });

        await tx.avatarConfiguration.create({
          data: {
            userId: user.id,
            appearance: {},
          },
        });

        let createdSchool: { id: string; name: string; slug: string; timeZone: string } | undefined;

        if (dto.path === RegistrationPath.SCHOOL) {
          if (!dto.schoolName?.trim()) {
            throw new BadRequestException('schoolName is required when path is SCHOOL');
          }

          const baseSlug = slugify(dto.schoolName).slice(0, 140);
          let candidateSlug = baseSlug;
          const slugCollision = await tx.school.findUnique({ where: { slug: candidateSlug } });
          if (slugCollision) {
            candidateSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`;
          }

          const school = await tx.school.create({
            data: {
              name: dto.schoolName.trim(),
              slug: candidateSlug,
              timeZone: 'America/Argentina/Buenos_Aires',
            },
          });

          await tx.schoolMember.create({
            data: {
              schoolId: school.id,
              userId: user.id,
              role: SchoolRole.OWNER,
              state: MembershipState.ACTIVE,
            },
          });

          createdSchool = {
            id: school.id,
            name: school.name,
            slug: school.slug,
            timeZone: school.timeZone,
          };
        }

        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          path: dto.path,
          school: createdSchool,
          createdAt: user.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.includes('slug')) {
          throw new ConflictException(
            'A school with this slug already exists. Please choose a different school name.',
          );
        }
        throw new ConflictException('A user with this email address already exists');
      }
      throw error;
    }
  }
}
