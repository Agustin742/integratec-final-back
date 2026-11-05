/**
 * Generates a clean URL-friendly slug from an input string.
 * Strips accents, lowers case, replaces non-alphanumeric chars with dashes,
 * and trims leading/trailing dashes.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'school';
}
