import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { ConnectedTimeReportDto } from './connected-time.dto';
import { ConnectedTimeService } from './connected-time.service';
import { InternalServiceGuard } from './internal-service.guard';

/**
 * Called only by the realtime server when a user's presence in a classroom ends. It receives an
 * aggregate, never positions or per-tick data (rules/data.md, What is not persisted). Protected
 * like the join verification: `@Public()` skips the user session guard and the service secret
 * takes its place. Excluded from the public OpenAPI document and never routed by the proxy.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller('internal/realtime')
export class RealtimeConnectedTimeController {
  constructor(private readonly connectedTime: ConnectedTimeService) {}

  @Post('connected-time')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@Body() dto: ConnectedTimeReportDto): Promise<void> {
    await this.connectedTime.add(dto);
  }
}
