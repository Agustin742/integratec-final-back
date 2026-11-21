import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { SERVICE_SECRET_HEADER } from '../join/api-join-verifier';

/** Constant-time comparison; a length mismatch is rejected first (the length is not a secret). */
export function secretsMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes)
  );
}

/** The service secret of an internal-route call, when the header carries a single string. */
export function presentedSecret(req: Request): string | undefined {
  const header = req.headers[SERVICE_SECRET_HEADER];
  return typeof header === 'string' ? header : undefined;
}
