import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthStatus as HealthStatusShape } from '@aula/contracts';
import { HealthStatus } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Returns 200 while the process is up. It does not probe the database.',
  })
  @ApiOkResponse({ type: HealthStatus, description: 'The API process is alive.' })
  getHealth(): HealthStatusShape {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
