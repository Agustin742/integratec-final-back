import { MAX_SIGNED_URL_TTL_SECONDS } from '../config/api-config';
import {
  StorageObjectNotFoundError,
  assertSafeStorageKey,
  type SignedDownloadUrlOptions,
  type StoragePort,
  type StoragePutOptions,
  type StoredObject,
} from '../platform/storage/storage.port';

export type StorageOperation = 'put' | 'get' | 'delete' | 'getSignedDownloadUrl';

export interface StorageCall {
  operation: StorageOperation;
  key: string;
}

export interface FailureOptions {
  /** Error to throw. Defaults to a generic `Error`. */
  error?: Error;
  /** Only fail calls for this key. Defaults to every key. */
  key?: string;
  /** Number of calls to fail, then behave normally again. Defaults to every call. */
  times?: number;
}

interface Failure {
  operation: StorageOperation;
  error: Error;
  key?: string;
  remaining: number;
}

export interface PutHookOptions {
  /** Number of puts to run the hook for, then it is removed. Defaults to every put. */
  times?: number;
}

interface PutHook {
  handler: (key: string) => void | Promise<void>;
  remaining: number;
}

const DEFAULT_TTL_SECONDS = 300;

/**
 * In-memory {@link StoragePort} for tests: same key validation and not-found behavior as the S3
 * adapter, plus failure injection (to exercise cleanup paths) and inspection helpers. A failed
 * operation never changes the stored state.
 */
export class InMemoryStorage implements StoragePort {
  private readonly objects = new Map<string, StoredObject>();
  private failures: Failure[] = [];
  private putHooks: PutHook[] = [];
  /** Every call in order, recorded before any injected failure is applied. */
  readonly calls: StorageCall[] = [];

  async put(key: string, body: Uint8Array, options: StoragePutOptions): Promise<void> {
    this.begin('put', key);
    this.objects.set(key, { body: body.slice(), contentType: options.contentType });
    await this.runPutHooks(key);
  }

  async get(key: string): Promise<StoredObject> {
    this.begin('get', key);
    const found = this.objects.get(key);
    if (!found) throw new StorageObjectNotFoundError();
    return { body: found.body.slice(), contentType: found.contentType };
  }

  async delete(key: string): Promise<void> {
    this.begin('delete', key);
    this.objects.delete(key);
  }

  async getSignedDownloadUrl(key: string, options?: SignedDownloadUrlOptions): Promise<string> {
    this.begin('getSignedDownloadUrl', key);
    const expiresIn = options?.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new RangeError(
        `Signed URL lifetime must be an integer between 1 and ${MAX_SIGNED_URL_TTL_SECONDS} seconds`,
      );
    }
    if (!this.objects.has(key)) throw new StorageObjectNotFoundError();
    return `https://storage.test/${key}?expiresIn=${expiresIn}`;
  }

  /** Makes `operation` throw, optionally for one key and a limited number of calls. */
  failOn(operation: StorageOperation, options: FailureOptions = {}): void {
    this.failures.push({
      operation,
      error: options.error ?? new Error(`Injected storage failure on ${operation}`),
      key: options.key,
      remaining: options.times ?? Number.POSITIVE_INFINITY,
    });
  }

  /**
   * Runs `handler` after each successful put (the object is already stored), for a limited number
   * of puts. Lets a test change other state, such as database rows, in the middle of an upload.
   * A hook that throws makes that put reject, like a failure injected after the write.
   */
  onPut(handler: (key: string) => void | Promise<void>, options: PutHookOptions = {}): void {
    this.putHooks.push({ handler, remaining: options.times ?? Number.POSITIVE_INFINITY });
  }

  clearHooks(): void {
    this.putHooks = [];
  }

  clearFailures(): void {
    this.failures = [];
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }

  /** Reads a stored object without recording a call or applying failures. */
  peek(key: string): StoredObject | undefined {
    const found = this.objects.get(key);
    return found && { body: found.body.slice(), contentType: found.contentType };
  }

  private async runPutHooks(key: string): Promise<void> {
    for (const hook of [...this.putHooks]) {
      if (hook.remaining <= 0) continue;
      hook.remaining -= 1;
      await hook.handler(key);
    }
    this.putHooks = this.putHooks.filter((hook) => hook.remaining > 0);
  }

  private begin(operation: StorageOperation, key: string): void {
    assertSafeStorageKey(key);
    this.calls.push({ operation, key });
    const failure = this.failures.find(
      (candidate) =>
        candidate.operation === operation &&
        candidate.remaining > 0 &&
        (candidate.key === undefined || candidate.key === key),
    );
    if (failure) {
      failure.remaining -= 1;
      throw failure.error;
    }
  }
}
