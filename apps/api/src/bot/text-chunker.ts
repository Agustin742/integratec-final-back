import type { ExtractedSection } from './text-extractor.service';

export interface TextChunk {
  chunkIndex: number;
  position: string;
  content: string;
}

export interface ChunkingOptions {
  maxChars: number;
  overlapChars: number;
  maxChunks?: number;
}

const DEFAULT_MAX_CHUNKS = 200;

/** Collapses horizontal spaces and excess blank lines while keeping paragraph breaks readable. */
function normalizeSectionText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findSplitEnd(text: string, start: number, maxChars: number): number {
  const hardEnd = Math.min(start + maxChars, text.length);
  if (hardEnd === text.length) return hardEnd;

  const window = text.slice(start, hardEnd);
  const minCut = Math.floor(maxChars * 0.5);

  const paragraphCut = window.lastIndexOf('\n\n');
  if (paragraphCut >= minCut) return start + paragraphCut;

  const lineCut = window.lastIndexOf('\n');
  if (lineCut >= minCut) return start + lineCut;

  const sentenceMatch = /[.!?]\s+(?=[^\s])/g;
  let lastSentence = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceMatch.exec(window)) !== null) {
    if (match.index + 1 >= minCut) {
      lastSentence = match.index + 1;
    }
  }
  if (lastSentence >= minCut) return start + lastSentence;

  const spaceCut = window.lastIndexOf(' ');
  if (spaceCut >= minCut) return start + spaceCut;

  return hardEnd;
}

/**
 * Splits extracted document sections into bounded, overlapping plain-text chunks
 * with deterministic sequential `chunkIndex` values.
 */
export function chunkExtractedSections(
  sections: readonly ExtractedSection[],
  options: ChunkingOptions,
): TextChunk[] {
  const maxChars = Math.max(50, Math.floor(options.maxChars));
  const overlapChars = Math.min(Math.max(0, Math.floor(options.overlapChars)), maxChars - 1);
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;

  const chunks: TextChunk[] = [];
  for (const section of sections) {
    const normalized = normalizeSectionText(section.text);
    if (normalized.length === 0) continue;

    let start = 0;
    while (start < normalized.length && chunks.length < maxChunks) {
      const end = findSplitEnd(normalized, start, maxChars);
      const slice = normalized.slice(start, end).trim();
      if (slice.length > 0) {
        chunks.push({
          chunkIndex: chunks.length,
          position: section.position,
          content: slice,
        });
      }
      if (end >= normalized.length) break;
      const nextStart = Math.max(start + 1, end - overlapChars);
      start = nextStart;
    }

    if (chunks.length >= maxChunks) break;
  }

  return chunks;
}
