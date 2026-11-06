import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MembershipState, Prisma, SchoolRole } from '@prisma/client';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { TokenPairResponseDto } from './dto/token-pair-response.dto';
import {
  type AccessTokenClaims,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './session-tokens';
import { slugify } from './slugify';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHashPromise: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /**
   * Warms the dummy hash at startup so the first unknown-email login is not slower
   * than later ones. A failure here fails the boot loudly instead of surfacing as an
   * unhandled rejection.
   */
  async onModuleInit(): Promise<void> {
    await this.getDummyPasswordHash();
  }

  /**
   * Hash compared against when the email is unknown, so that path costs a bcrypt
   * comparison like a real one and response time does not reveal which emails exist.
   * Computed once and memoized, with the same cost factor as real hashes. A failed
   * computation is not cached, so a later call retries.
   */
  private getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHashPromise ??= bcrypt
      .hash(randomBytes(16).toString('hex'), BCRYPT_SALT_ROUNDS)
      .catch((error: unknown) => {
        this.dummyPasswordHashPromise = undefined;
        throw error;
      });
    return this.dummyPasswordHashPromise;
  }

  /**
   * Authenticates by email and password and opens a session: a stored session row,
   * its first refresh token (kept only as a SHA-256 digest) and a short-lived JWT
   * access token bound to that session. Unknown email and wrong password are
   * indistinguishable to the caller.
   */
  async login(dto: LoginRequestDto): Promise<TokenPairResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, passwordHash: true },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? (await this.getDummyPasswordHash()),
    );
    if (user === null || !passwordMatches) {
      throw new UnauthorizedException();
    }

    const refreshToken = generateRefreshToken();
    // One nested write: the session and its first refresh token commit together or not at all.
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
        refreshTokens: { create: { tokenHash: hashRefreshToken(refreshToken) } },
      },
      select: { id: true },
    });

    return this.tokenPair({ sub: user.id, sid: session.id }, refreshToken);
  }

  /**
   * Exchanges a refresh token for a new pair. The presented token is single-use:
   * it is marked rotated and replaced inside one transaction, and the new access
   * token keeps the same session id. The session keeps its original `expiresAt`
   * (an absolute lifetime): rotating never slides it, so a stolen-but-rotating
   * credential cannot keep a session alive forever.
   *
   * Presenting an already-rotated token means two parties hold the same credential,
   * so the whole session is revoked. Every failure is the same generic 401.
   */
  async refresh(dto: RefreshRequestDto): Promise<TokenPairResponseDto> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(dto.refreshToken) },
      select: {
        id: true,
        rotatedAt: true,
        session: { select: { id: true, userId: true, expiresAt: true, revokedAt: true } },
      },
    });
    if (stored === null) throw new UnauthorizedException();

    const { session } = stored;
    if (stored.rotatedAt !== null) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException();
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }

    const nextRefreshToken = generateRefreshToken();
    // The outcome is returned, not thrown: a throw would roll the transaction back,
    // and the reuse revocation below must persist even though the request fails.
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token only
      // one sees `rotatedAt: null` and matches; the other is handled as reuse.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (count !== 1) return false;
      await tx.refreshToken.create({
        data: { sessionId: session.id, tokenHash: hashRefreshToken(nextRefreshToken) },
      });
      return true;
    });
    if (!rotated) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException();
    }

    return this.tokenPair({ sub: session.userId, sid: session.id }, nextRefreshToken);
  }

  /** Revokes a session. Idempotent: an already revoked session keeps its first `revokedAt`. */
  async logout(sessionId: string): Promise<void> {
    await this.revokeSession(sessionId);
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async tokenPair(
    claims: AccessTokenClaims,
    refreshToken: string,
  ): Promise<TokenPairResponseDto> {
    return {
      accessToken: await signAccessToken(this.jwt, claims, this.config.accessTokenTtlSeconds),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenTtlSeconds,
    };
  }

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
            registrationPath: dto.path,
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
          const rawSchoolName = dto.schoolName?.trim() || 'Escuela';
          const baseSlug = slugify(rawSchoolName).slice(0, 140) || 'escuela';
          let candidateSlug = baseSlug;

          let attempts = 0;
          while (attempts < 5) {
            const collision = await tx.school.findUnique({ where: { slug: candidateSlug } });
            if (!collision) break;
            const suffix = Math.random().toString(36).substring(2, 7);
            candidateSlug = `${baseSlug.slice(0, 133)}-${suffix}`;
            attempts++;
          }

          const school = await tx.school.create({
            data: {
              name: rawSchoolName,
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
          path: user.registrationPath,
          school: createdSchool,
          createdAt: user.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.includes('slug')) {
          throw new ConflictException(
            'Unable to reserve school slug due to concurrent registration. Please retry.',
          );
        }
        throw new ConflictException('A user with this email address already exists');
      }
      throw error;
    }
  }
}
