import { describe, expect, it, vi } from 'vitest';
import { pdfBytes, textBytes } from '../testing/file-fixtures';
import { validateSubmissionFiles } from './submission-file-policy';

// No real input makes file-type throw (truncated zips are still reported as zip), so the
// detector is mocked to throw for one marker payload and behave normally otherwise.
vi.mock('file-type', async (importOriginal) => {
  const actual = await importOriginal<typeof import('file-type')>();
  return {
    ...actual,
    fileTypeFromBuffer: (bytes: Uint8Array) => {
      if (bytes.byteLength === 7) throw new Error('corrupt archive');
      return actual.fileTypeFromBuffer(bytes);
    },
  };
});

describe('validateSubmissionFiles when detection throws', () => {
  it('reports UNSUPPORTED_TYPE for that file only instead of failing the request', async () => {
    const result = await validateSubmissionFiles([
      { originalName: 'ok.pdf', bytes: pdfBytes() },
      { originalName: 'broken.docx', bytes: new Uint8Array(7) },
      { originalName: 'note.pdf', bytes: textBytes() },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((v) => [v.code, v.index])).toEqual([
      ['UNSUPPORTED_TYPE', 1],
      ['UNSUPPORTED_TYPE', 2],
    ]);
  });
});
