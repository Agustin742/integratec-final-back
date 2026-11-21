import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { createCachedLoader } from '../submissions/submission-file-policy';

export interface ExtractedSection {
  position: string;
  text: string;
}

export class UnsupportedMaterialTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported material content type for indexing: ${contentType}`);
    this.name = 'UnsupportedMaterialTypeError';
  }
}

export class EmptyExtractedTextError extends Error {
  constructor() {
    super('No extractable text found in study material');
    this.name = 'EmptyExtractedTextError';
  }
}

export class MaterialExtractionError extends Error {
  constructor(message = 'Failed to extract study material text') {
    super(message);
    this.name = 'MaterialExtractionError';
  }
}

interface UnpdfModule {
  extractText: (
    data: Uint8Array,
    options?: { mergePages?: false },
  ) => Promise<{ totalPages: number; text: string[] }>;
}

/**
 * `unpdf` is ESM-only while `@aula/api` compiles to CommonJS (`module: commonjs`).
 * Loading via `createRequire` avoids `ts-node` / `moduleResolution: node` failing
 * on `exports`-only `.d.mts` packages and Vitest's `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`,
 * while working cleanly on Node 22.12+ / 24 (`require(esm)`).
 */
const loadUnpdf = createCachedLoader<UnpdfModule>(async () => {
  const basePath =
    typeof __filename === 'string' && __filename.length > 0
      ? __filename
      : join(process.cwd(), 'package.json');
  const requireFromHere = createRequire(basePath);
  return requireFromHere('unpdf') as UnpdfModule;
});

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_EXTRACTED_CHARS = 500_000;

// eslint-disable-next-line no-control-regex -- Strip NUL and non-whitespace control characters.
const UNSAFE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeText(raw: string): string {
  return raw.replace(UNSAFE_CONTROL_CHARS, '').trim();
}

function assertBoundedTotalChars(sections: readonly ExtractedSection[]): void {
  const total = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (total === 0) {
    throw new EmptyExtractedTextError();
  }
  if (total > MAX_EXTRACTED_CHARS) {
    throw new MaterialExtractionError('Extracted material text exceeds size bound');
  }
}

/**
 * Extracts bounded plain-text sections with source positions from supported
 * classroom study materials (`application/pdf`, DOCX, `text/plain`, `text/markdown`).
 */
@Injectable()
export class TextExtractorService {
  async extract(bytes: Uint8Array, contentType: string): Promise<ExtractedSection[]> {
    const normalizedMime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

    if (normalizedMime === 'application/pdf') {
      return this.extractPdf(bytes);
    }
    if (normalizedMime === DOCX_MIME) {
      return this.extractDocx(bytes);
    }
    if (normalizedMime === 'text/plain' || normalizedMime === 'text/markdown') {
      return this.extractPlainText(bytes);
    }
    throw new UnsupportedMaterialTypeError(contentType);
  }

  private async extractPdf(bytes: Uint8Array): Promise<ExtractedSection[]> {
    let result: { totalPages: number; text: string[] };
    try {
      const { extractText } = await loadUnpdf();
      result = await extractText(Uint8Array.from(bytes), { mergePages: false });
    } catch (error) {
      throw new MaterialExtractionError(
        error instanceof Error ? error.message : 'PDF extraction failed',
      );
    }

    const sections: ExtractedSection[] = [];
    for (let index = 0; index < result.text.length; index++) {
      const cleaned = sanitizeText(result.text[index] ?? '');
      if (cleaned.length > 0) {
        sections.push({ position: `page ${index + 1}`, text: cleaned });
      }
    }
    assertBoundedTotalChars(sections);
    return sections;
  }

  private async extractDocx(bytes: Uint8Array): Promise<ExtractedSection[]> {
    let rawValue: string;
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      rawValue = result.value;
    } catch (error) {
      throw new MaterialExtractionError(
        error instanceof Error ? error.message : 'DOCX extraction failed',
      );
    }

    const cleaned = sanitizeText(rawValue);
    if (cleaned.length === 0) {
      throw new EmptyExtractedTextError();
    }
    const sections = [{ position: 'section 1', text: cleaned }];
    assertBoundedTotalChars(sections);
    return sections;
  }

  private extractPlainText(bytes: Uint8Array): ExtractedSection[] {
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const cleaned = sanitizeText(decoded);
    if (cleaned.length === 0) {
      throw new EmptyExtractedTextError();
    }
    const sections = [{ position: 'section 1', text: cleaned }];
    assertBoundedTotalChars(sections);
    return sections;
  }
}
