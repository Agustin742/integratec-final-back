import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import {
  CreateParentLinkMessageDto,
  ListParentLinkMessagesQueryDto,
  ParentLinkMessageDto,
  ParentLinkMessagesResponseDto,
} from './family-messages.dto';
import { FamilyMessagesService } from './family-messages.service';

@ApiTags('family')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired, or revoked access token.',
})
@Controller('parent-links')
export class ParentLinkMessagesController {
  constructor(private readonly familyMessages: FamilyMessagesService) {}

  @Get(':linkId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'linkId', description: 'ParentLink UUID', format: 'uuid' })
  @ApiOperation({
    summary: 'List private messages for a parent-teacher thread',
    description:
      'Returns paginated visible messages for one active parent-child link, ordered ' +
      'chronologically (`createdAt ASC, id ASC`) for natural conversation reading. Accessible ' +
      "only to the linked parent and the classroom's active teacher (independent teacher or " +
      'active classroom `TEACHER` membership with active school `TEACHER` membership when ' +
      'school-owned). School Owner/Admin authority does not grant access, even with a teaching ' +
      'membership; an actual parent link is evaluated separately. ' +
      'Returns `404` for malformed UUIDs, inactive links, deleted classrooms/schools, removed ' +
      'students, or any other caller including the linked student (strict anti-enumeration), ' +
      'and `403` while the classroom is in adult education mode.',
  })
  @ApiOkResponse({
    type: ParentLinkMessagesResponseDto,
    description: 'Paginated chronological messages for the parent-teacher thread.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination parameters (`page`, `pageSize`).',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Parent messaging is disabled while the classroom is in adult education mode.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed, nonexistent, inactive, or inaccessible parent link.',
  })
  listMessages(
    @CurrentUser('userId') actorUserId: string,
    @Param('linkId') linkId: string,
    @Query() query: ListParentLinkMessagesQueryDto,
  ): Promise<ParentLinkMessagesResponseDto> {
    return this.familyMessages.listMessages(actorUserId, linkId, query);
  }

  @Post(':linkId/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'linkId', description: 'ParentLink UUID', format: 'uuid' })
  @ApiOperation({
    summary: 'Send a private message in a parent-teacher thread',
    description:
      'Persists a new plain-text message bound to one active parent-child link (`classroomId: null`). ' +
      "Accessible only to the linked parent and the classroom's active teacher (independent teacher " +
      'or active classroom `TEACHER` membership with active school `TEACHER` membership when ' +
      'school-owned), not school Owner/Admin acting as staff (even with a teaching membership). ' +
      'Actual linked-parent access is separate. ' +
      'Allows at most 5 messages per author/thread in a rolling 10-second window; concurrent sends ' +
      'for that pair may return `429` without writing. Returns `404` for malformed UUIDs, inactive links, deleted classrooms/schools, ' +
      'removed students, or any other caller including the linked student (strict anti-enumeration), ' +
      'and `403` while the classroom is in adult education mode.',
  })
  @ApiCreatedResponse({
    type: ParentLinkMessageDto,
    description: 'The newly created parent-teacher message.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid message body (empty, overlong, or unsafe control characters).',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Parent messaging is disabled while the classroom is in adult education mode.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed, nonexistent, inactive, or inaccessible parent link.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorEnvelopeDto,
    description:
      'Per-author/thread send window exceeded or another send is in flight. No message is written.',
  })
  createMessage(
    @CurrentUser('userId') actorUserId: string,
    @Param('linkId') linkId: string,
    @Body() dto: CreateParentLinkMessageDto,
  ): Promise<ParentLinkMessageDto> {
    return this.familyMessages.createMessage(actorUserId, linkId, dto);
  }
}
