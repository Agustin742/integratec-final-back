import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorDetail as ErrorDetailShape,
  type ErrorEnvelope as ErrorEnvelopeShape,
} from './error-envelope';

/*
 * OpenAPI schemas for the error envelope. The TypeScript types in
 * `error-envelope.ts` stay the source of truth: each class below `implements`
 * the matching type, so the compiler fails if a field is added, renamed or
 * retyped on one side only, and the code list is generated from ERROR_CODES.
 * The class names become the component schema names (ErrorEnvelope, ...).
 */

export class ErrorDetail implements ErrorDetailShape {
  @ApiProperty({ example: 'address.city', description: 'Dotted path of the invalid field.' })
  field!: string;

  @ApiProperty({ type: [String], example: ['city must be longer than or equal to 3 characters'] })
  messages!: string[];
}

type ErrorBodyShape = ErrorEnvelopeShape['error'];

export class ErrorBody implements ErrorBodyShape {
  @ApiProperty({
    enum: Object.values(ERROR_CODES),
    enumName: 'ErrorCode',
    example: ERROR_CODES.VALIDATION_FAILED,
    description: 'Stable machine-readable code. Clients branch on this, never on the message.',
  })
  code!: ErrorCode;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({ type: [ErrorDetail], description: 'Per-field problems, when applicable.' })
  details?: ErrorDetail[];

  @ApiProperty({
    example: '3f2b8c1e-0d1a-4f4e-9a55-6f0c2f9c1a11',
    description: 'Echoes the x-request-id header; quote it when reporting a problem.',
  })
  correlationId!: string;
}

/** The single error body returned by every failing endpoint. */
export class ErrorEnvelope implements ErrorEnvelopeShape {
  @ApiProperty({ type: ErrorBody })
  error!: ErrorBody;
}
