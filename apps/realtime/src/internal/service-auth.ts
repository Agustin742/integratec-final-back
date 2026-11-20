import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { SERVICE_SECRET_HEADER } from '../join/api-join-verifier';

/** Constant-time comparison; the length mismatch is not secret. */
export function hasValidServiceSecret(req: Request, expected: string): boolean {
  const header = req.headers[SERVICE_SECRET_HEADER];
  if (typeof header !== 'string') return false;
  const presented = Buffer.from(header, 'utf8');
  const secret = Buffer.from(expected, 'utf8');
  return presented.length === secret.length && timingSafeEqual(presented, secret);
}
