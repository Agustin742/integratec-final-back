import { plainToInstance } from 'class-transformer';
import { IsString, validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { VisibleText } from './visible-text';

class Sample {
  @VisibleText('label')
  @IsString()
  label!: string;
}

const messagesFor = async (value: unknown): Promise<string[]> => {
  const instance = plainToInstance(Sample, { label: value });
  const errors = await validate(instance);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('VisibleText', () => {
  it.each([
    ['ordinary text', 'Matemática 3° B'],
    ['non-latin script', '数学 – 三年级'],
    ['emoji with joiners inside a visible name', 'Aula 👩‍🏫'],
    ['combining marks on a base letter', 'Café'],
    ['surrounding spaces trimmed away', '  Aula  '],
  ])('accepts %s', async (_label, value) => {
    expect(await messagesFor(value)).toEqual([]);
    expect(plainToInstance(Sample, { label: value }).label).toBe(value.trim());
  });

  it.each([
    ['zero-width space', '​'],
    ['ZWNJ only', '‌'],
    ['ZWJ only', '‍‍'],
    ['soft hyphen', '­'],
    ['BOM / zero-width no-break space', '﻿'],
    ['braille blank', '⠀'],
    ['combining mark only', '́'],
    ['spaces around a zero-width space', '  ​  '],
  ])('rejects an invisible-only value: %s', async (_label, value) => {
    expect(await messagesFor(value)).toContain('label must contain a visible character');
  });

  it.each([
    ['newline', 'Aula\nB'],
    ['leading newline', '\nAula'],
    ['trailing tab', 'Aula\t'],
    ['NUL', 'Aula\u0000'],
    ['C1 control', 'Aula\u0085'],
    ['line separator U+2028', 'Aula B'],
    ['paragraph separator U+2029', 'Aula B'],
  ])('rejects control characters and line breaks: %s', async (_label, value) => {
    expect(await messagesFor(value)).toContain(
      'label must not contain control characters or line breaks',
    );
  });
});
