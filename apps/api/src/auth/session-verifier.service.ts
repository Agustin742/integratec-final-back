import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims } from './session-tokens';

export interface VerifiedSession {
  userId: string;
  sessionId: string;
}

const BEARER_PATTERN = /^Bearer +(\S+)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns an access token into a verified identity. Checks the signature and expiry
 * of the JWT and then the stored session (it exists, belongs to the subject, is
 * not revoked and has not expired), so logout and password reset take effect on
 * the very next request. Every failure is the same generic 401 on purpose.
 * Consumed by the global guard (#19) and the realtime join check (#24).
 */
@Injectable()
export class SessionVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Verifies a raw `Authorization` header value (`Bearer <token>`). */
  async verifyAuthorizationHeader(header: string | undefined): Promise<VerifiedSession> {
    const token = header === undefined ? undefined : BEARER_PATTERN.exec(header)?.[1];
    if (token === undefined) throw new UnauthorizedException();
    return this.verifyToken(token);
  }

  /** Verifies a bare access token. */
  async verifyToken(token: string): Promise<VerifiedSession> {
    const claims = await this.readClaims(token);

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });
    if (
      session === null ||
      session.userId !== claims.sub ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException();
    }
    return { userId: session.userId, sessionId: claims.sid };
  }

  private async readClaims(token: string): Promise<AccessTokenClaims> {
    let claims: Partial<AccessTokenClaims>;
    try {
      claims = await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(token);
    } catch {
      throw new UnauthorizedException();
    }
    // Ids are validated before they reach the database, whose uuid columns would
    // otherwise turn a malformed claim into a 500.
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string' ||
      !UUID_PATTERN.test(claims.sub) ||
      !UUID_PATTERN.test(claims.sid)
    ) {
      throw new UnauthorizedException();
    }
    return { sub: claims.sub, sid: claims.sid };
  }
}
