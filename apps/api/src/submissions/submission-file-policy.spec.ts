import { describe, expect, it } from 'vitest';
import { InvalidStorageKeyError } from '../platform/storage/storage.port';
import {
  docxBytes,
  jpegBytes,
  pdfBytes,
  plainZipBytes,
  pngBytes,
  textBytes,
  withLength,
  xlsxBytes,
} from '../testing/file-fixtures';
import {
  SUBMISSION_ALLOWED_CONTENT_TYPES,
  SUBMISSION_MAX_FILES,
  SUBMISSION_MAX_FILE_BYTES,
  SUBMISSION_MAX_NAME_LENGTH,
  buildSubmissionStorageKey,
  sanitizeOriginalName,
  toErrorDetails,
  validateSubmissionFiles,
  type SubmissionFileInput,
  type SubmissionFileViolation,
} from './submission-file-policy';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function input(
  bytes: Uint8Array,
  originalName = 'work.pdf',
  declaredContentType = 'application/pdf',
): SubmissionFileInput {
  return { originalName, declaredContentType, bytes };
}

async function violations(files: SubmissionFileInput[]): Promise<SubmissionFileViolation[]> {
  const result = await validateSubmissionFiles(files);
  if (result.ok) throw new Error('expected violations');
  return result.violations;
}

describe('submission file constants', () => {
  it('match the database CHECK constraints', () => {
    expect(SUBMISSION_MAX_FILE_BYTES).toBe(10_485_760);
    expect(SUBMISSION_MAX_FILES).toBe(5);
    expect(SUBMISSION_MAX_NAME_LENGTH).toBe(255);
    expect([...SUBMISSION_ALLOWED_CONTENT_TYPES]).toEqual([
      'application/pdf',
      'image/png',
      'image/jpeg',
      DOCX,
    ]);
  });
});

describe('validateSubmissionFiles', () => {
  it.each([
    ['PDF', pdfBytes(), 'application/pdf'],
    ['PNG', pngBytes(), 'image/png'],
    ['JPEG', jpegBytes(), 'image/jpeg'],
    ['DOCX', docxBytes(), DOCX],
  ])('accepts a real %s and reports the detected type and size', async (_n, bytes, type) => {
    const result = await validateSubmissionFiles([
      input(bytes, 'a.bin', 'application/octet-stream'),
    ]);
    expect(result).toEqual({
      ok: true,
      files: [{ originalName: 'a.bin', contentType: type, sizeBytes: bytes.byteLength, bytes }],
    });
  });

  it('uses the detected type when the client declares another one', async () => {
    const result = await validateSubmissionFiles([input(pngBytes(), 'x.pdf', 'application/pdf')]);
    expect(result.ok && result.files[0]?.contentType).toBe('image/png');
  });

  it.each([
    ['plain text renamed .pdf', textBytes()],
    ['unknown bytes', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])],
    ['a plain zip', plainZipBytes()],
    ['an xlsx package', xlsxBytes()],
    ['a Windows executable', Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])],
  ])('rejects %s even when declared as a PDF', async (_n, bytes) => {
    expect(await violations([input(bytes, 'report.pdf')])).toEqual([
      expect.objectContaining({ code: 'UNSUPPORTED_TYPE', index: 0 }),
    ]);
  });

  it('accepts exactly 10 MB and rejects one byte more', async () => {
    const atLimit = withLength(pdfBytes(), SUBMISSION_MAX_FILE_BYTES);
    const over = withLength(pdfBytes(), SUBMISSION_MAX_FILE_BYTES + 1);
    expect((await validateSubmissionFiles([input(atLimit)])).ok).toBe(true);
    expect(await violations([input(over)])).toEqual([
      expect.objectContaining({ code: 'FILE_TOO_LARGE', index: 0 }),
    ]);
  });

  it('rejects an empty file', async () => {
    expect(await violations([input(new Uint8Array(0))])).toEqual([
      expect.objectContaining({ code: 'EMPTY_FILE', index: 0 }),
    ]);
  });

  it('rejects zero files and more than five, accepts five', async () => {
    expect(await violations([])).toEqual([expect.objectContaining({ code: 'NO_FILES' })]);
    const six = Array.from({ length: 6 }, () => input(pdfBytes()));
    expect(await violations(six)).toEqual([expect.objectContaining({ code: 'TOO_MANY_FILES' })]);
    const five = Array.from({ length: 5 }, () => input(pdfBytes()));
    expect((await validateSubmissionFiles(five)).ok).toBe(true);
  });

  it('reports every offending file with its index', async () => {
    const found = await violations([
      input(pdfBytes()),
      input(textBytes(), 'b.pdf'),
      input(new Uint8Array(0), 'c.pdf'),
    ]);
    expect(found.map((v) => [v.code, v.index])).toEqual([
      ['UNSUPPORTED_TYPE', 1],
      ['EMPTY_FILE', 2],
    ]);
  });

  it('rejects names that are empty or longer than 255 characters', async () => {
    const long = `${'a'.repeat(252)}.pdf`;
    expect(await violations([input(pdfBytes(), long)])).toEqual([
      expect.objectContaining({ code: 'INVALID_NAME', index: 0 }),
    ]);
    expect(await violations([input(pdfBytes(), '  ')])).toEqual([
      expect.objectContaining({ code: 'INVALID_NAME', index: 0 }),
    ]);
    const atLimit = `${'a'.repeat(251)}.pdf`;
    expect((await validateSubmissionFiles([input(pdfBytes(), atLimit)])).ok).toBe(true);
  });

  it('stores the sanitized name', async () => {
    const result = await validateSubmissionFiles([
      input(pdfBytes(), '..\\..\\etc/passwd\u0000.pdf'),
    ]);
    expect(result.ok && result.files[0]?.originalName).toBe('passwd.pdf');
  });
});

