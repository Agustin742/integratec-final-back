import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AccessVerificationService } from '../../access/access-verification.service';
import { Public } from '../../auth/public.decorator';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { InternalServiceGuard } from './internal-service.guard';
import { JoinVerificationRequestDto, JoinVerificationResponseDto } from './realtime-join.dto';

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
  constructor(
    private readonly sessions: SessionVerifier,
    private readonly access: AccessVerificationService,
  ) {}

  @Post('join-verification')
  @HttpCode(HttpStatus.OK)
  async verifyJoin(@Body() dto: JoinVerificationRequestDto): Promise<JoinVerificationResponseDto> {
    const { userId, sessionId } = await this.sessions.verifyToken(dto.accessToken);
    const { classroom, myRole } = await this.access.verifyClassroomAccess(userId, dto.classroomId, {
      requiredRole: 'ANY',
    });
    // Parents have no live classroom access (rules/realtime-and-presence.md, Join authorization).
    if (myRole === 'PARENT') {
      throw new ForbiddenException('Live classroom access is not available for this role');
    }
    return { userId, sessionId, classroomId: classroom.id, role: myRole };
  }
}
