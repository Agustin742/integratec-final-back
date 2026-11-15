import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** Provisional issue #46 policy; see docs/study-material.md, not a malware scanner. */
export const MATERIAL_MAX_BYTES = 10 * 1024 * 1024;
export const MATERIAL_FILENAME_MAX = 120;

/** Memory-upload shape; deliberately independent of optional Express.Multer typings. */
export interface MaterialFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/** Identify the leading byte signature; do not infer type from the client declaration. */
export function validateMaterialFile(file: MaterialFile | undefined) {
  if (!file || file.buffer.length === 0) {
    throw new BadRequestException('One nonempty file is required');
  }
  if (file.buffer.length > MATERIAL_MAX_BYTES) throw new PayloadTooLargeException();
  const filename = file.originalname;
  if (
    filename.length > MATERIAL_FILENAME_MAX ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(filename)
  ) {
    throw new BadRequestException('Use a safe filename of at most 120 ASCII characters');
  }
  const bytes = file.buffer;
  let contentType: string;
  let extensions: readonly string[];
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    contentType = 'application/pdf';
    extensions = ['pdf'];
  } else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    contentType = 'image/png';
    extensions = ['png'];
  } else if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    contentType = 'image/jpeg';
    extensions = ['jpg', 'jpeg'];
  } else {
    throw new BadRequestException('Only PDF, PNG and JPEG byte signatures are supported');
  }
  const extension = filename.split('.').at(-1)?.toLowerCase() ?? '';
  if (file.mimetype !== contentType || !extensions.includes(extension)) {
    throw new BadRequestException('Filename extension and MIME type must match the file signature');
  }
  return { filename, contentType, sizeBytes: bytes.length };
}
