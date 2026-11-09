import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/**
 * Validation for user-visible single-line labels (display names, classroom names).
 *
 * Rejects C0/C1 control characters and Unicode line/paragraph separators, and requires at
 * least one character other than whitespace, default-ignorables (zero-width space, ZWNJ/ZWJ,
 * soft hyphen, BOM), combining marks or the braille blank. Surrounding whitespace is trimmed
 * after the forbidden-character check so edge newlines and tabs are rejected instead of being
 * silently erased. Ordinary Unicode text, punctuation and joiners inside a visible name are kept.
 *
 * Combine with `@IsString()`, `@IsNotEmpty()` and `@MaxLength(...)` on the property.
 */
export function VisibleText(property: string): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' && !FORBIDDEN_CHARACTERS.test(value) ? value.trim() : value,
    ),
    Matches(/^(?!.*[\p{Cc}\p{Zl}\p{Zp}])/su, {
      message: `${property} must not contain control characters or line breaks`,
    }),
    Matches(/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{M}\u2800]/u, {
      message: `${property} must contain a visible character`,
    }),
  );
}
