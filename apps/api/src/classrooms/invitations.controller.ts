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
import { AcceptInvitationResponseDto } from './dto/join-classroom-response.dto';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: ClassroomInvitationsService) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an email invitation to join a classroom as student or guardian',
    description:
      'Atomically accepts a single-use STUDENT or PARENT email invitation. For STUDENT invitations, creates/reactivates classroom membership and assigns an available desk. For PARENT invitations, verifies adultMode is off, student is active, self-link is prevented, and the 2-guardian cap is respected, then creates/reactivates a ParentLink without creating a classroom membership or desk. Idempotent for already-active members and guardians.',
  })
  @ApiOkResponse({
    type: AcceptInvitationResponseDto,
    description: 'Classroom membership (STUDENT) or guardian link (PARENT) established.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invitation token is malformed, expired, revoked, or already used.',
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
    description:
      'Adult mode enabled, student no longer enrolled, self-link attempted, 2-guardian cap reached, or concurrent invitation acceptance conflict.',
  })
  async accept(
    @CurrentUser('userId') actorUserId: string,
    @Body() dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResponseDto> {
    return this.invitationsService.acceptEmailInvitation(actorUserId, dto);
  }
}
