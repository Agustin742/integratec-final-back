import { describe, expect, it } from 'vitest';
import { chunkExtractedSections } from './text-chunker';

describe('chunkExtractedSections', () => {
  it('assigns sequential chunkIndex across sections and normalizes whitespace', () => {
    const chunks = chunkExtractedSections(
      [
        { position: 'page 1', text: 'First   page\r\n\r\nwith   extra   spaces.' },
        { position: 'page 2', text: 'Second page content.' },
      ],
      { maxChars: 2400, overlapChars: 300 },
    );

    expect(chunks).toEqual([
      { chunkIndex: 0, position: 'page 1', content: 'First page\n\nwith extra spaces.' },
      { chunkIndex: 1, position: 'page 2', content: 'Second page content.' },
    ]);
  });

  it('drops blank sections and stops at maxChunks', () => {
    const chunks = chunkExtractedSections(
      [
        { position: 'page 1', text: '   \n\t  ' },
        { position: 'page 2', text: 'Alpha '.repeat(40) },
        { position: 'page 3', text: 'Beta '.repeat(40) },
      ],
      { maxChars: 60, overlapChars: 10, maxChunks: 3 },
    );

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(60);
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('splits long sections cleanly with bounded overlap and handles unbroken tokens', () => {
    const sentences = Array.from(
      { length: 8 },
      (_, i) => `Sentence number ${i + 1} explains cellular respiration clearly.`,
    ).join(' ');
    const chunks = chunkExtractedSections([{ position: 'page 1', text: sentences }], {
      maxChars: 140,
      overlapChars: 30,
    });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.position).toBe('page 1');
      expect(chunk.content.length).toBeLessThanOrEqual(140);
    }
    // Adjacent chunks share overlapping trailing/leading characters when split inside one section.
    expect(chunks[0]!.content.slice(-20).trim().length).toBeGreaterThan(0);
    expect(chunks[1]!.content).toContain(chunks[0]!.content.slice(-15).trim());

    const longWord = 'A'.repeat(250);
    const hardSplit = chunkExtractedSections([{ position: 'section 1', text: longWord }], {
      maxChars: 100,
      overlapChars: 20,
    });
    expect(hardSplit.length).toBeGreaterThanOrEqual(3);
    for (const chunk of hardSplit) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });
});
