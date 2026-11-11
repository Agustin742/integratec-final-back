import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * An AES-256-GCM sealed secret. Every field is base64 so the value is JSON-safe and
 * can be stored in a JSON column, for example an outbox payload.
 */
export type SealedSecret = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
  }
}

/**
 * Encrypts `plaintext` with AES-256-GCM using a random 12-byte IV.
 *
 * `aad` is optional associated data that is authenticated but not stored. Passing the
 * identifier of the owning record binds the ciphertext to it, so a sealed value copied
 * to another record fails to decrypt.
 */
export function encryptSecret(plaintext: string, key: Buffer, aad?: string): SealedSecret {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // The auth tag is only available after final().
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypts a {@link SealedSecret}. Throws when the key, the associated data, the auth tag
 * or the ciphertext does not match what was sealed, or when the payload is malformed.
 */
export function decryptSecret(sealed: SealedSecret, key: Buffer, aad?: string): string {
  assertKey(key);
  const iv = Buffer.from(sealed.iv, 'base64');
  const authTag = Buffer.from(sealed.authTag, 'base64');
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Sealed secret is malformed');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  // The auth tag must be set before final(), which throws if anything was altered.
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
