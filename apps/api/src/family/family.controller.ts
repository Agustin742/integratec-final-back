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
import { FamilyLinksResponseDto, FamilyReportCardResponseDto } from './family.dto';
import { FamilyService } from './family.service';

@ApiTags('family')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired, or revoked access token.',
})
@Controller('me/parent-links')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get()
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

  @Get(':linkId/report-card')
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
}
