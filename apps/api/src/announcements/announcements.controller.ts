import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import {
  AnnouncementDto,
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './announcements.dto';
import { AnnouncementsService } from './announcements.service';

/**
 * Transport adapter only: authorization and business rules live in `AnnouncementsService`.
 * Announcements are the classroom bulletin board (HU-COM-001); the notice board UI lives
 * in the frontend repository.
 */
@ApiTags('announcements')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, nonexistent or out-of-scope classroom or announcement.',
})
@Controller('classrooms/:id/announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @ApiOperation({
    summary: 'Publish an announcement',
    description:
      'Teacher-level staff only. `@Name` tokens are resolved against the classroom roster ' +
      '(at most 20 per announcement) and one in-app notification per enrolled student and ' +
      'mentioned member is recorded in the same transaction, so notices are delivered only ' +
      'after the publication commits.',
  })
  @ApiCreatedResponse({ type: AnnouncementDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role (for example a student).',
  })
  create(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.create(actorId, classroomId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List announcements',
    description:
      'Every classroom member reads the bulletin board chronologically (newest first, `id` ' +
      'tiebreaker); nobody but the author and school Owner/Admin may edit or remove. Linked ' +
      'parents are denied (403) while the parent-visibility decision is open. Removed ' +
      'announcements are never listed.',
  })
  @ApiPaginatedResponse(AnnouncementDto, 'Announcements without edit rights.')
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Invalid query parameters.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but no announcement access (for example a linked parent).',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListAnnouncementsQueryDto,
  ) {
    return this.announcements.list(actorId, classroomId, query);
  }

  @Patch(':announcementId')
  @ApiOperation({
    summary: 'Edit an announcement',
    description:
      'Teacher-level staff only. Authors may edit their own; school Owner/Admin may edit any. ' +
      'Mentions in the new content are re-resolved; only newly mentioned members are notified.',
  })
  @ApiParam({ name: 'announcementId', description: 'Announcement UUID' })
  @ApiOkResponse({ type: AnnouncementDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Not the author (or Owner/Admin).' })
  update(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('announcementId') announcementId: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(actorId, classroomId, announcementId, dto);
  }

  @Delete(':announcementId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove an announcement',
    description:
      'Teacher-level staff only. Logical deletion (`deletedAt`): authors may remove their own, ' +
      'school Owner/Admin any; rows are never physically removed.',
  })
  @ApiParam({ name: 'announcementId', description: 'Announcement UUID' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Not the author (or Owner/Admin).' })
  async remove(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('announcementId') announcementId: string,
  ): Promise<void> {
    await this.announcements.remove(actorId, classroomId, announcementId);
  }
}
