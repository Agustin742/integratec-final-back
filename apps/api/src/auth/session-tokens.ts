import { createHash, randomBytes } from 'node:crypto';
import type { JwtService } from '@nestjs/jwt';

/** Claims carried by access tokens: `sub` is the user id, `sid` the session id. */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

/** Signs a short-lived access token bound to a session (login and refresh share this). */
export function signAccessToken(
  jwt: JwtService,
  claims: AccessTokenClaims,
  ttlSeconds: number,
): Promise<string> {
  return jwt.signAsync({ sub: claims.sub, sid: claims.sid }, { expiresIn: ttlSeconds });
}

/** Opaque bearer token: 32 random bytes, base64url (43 characters). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Opaque tokens are high-entropy random values, so a plain SHA-256 digest is
 * enough to make the stored value useless if the database is read. The digest
 * is hex (64 characters), the value `token_hash` columns hold.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Refresh tokens are opaque tokens (see {@link generateOpaqueToken}). */
export const generateRefreshToken = generateOpaqueToken;

/** Digest stored in `refresh_tokens.token_hash` (see {@link hashOpaqueToken}). */
export const hashRefreshToken = hashOpaqueToken;
