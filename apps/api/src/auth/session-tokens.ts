import { createHash, randomBytes } from 'node:crypto';

/** Opaque refresh token: 32 random bytes, base64url (43 characters). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Refresh tokens are high-entropy random values, so a plain SHA-256 digest is
 * enough to make the stored value useless if the database is read. The digest
 * is hex (64 characters) and is what `refresh_tokens.token_hash` holds.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
