import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ListReportCardQueryDto } from '../metrics/metrics.dto';
import { StaffFamilyThreadsResponseDto } from './family-messages.dto';
import { FamilyMessagesService } from './family-messages.service';
import { FamilyLinksResponseDto, FamilyReportCardResponseDto } from './family.dto';
import { FamilyService } from './family.service';

@ApiTags('family')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired, or revoked access token.',
})
@Controller('me')
export class FamilyController {
  constructor(
    private readonly family: FamilyService,
    private readonly familyMessages: FamilyMessagesService,
  ) {}

  @Get('parent-links')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List active parent-child links for the authenticated user',
    description:
      'Returns all active parent links for the authenticated user whose classroom (and owning ' +
      'school, if any) is live and whose linked child is still an active enrolled student. ' +
      'Links in adult-mode classrooms are included with `adultMode: true` so clients can display ' +
      'them as disabled while adult mode is active. Ordered by `createdAt` ascending, then `id` ascending.',
  })
  @ApiOkResponse({
    type: FamilyLinksResponseDto,
    description: 'Active parent-child links for the authenticated user.',
  })
  listMyParentLinks(@CurrentUser('userId') actorUserId: string): Promise<FamilyLinksResponseDto> {
    return this.family.listMyParentLinks(actorUserId);
  }

  @Get('parent-links/:linkId/report-card')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'linkId', description: 'ParentLink UUID', format: 'uuid' })
  @ApiOperation({
    summary: "Read a linked child's report card and participation metrics",
    description:
      'Parent-only read view (HU-ACT-006) scoped to one active parent link. Reuses the same ' +
      'graded-activity report card and participation metrics as the student view. Returns `404` ' +
      'for malformed UUIDs, foreign or inactive links, deleted classrooms/schools, or removed ' +
      'students (strict anti-enumeration), and `403` while the classroom is in adult education mode.',
  })
  @ApiOkResponse({
    type: FamilyReportCardResponseDto,
    description: "The linked child's report card and participation metrics.",
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination parameters (`page`, `pageSize`).',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Parent viewing is disabled while the classroom is in adult education mode.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed, nonexistent, inactive, or inaccessible parent link.',
  })
  getChildReportCard(
    @CurrentUser('userId') actorUserId: string,
    @Param('linkId') linkId: string,
    @Query() query: ListReportCardQueryDto,
  ): Promise<FamilyReportCardResponseDto> {
    return this.family.getChildReportCard(actorUserId, linkId, query);
  }

  @Get('family-threads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List active parent-teacher messaging threads for staff classrooms',
    description:
      'Returns all active parent-child messaging threads across live, non-adult-mode classrooms ' +
      'where the authenticated user holds a staff role (`TEACHER`, `SCHOOL_OWNER`, or ' +
      '`SCHOOL_ADMIN`), including the latest visible message preview. Ordered by ' +
      '`lastMessageAt DESC NULLS LAST`, then `createdAt ASC`, then `id ASC`. Returns `{ items: [] }` ' +
      'without error for students, parents, or users without staff classrooms.',
  })
  @ApiOkResponse({
    type: StaffFamilyThreadsResponseDto,
    description: 'Active family messaging threads for the authenticated staff user.',
  })
  listMyFamilyThreads(
    @CurrentUser('userId') actorUserId: string,
  ): Promise<StaffFamilyThreadsResponseDto> {
    return this.familyMessages.listMyFamilyThreads(actorUserId);
  }
}
