import { describe, expect, it } from 'vitest';
import {
  EmptyExtractedTextError,
  TextExtractorService,
  UnsupportedMaterialTypeError,
} from './text-extractor.service';
import { PNG_BYTES, buildMinimalDocx, buildMinimalPdf } from './testing/material-fixtures';

describe('TextExtractorService', () => {
  const extractor = new TextExtractorService();

  it('extracts per-page sections from PDF buffers', async () => {
    const pdf = buildMinimalPdf([
      'Photosynthesis happens in chloroplasts.',
      'Mitochondria produce cellular ATP.',
    ]);
    const sections = await extractor.extract(pdf, 'application/pdf');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ position: 'page 1' });
    expect(sections[0]!.text).toContain('Photosynthesis happens in chloroplasts.');
    expect(sections[1]).toMatchObject({ position: 'page 2' });
    expect(sections[1]!.text).toContain('Mitochondria produce cellular ATP.');
  });

  it('extracts text sections from DOCX buffers', async () => {
    const docx = buildMinimalDocx([
      'Unit 1: Equivalent fractions represent the same quantity.',
      'Multiply numerator and denominator by the same nonzero integer.',
    ]);
    const sections = await extractor.extract(
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const joined = sections.map((s) => s.text).join('\n');
    expect(joined).toContain('Equivalent fractions represent the same quantity.');
    expect(joined).toContain('Multiply numerator and denominator');
  });

  it('extracts UTF-8 plain text and markdown while stripping NUL/control bytes', async () => {
    const raw = Buffer.from('Line one\u0000\nLine two', 'utf8');
    const txt = await extractor.extract(raw, 'text/plain');
    expect(txt).toEqual([{ position: 'section 1', text: 'Line one\nLine two' }]);

    const md = await extractor.extract(Buffer.from('# Heading\nBody', 'utf8'), 'text/markdown');
    expect(md).toEqual([{ position: 'section 1', text: '# Heading\nBody' }]);
  });

  it('rejects unsupported MIME types and empty extracted text', async () => {
    await expect(extractor.extract(PNG_BYTES, 'image/png')).rejects.toBeInstanceOf(
      UnsupportedMaterialTypeError,
    );
    await expect(
      extractor.extract(Buffer.from('   \n\t ', 'utf8'), 'text/plain'),
    ).rejects.toBeInstanceOf(EmptyExtractedTextError);
  });
});
