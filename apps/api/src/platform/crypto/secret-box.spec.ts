import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret-box';

const key = randomBytes(32);
const otherKey = randomBytes(32);

describe('secret box (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const sealed = encryptSecret('opaque-token-12345', key);
    expect(decryptSecret(sealed, key)).toBe('opaque-token-12345');
  });

  it('never exposes the plaintext in the sealed payload', () => {
    const plaintext = 'plaintext-that-must-not-leak';
    const sealed = encryptSecret(plaintext, key);
    expect(JSON.stringify(sealed)).not.toContain(plaintext);
    expect(Object.keys(sealed).sort()).toEqual(['authTag', 'ciphertext', 'iv']);
  });

  it('uses a fresh 12-byte IV and a 16-byte auth tag for every call', () => {
    const first = encryptSecret('same-input', key);
    const second = encryptSecret('same-input', key);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(Buffer.from(first.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(first.authTag, 'base64')).toHaveLength(16);
  });

  it('fails to decrypt with a different key', () => {
    const sealed = encryptSecret('secret', key);
    expect(() => decryptSecret(sealed, otherKey)).toThrow();
  });

  it('fails when the ciphertext or the auth tag was tampered with', () => {
    const sealed = encryptSecret('secret', key);
    const flip = (value: string) => {
      const bytes = Buffer.from(value, 'base64');
      bytes[0] ^= 0xff;
      return bytes.toString('base64');
    };
    expect(() => decryptSecret({ ...sealed, ciphertext: flip(sealed.ciphertext) }, key)).toThrow();
    expect(() => decryptSecret({ ...sealed, authTag: flip(sealed.authTag) }, key)).toThrow();
  });

  it('binds the payload to its associated data', () => {
    const sealed = encryptSecret('secret', key, 'invitation-a');
    expect(decryptSecret(sealed, key, 'invitation-a')).toBe('secret');
    expect(() => decryptSecret(sealed, key, 'invitation-b')).toThrow();
    expect(() => decryptSecret(sealed, key)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptSecret('secret', randomBytes(16))).toThrow(/32 bytes/);
    expect(() => decryptSecret(encryptSecret('secret', key), randomBytes(31))).toThrow(/32 bytes/);
  });

  it('rejects malformed sealed payloads', () => {
    const sealed = encryptSecret('secret', key);
    expect(() => decryptSecret({ ...sealed, iv: 'AAAA' }, key)).toThrow();
    expect(() => decryptSecret({ ...sealed, authTag: 'AAAA' }, key)).toThrow();
  });
});
