import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
} from './error-envelope';

/*
 * OpenAPI schemas for the error envelope. The TypeScript types in
 * `error-envelope.ts` stay the source of truth: each class below `implements`
 * the matching type, so the compiler fails if a field is added, renamed or
 * retyped on one side only, and the code list is generated from ERROR_CODES.
 * `@ApiSchema` keeps the published component names (ErrorEnvelope, ...) equal
 * to the type names, while the classes carry a `Dto` suffix.
 */

@ApiSchema({ name: 'ErrorDetail' })
export class ErrorDetailDto implements ErrorDetail {
  @ApiProperty({ example: 'address.city', description: 'Dotted path of the invalid field.' })
  field!: string;

  @ApiProperty({ type: [String], example: ['city must be longer than or equal to 3 characters'] })
  messages!: string[];
}

type ErrorBody = ErrorEnvelope['error'];

@ApiSchema({ name: 'ErrorBody' })
export class ErrorBodyDto implements ErrorBody {
  @ApiProperty({
    enum: Object.values(ERROR_CODES),
    enumName: 'ErrorCode',
    example: ERROR_CODES.VALIDATION_FAILED,
    description: 'Stable machine-readable code. Clients branch on this, never on the message.',
  })
  code!: ErrorCode;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: [ErrorDetailDto],
    description: 'Per-field problems, when applicable.',
  })
  details?: ErrorDetailDto[];

  @ApiProperty({
    example: '3f2b8c1e-0d1a-4f4e-9a55-6f0c2f9c1a11',
    description: 'Echoes the x-request-id header; quote it when reporting a problem.',
  })
  correlationId!: string;
}

/** The single error body returned by every failing endpoint. */
@ApiSchema({ name: 'ErrorEnvelope' })
export class ErrorEnvelopeDto implements ErrorEnvelope {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
