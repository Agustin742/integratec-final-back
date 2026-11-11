import { z } from 'zod';
import {
  CLASSROOM_ROLES,
  JoinDeniedError,
  type JoinVerifier,
  type ReverifyRequest,
  type VerifiedJoin,
} from './join-verifier';

export const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 3000;

const VERIFICATION_PATH = '/internal/realtime/join-verification';
const REVERIFICATION_PATH = '/internal/realtime/access-reverification';

/** Appends `path` to `baseUrl` keeping any base path prefix and avoiding duplicate slashes. */
function joinPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
  return url.toString();
}

const verifiedJoinSchema = z.object({
  userId: z.uuid(),
  sessionId: z.uuid(),
  classroomId: z.uuid(),
  role: z.enum(CLASSROOM_ROLES),
  displayName: z.string().min(1).max(100),
});

export interface ApiJoinVerifierOptions {
  /** Base URL of the NestJS API, e.g. `http://api:3000`. */
  baseUrl: string;
  serviceSecret: string;
  /** Maximum time to wait for the API before the join is denied. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Verifies joins against the internal NestJS endpoint. It fails closed: any network error,
 * timeout, non-200 status or malformed body is a denial. It never logs the token or secret.
 */
export class ApiJoinVerifier implements JoinVerifier {
  private readonly baseUrl: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiJoinVerifierOptions) {
    this.baseUrl = options.baseUrl;
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(accessToken: string, classroomId: string): Promise<VerifiedJoin> {
    const identity = await this.post(VERIFICATION_PATH, { accessToken, classroomId });
    if (identity.classroomId !== classroomId) throw new JoinDeniedError();
    return identity;
  }

  async reverify(request: ReverifyRequest): Promise<VerifiedJoin> {
    const identity = await this.post(REVERIFICATION_PATH, {
      userId: request.userId,
      sessionId: request.authSessionId,
      classroomId: request.classroomId,
    });
    if (
      identity.userId !== request.userId ||
      identity.sessionId !== request.authSessionId ||
      identity.classroomId !== request.classroomId
    ) {
      throw new JoinDeniedError();
    }
    return identity;
  }

  private async post(path: string, body: Record<string, string>): Promise<VerifiedJoin> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(joinPath(this.baseUrl, path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SERVICE_SECRET_HEADER]: this.serviceSecret,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw new JoinDeniedError();
      }
      // The body is read inside the timeout window too: a stalled body is a denial.
      const parsed = verifiedJoinSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new JoinDeniedError();
      }
      return parsed.data;
    } catch (error) {
      // Collapse every failure into one cause-free denial so nothing sensitive can leak.
      throw error instanceof JoinDeniedError ? error : new JoinDeniedError();
    } finally {
      clearTimeout(timer);
    }
  }
}
