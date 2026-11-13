import { crc32 } from 'node:zlib';

const encoder = new TextEncoder();

/** Minimal bytes whose magic number is a PDF. */
export function pdfBytes(): Uint8Array {
  return encoder.encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
}

/** PNG signature followed by a valid IHDR chunk. */
export function pngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
  ]);
}

/** JPEG SOI + JFIF APP0 segment + EOI. */
export function jpegBytes(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/** Minimal Word package: a stored zip with `[Content_Types].xml` and `word/document.xml`. */
export function docxBytes(): Uint8Array {
  return zipBytes([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    { name: '_rels/.rels', content: '<Relationships/>' },
    { name: 'word/document.xml', content: '<w:document/>' },
  ]);
}

/** Spreadsheet package (OOXML but not Word). */
export function xlsxBytes(): Uint8Array {
  return zipBytes([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: '_rels/.rels', content: '<Relationships/>' },
    { name: 'xl/workbook.xml', content: '<workbook/>' },
  ]);
}

/** A generic zip that is not an Office document. */
export function plainZipBytes(): Uint8Array {
  return zipBytes([{ name: 'notes.txt', content: 'hello' }]);
}

export function textBytes(text = 'Just a plain text note, no magic number.'): Uint8Array {
  return encoder.encode(text);
}

/** DOS/Windows executable header (`MZ`), the classic upload to disguise as a document. */
export function exeBytes(): Uint8Array {
  return Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
}

/** Zero-padded buffer of exactly `length` bytes that starts with `header`. */
export function withLength(header: Uint8Array, length: number): Uint8Array {
  if (header.byteLength > length) throw new RangeError('header longer than requested length');
  const out = new Uint8Array(length);
  out.set(header);
  return out;
}

export interface ZipEntry {
  name: string;
  content: string;
}

/** Builds a zip with stored (uncompressed) entries; enough for magic-number tests. */
export function zipBytes(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + data.length;
  }
  const directory = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);
  return concat([...chunks, directory, end]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
