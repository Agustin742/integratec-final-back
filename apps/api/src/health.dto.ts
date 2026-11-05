import { ApiProperty } from '@nestjs/swagger';
import type { HealthStatus as HealthStatusShape } from '@aula/contracts';

/** OpenAPI schema of the liveness response; `implements` keeps it aligned with `@aula/contracts`. */
export class HealthStatus implements HealthStatusShape {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ example: 'api' })
  service!: string;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;
}
