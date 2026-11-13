import { InvalidStorageKeyError, assertSafeStorageKey } from '../platform/storage/storage.port';
import type { ErrorDetail } from '../http/error-envelope';

/**
 * Submission file policy. These limits mirror the CHECK constraints of the
 * `submission_files` table (migration 20261113120000_create_submissions); change both together.
 * The multipart layer reuses the numeric limits so oversized uploads are cut off early.
 */
export const SUBMISSION_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type SubmissionContentType = (typeof SUBMISSION_ALLOWED_CONTENT_TYPES)[number];

export const SUBMISSION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SUBMISSION_MIN_FILES = 1;
export const SUBMISSION_MAX_FILES = 5;
export const SUBMISSION_MAX_NAME_LENGTH = 255;

/** A file as received from the client. `declaredContentType` is informational and never trusted. */
export interface SubmissionFileInput {
  originalName: string;
  declaredContentType?: string;
  bytes: Uint8Array;
}

export interface AcceptedSubmissionFile {
  /** Sanitized display name, safe to store as metadata. Never used in the storage key. */
  originalName: string;
  /** Type detected from the bytes (magic number), not from the client. */
  contentType: SubmissionContentType;
  sizeBytes: number;
  bytes: Uint8Array;
}

export type SubmissionFileViolationCode =
  | 'NO_FILES'
  | 'TOO_MANY_FILES'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'INVALID_NAME';

export interface SubmissionFileViolation {
  code: SubmissionFileViolationCode;
  /** Position of the offending file in the request; absent for whole-request violations. */
  index?: number;
  message: string;
}

export type SubmissionFilesValidation =
  | { ok: true; files: AcceptedSubmissionFile[] }
  | { ok: false; violations: SubmissionFileViolation[] };

type FileTypeModule = typeof import('file-type');
let fileTypeModule: Promise<FileTypeModule> | undefined;

/**
 * `file-type` is ESM-only while the API compiles to CommonJS. A dynamic `import()` compiles to
 * `require()`, which Node >= 22.12 can load for ESM without top-level await (the repo requires
 * Node 22); Vitest resolves it natively. Loaded lazily and once.
 */
function loadFileType(): Promise<FileTypeModule> {
  fileTypeModule ??= import('file-type');
  return fileTypeModule;
}

const ALLOWED = new Set<string>(SUBMISSION_ALLOWED_CONTENT_TYPES);

function isAllowed(mime: string | undefined): mime is SubmissionContentType {
  return mime !== undefined && ALLOWED.has(mime);
}

/**
 * Validates a whole submission. The type is detected from the bytes: the declared MIME and the
 * extension are ignored, so a renamed executable or a plain/XLSX zip never passes as DOCX.
 * Violations are collected for every file so the client can fix them in one round trip.
 */
export async function validateSubmissionFiles(
  files: readonly SubmissionFileInput[],
): Promise<SubmissionFilesValidation> {
  if (files.length < SUBMISSION_MIN_FILES) {
    return {
      ok: false,
      violations: [{ code: 'NO_FILES', message: 'Attach at least one file' }],
    };
  }
  if (files.length > SUBMISSION_MAX_FILES) {
    return {
      ok: false,
      violations: [
        {
          code: 'TOO_MANY_FILES',
          message: `Attach at most ${SUBMISSION_MAX_FILES} files`,
        },
      ],
    };
  }

  const { fileTypeFromBuffer } = await loadFileType();
  const accepted: AcceptedSubmissionFile[] = [];
  const violations: SubmissionFileViolation[] = [];

  for (const [index, file] of files.entries()) {
    const before = violations.length;
    const originalName = sanitizeOriginalName(file.originalName);
    if (originalName === '' || [...originalName].length > SUBMISSION_MAX_NAME_LENGTH) {
      violations.push({
        code: 'INVALID_NAME',
        index,
        message: `File name must be between 1 and ${SUBMISSION_MAX_NAME_LENGTH} characters`,
      });
    }

    const size = file.bytes.byteLength;
    let contentType: SubmissionContentType | undefined;
    if (size === 0) {
      violations.push({ code: 'EMPTY_FILE', index, message: 'File is empty' });
    } else if (size > SUBMISSION_MAX_FILE_BYTES) {
      violations.push({
        code: 'FILE_TOO_LARGE',
        index,
        message: `File must not exceed ${SUBMISSION_MAX_FILE_BYTES / (1024 * 1024)} MB`,
      });
    } else {
      const detected = await fileTypeFromBuffer(file.bytes);
      if (isAllowed(detected?.mime)) {
        contentType = detected.mime;
      } else {
        violations.push({
          code: 'UNSUPPORTED_TYPE',
          index,
          message: 'File type is not allowed; use PDF, PNG, JPEG or DOCX',
        });
      }
    }

    if (violations.length === before && contentType) {
      accepted.push({ originalName, contentType, sizeBytes: size, bytes: file.bytes });
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true, files: accepted };
}

/**
 * Maps violations to the error-envelope `details` (`VALIDATION_FAILED`, HTTP 400), grouped by
 * field: `files` for whole-request violations and `files[<index>]` per file.
 */
export function toErrorDetails(violations: readonly SubmissionFileViolation[]): ErrorDetail[] {
  const byField = new Map<string, string[]>();
  for (const violation of violations) {
    const field = violation.index === undefined ? 'files' : `files[${violation.index}]`;
    byField.set(field, [...(byField.get(field) ?? []), violation.message]);
  }
  return [...byField].map(([field, messages]) => ({ field, messages }));
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Reduces a client file name to a display name: keeps only the part after the last `/` or `\`,
 * drops control characters and trims. Returns `''` when nothing usable remains (including `.`
 * and `..`). The result is metadata only and must never be part of a storage key.
 */
export function sanitizeOriginalName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = base.replace(CONTROL_CHARACTERS, '').trim();
  return name === '.' || name === '..' ? '' : name;
}

export interface SubmissionStorageKeyParts {
  classroomId: string;
  activityId: string;
  studentId: string;
  fileId: string;
}

const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** `submissions/<classroomId>/<activityId>/<studentId>/<fileId>`: ids only, never a user file name. */
export function buildSubmissionStorageKey(parts: SubmissionStorageKeyParts): string {
  for (const [name, value] of Object.entries(parts)) {
    if (!KEY_SEGMENT.test(value)) {
      throw new InvalidStorageKeyError(`${name} must contain only letters, digits, "-" or "_"`);
    }
  }
  const key = ['submissions', parts.classroomId, parts.activityId, parts.studentId, parts.fileId];
  const joined = key.join('/');
  assertSafeStorageKey(joined);
  return joined;
}
