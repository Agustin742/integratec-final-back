import { createHash, randomInt } from 'node:crypto';

/**
 * Crockford Base32 charset (excludes ambiguous characters I, L, O, U).
 */
export const JOIN_CODE_CHARSET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DEFAULT_JOIN_CODE_LENGTH = 7;

/**
 * Generates an uppercase alphanumeric join code with high entropy.
 */
export function generateJoinCode(length: number = DEFAULT_JOIN_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, JOIN_CODE_CHARSET.length);
    code += JOIN_CODE_CHARSET[idx];
  }
  return code;
}

/**
 * Normalizes user-supplied join codes (trims whitespace and converts to uppercase).
 */
export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Computes the SHA-256 hex digest of a secret (token or normalized join code).
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
