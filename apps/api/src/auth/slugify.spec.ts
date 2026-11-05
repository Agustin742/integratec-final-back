import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('converts basic text to lowercase with hyphens', () => {
    expect(slugify('Colegio Modelo')).toBe('colegio-modelo');
  });

  it('normalizes and strips accents and diacritical marks', () => {
    expect(slugify('Colegio San Martín y Belgrano')).toBe('colegio-san-martin-y-belgrano');
    expect(slugify('Instituto José Hernández')).toBe('instituto-jose-hernandez');
  });

  it('collapses consecutive non-alphanumeric characters into a single hyphen', () => {
    expect(slugify('Colegio   ---   Belgrano !#@ Day')).toBe('colegio-belgrano-day');
  });

  it('trims leading and trailing hyphens and whitespace', () => {
    expect(slugify('  -- Escuela Primaria N 1 -- ')).toBe('escuela-primaria-n-1');
  });

  it('falls back to "school" if text contains no alphanumeric characters', () => {
    expect(slugify('   !!! ??? ---   ')).toBe('school');
    expect(slugify('')).toBe('school');
  });
});
