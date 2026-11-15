import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessVerificationService, UUID_PATTERN } from '../../access/access-verification.service';
import { SessionVerifier, type VerifiedSession } from '../../auth/session-verifier.service';

export const CONTEXT_HEARTBEAT_MS = 15_000;
export const CONTEXT_MAX_LIFETIME_MS = 60_000;
export const CONTEXT_SETUP_TIMEOUT_MS = 10_000;

type Subscription = VerifiedSession & { classroomId: string; invalidate: () => void };

/** Process-local live hints only. REST remains authoritative; there is no replay history. */
@Injectable()
export class ClassroomContextEventsService implements OnModuleDestroy {
  private readonly subscriptions = new Set<Subscription>();
  private readonly closers = new Set<() => void>();
  private stopping = false;

  constructor(
    private readonly access: AccessVerificationService,
    private readonly sessions: SessionVerifier,
  ) {}

  async connect(identity: VerifiedSession, classroomId: string, response: Response): Promise<void> {
    if (response.destroyed) return;
    if (this.stopping) throw new ServiceUnavailableException();
    if (!UUID_PATTERN.test(classroomId)) throw new NotFoundException();

    let closed = false;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined = undefined;
    let setup: ReturnType<typeof setTimeout> | undefined;
    let subscription: Subscription | undefined = undefined;
    let cancel!: (result: false) => void;
    const cancelled = new Promise<false>((resolve) => {
      cancel = resolve;
    });
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(heartbeat);
      clearTimeout(lifetime);
      clearTimeout(setup);
      response.off('close', close);
      response.off('error', shutdown);
      this.closers.delete(shutdown);
      if (subscription) this.subscriptions.delete(subscription);
      cancel(false);
    };
    const shutdown = () => {
      close();
      response.destroy();
    };
    response.once('close', close);
    response.once('error', shutdown);
    this.closers.add(shutdown);
    try {
      const authorized = await Promise.race([
        this.access
          .verifyClassroomAccess(identity.userId, classroomId, { requiredRole: 'ANY' })
          .then(() => true),
        cancelled,
        new Promise<never>((_resolve, reject) => {
          setup = setTimeout(
            () => reject(new ServiceUnavailableException()),
            CONTEXT_SETUP_TIMEOUT_MS,
          );
        }),
      ]);
      clearTimeout(setup);
      if (!authorized || closed || response.destroyed) {
        close();
        return;
      }
    } catch (error) {
      close();
      throw error;
    }

    const write = (chunk: string): boolean => {
      if (closed) return false;
      try {
        if (response.write(chunk)) return !closed;
      } catch {
        /* Fail closed on transport errors, without logging payloads. */
      }
      // Never queue additional frames for a slow consumer, even a final hint.
      shutdown();
      return false;
    };
    const hint = () =>
      write(`event: classroom.context-invalidated\ndata: ${JSON.stringify({ classroomId })}\n\n`);
    const invalidate = () => {
      if (hint()) {
        close();
        response.end();
      }
    };
    subscription = { ...identity, classroomId, invalidate };
    this.subscriptions.add(subscription);
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    // Registered before the initial hint: a setup-race change is reconciled by the REST refetch.
    if (!hint()) return;
    lifetime = setTimeout(invalidate, CONTEXT_MAX_LIFETIME_MS);
    const check = async () => {
      try {
        await this.sessions.verifySession(identity.userId, identity.sessionId);
        if (closed) return;
        await this.access.verifyClassroomAccess(identity.userId, classroomId, {
          requiredRole: 'ANY',
        });
      } catch {
        invalidate();
        return;
      }
      // Recursive scheduling avoids overlapping checks. The lifetime bounds even a hung backend.
      if (write(': heartbeat\n\n'))
        heartbeat = setTimeout(() => {
          void check();
        }, CONTEXT_HEARTBEAT_MS);
    };
    heartbeat = setTimeout(() => {
      void check();
    }, CONTEXT_HEARTBEAT_MS);
  }

  invalidateClassroom(classroomId: string): void {
    for (const subscription of this.subscriptions) {
      if (subscription.classroomId === classroomId) subscription.invalidate();
    }
  }

  invalidateSession(userId: string, sessionId?: string): void {
    for (const subscription of this.subscriptions) {
      if (
        subscription.userId === userId &&
        (sessionId === undefined || subscription.sessionId === sessionId)
      )
        subscription.invalidate();
    }
  }

  onModuleDestroy(): void {
    this.stopping = true;
    for (const close of this.closers) close();
  }
}
