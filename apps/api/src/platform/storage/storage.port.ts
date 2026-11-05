export interface StoragePutOptions {
  /** MIME type stored with the object and returned on download. */
  contentType: string;
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string | undefined;
}

export interface SignedDownloadUrlOptions {
  /** Lifetime in whole seconds (1 second up to the configured maximum of one hour). Defaults to configuration. */
  expiresInSeconds?: number;
}

/**
 * Object storage boundary. Features depend on this, never on S3. Keys are opaque
 * strings chosen by the caller (for example `materials/<classroomId>/<fileId>`);
 * they must pass {@link assertSafeStorageKey}. Content validation (type allow-list,
 * size, count) belongs to the calling story, not to the port.
 */
export interface StoragePort {
  /** Stores `body` under `key`, replacing any existing object. */
  put(key: string, body: Uint8Array, options: StoragePutOptions): Promise<void>;
  /** Reads an object. Throws {@link StorageObjectNotFoundError} when it does not exist. */
  get(key: string): Promise<StoredObject>;
  /** Removes an object. Deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
  /** Returns a short-lived URL that downloads the object without credentials. */
  getSignedDownloadUrl(key: string, options?: SignedDownloadUrlOptions): Promise<string>;
}

/** Injection token for the {@link StoragePort} implementation. */
export const STORAGE_PORT = Symbol('STORAGE_PORT');

export class StorageObjectNotFoundError extends Error {
  constructor() {
    super('Storage object not found');
    this.name = 'StorageObjectNotFoundError';
  }
}

export class InvalidStorageKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid storage key: ${reason}`);
    this.name = 'InvalidStorageKeyError';
  }
}

const MAX_KEY_BYTES = 1024;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Rejects keys that could escape a prefix or that are ambiguous across providers. */
export function assertSafeStorageKey(key: string): void {
  if (key === '') throw new InvalidStorageKeyError('must not be empty');
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new InvalidStorageKeyError(`must be at most ${MAX_KEY_BYTES} bytes`);
  }
  if (key.startsWith('/')) throw new InvalidStorageKeyError('must not start with "/"');
  if (key.includes('\\')) throw new InvalidStorageKeyError('must not contain "\\"');
  if (CONTROL_CHARACTERS.test(key)) {
    throw new InvalidStorageKeyError('must not contain control characters');
  }
  const segments = key.split('/');
  if (segments.some((segment) => segment === '')) {
    throw new InvalidStorageKeyError('must not contain empty path segments');
  }
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new InvalidStorageKeyError('must not contain "." or ".." path segments');
  }
}
