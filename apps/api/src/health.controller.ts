import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthStatus } from '@aula/contracts';
import { HealthStatusDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Returns 200 while the process is up. It does not probe the database.',
  })
  @ApiOkResponse({ type: HealthStatusDto, description: 'The API process is alive.' })
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
