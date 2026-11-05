import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import type { HealthStatus } from '@aula/contracts';

/**
 * OpenAPI schema of the liveness response; `implements` keeps it aligned with
 * `@aula/contracts`. Published in the document as `HealthStatus`.
 */
@ApiSchema({ name: 'HealthStatus' })
export class HealthStatusDto implements HealthStatus {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ example: 'api' })
  service!: string;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;
}