describe('sanitizeOriginalName', () => {
  it.each([
    ['../../secret.pdf', 'secret.pdf'],
    ['C:\\Users\\me\\tp.docx', 'tp.docx'],
    ['  spaced name.png  ', 'spaced name.png'],
    ['bad\u0007\u001fname.pdf', 'badname.pdf'],
    ['ok.pdf', 'ok.pdf'],
    ['ñandú 📄.pdf', 'ñandú 📄.pdf'],
  ])('%j -> %j', (raw, expected) => {
    expect(sanitizeOriginalName(raw)).toBe(expected);
  });

  it.each(['', '..', '.', '/', 'a/'])('returns empty for %j', (raw) => {
    expect(sanitizeOriginalName(raw)).toBe('');
  });
});

describe('toErrorDetails', () => {
  it('maps violations to envelope details grouped by field', () => {
    expect(
      toErrorDetails([
        { code: 'TOO_MANY_FILES', message: 'Attach at most 5 files' },
        { code: 'EMPTY_FILE', index: 2, message: 'File is empty' },
        { code: 'UNSUPPORTED_TYPE', index: 2, message: 'Type not allowed' },
      ]),
    ).toEqual([
      { field: 'files', messages: ['Attach at most 5 files'] },
      { field: 'files[2]', messages: ['File is empty', 'Type not allowed'] },
    ]);
  });
});

describe('buildSubmissionStorageKey', () => {
  const ids = {
    classroomId: '11111111-1111-4111-8111-111111111111',
    activityId: '22222222-2222-4222-8222-222222222222',
    studentId: '33333333-3333-4333-8333-333333333333',
    fileId: '44444444-4444-4444-8444-444444444444',
  };

  it('builds submissions/<classroom>/<activity>/<student>/<file> without any user name', () => {
    expect(buildSubmissionStorageKey(ids)).toBe(
      `submissions/${ids.classroomId}/${ids.activityId}/${ids.studentId}/${ids.fileId}`,
    );
  });

  it.each(['', 'a/b', '..', 'a b', '../x', 'x\\y'])('rejects the unsafe id %j', (bad) => {
    expect(() => buildSubmissionStorageKey({ ...ids, fileId: bad })).toThrow(
      InvalidStorageKeyError,
    );
  });
});
