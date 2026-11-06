import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  MaxLength,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/** Minimum password length, without composition rules (assumption P-02). */
export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt ignores input past 72 bytes, so longer passwords are rejected instead of truncated. */
export const PASSWORD_MAX_LENGTH = 72;

export function MaxUtf8Bytes(maxBytes: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const [limit] = args.constraints as [number];
          return Buffer.byteLength(value, 'utf8') <= limit;
        },
        defaultMessage(args: ValidationArguments) {
          const [limit] = args.constraints as [number];
          return `${args.property} must not exceed ${limit} UTF-8 bytes`;
        },
      },
    });
  };
}

/**
 * Validation of a password being chosen (registration and password reset), so both
 * flows enforce the same policy. Login deliberately does not use it: it must accept
 * whatever an existing account holds.
 */
export function PasswordPolicy(): PropertyDecorator {
  const message = (rule: string) => (args: ValidationArguments) => `${args.property} ${rule}`;
  return applyDecorators(
    IsString({ message: message('must be a string') }),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: message(`must be at least ${PASSWORD_MIN_LENGTH} characters long`),
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: message(`must not exceed ${PASSWORD_MAX_LENGTH} characters`),
    }),
    MaxUtf8Bytes(PASSWORD_MAX_LENGTH, {
      message: message(`must not exceed ${PASSWORD_MAX_LENGTH} UTF-8 bytes`),
    }) as PropertyDecorator,
  );
}
