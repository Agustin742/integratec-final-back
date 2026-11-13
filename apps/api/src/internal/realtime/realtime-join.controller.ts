import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { InternalServiceGuard } from './internal-service.guard';
import { RealtimeAccessService } from './realtime-access.service';
import {
  AccessReverificationRequestDto,
  JoinVerificationRequestDto,
  JoinVerificationResponseDto,
} from './realtime-join.dto';

/**
 * Called only by the realtime server from Colyseus `onAuth`: NestJS stays the single
 * authorization service. `@Public()` skips the user session guard (the caller has no
 * session of its own) and `InternalServiceGuard` takes its place. Excluded from the
 * public OpenAPI document and never routed by the reverse proxy.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller('internal/realtime')
export class RealtimeJoinController {
  constructor(private readonly access: RealtimeAccessService) {}

  @Post('join-verification')
  @HttpCode(HttpStatus.OK)
  async verifyJoin(@Body() dto: JoinVerificationRequestDto): Promise<JoinVerificationResponseDto> {
    return this.access.verifyJoin(dto.accessToken, dto.classroomId);
  }

  /** Called when a dropped connection comes back: the access is checked again from persisted state. */
  @Post('access-reverification')
  @HttpCode(HttpStatus.OK)
  async reverifyAccess(
    @Body() dto: AccessReverificationRequestDto,
  ): Promise<JoinVerificationResponseDto> {
    return this.access.reverify(dto.userId, dto.sessionId, dto.classroomId);
  }
}
