import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JoinClassroomResponseDto } from './dto/join-classroom-response.dto';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: ClassroomInvitationsService) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an email invitation to join a classroom',
    description:
      'Atomically binds the authenticated user account to the classroom specified in the email invitation and assigns an available desk. Idempotent: re-accepting by an already enrolled student succeeds and returns the existing desk without error.',
  })
  @ApiOkResponse({
    type: JoinClassroomResponseDto,
    description: 'Classroom membership established and desk assigned.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invitation token is malformed, expired, or already used.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invitation token does not exist or classroom was deleted.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'Concurrent invitation acceptance conflict.',
  })
  async accept(
    @CurrentUser('userId') actorUserId: string,
    @Body() dto: AcceptInvitationDto,
  ): Promise<JoinClassroomResponseDto> {
    return this.invitationsService.acceptEmailInvitation(actorUserId, dto);
  }
}
