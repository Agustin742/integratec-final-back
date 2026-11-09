import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOIN_CODE_LENGTH,
  JOIN_CODE_CHARSET,
  generateJoinCode,
  hashSecret,
  normalizeJoinCode,
} from './join-code.util';

describe('join-code.util', () => {
  it('generates a join code of default length 7 with Crockford Base32 charset', () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(DEFAULT_JOIN_CODE_LENGTH);
    for (const char of code) {
      expect(JOIN_CODE_CHARSET).toContain(char);
    }
  });

  it('supports custom join code lengths', () => {
    const code6 = generateJoinCode(6);
    const code8 = generateJoinCode(8);
    expect(code6).toHaveLength(6);
    expect(code8).toHaveLength(8);
  });

  it('normalizes join codes by trimming and converting to uppercase', () => {
    expect(normalizeJoinCode('  k7p9x2m  ')).toBe('K7P9X2M');
    expect(normalizeJoinCode('abc1234')).toBe('ABC1234');
    expect(normalizeJoinCode('\tXY789Z\n')).toBe('XY789Z');
  });

  it('computes deterministic SHA-256 hash', () => {
    const hash1 = hashSecret('ABC1234');
    const hash2 = hashSecret('ABC1234');
    const hash3 = hashSecret('abc1234');

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});
