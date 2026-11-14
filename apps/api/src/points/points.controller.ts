import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { PointsQueryDto, StudentWalletDto } from './points.dto';
import { PointsLedgerService } from './points-ledger.service';

@ApiTags('points')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@Controller('classrooms')
export class PointsController {
  constructor(private readonly points: PointsLedgerService) {}

  @Get(':id/points')
  @ApiOperation({
    summary: 'Get authenticated student points wallet and ledger movements',
    description:
      'Returns the server-derived points balance (SUM of ledger amounts) and paginated immutable movements for the authenticated active student in the classroom. Supports sort=createdAt|amount (prefix "-" for descending; default -createdAt) with a matching id tiebreaker. No balance writes or student-to-student transfers are permitted.',
  })
  @ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
  @ApiOkResponse({ type: StudentWalletDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination, sort, or unknown query parameters.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom, but caller is not an active enrolled student.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed, nonexistent, or inaccessible classroom.',
  })
  getOwnWallet(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: PointsQueryDto,
  ): Promise<StudentWalletDto> {
    return this.points.getOwnWallet(actorId, classroomId, query);
  }

  @Get(':id/students/:studentId/points')
  @ApiOperation({
    summary: 'Get a student points wallet and ledger movements',
    description:
      'Returns the server-derived points balance and paginated immutable movements for an active enrolled student in the classroom. Accessible to the student themselves, classroom staff (Owner, Admin, Teacher), and active linked parents when adultMode is disabled. Classmates receive 403; strangers, unlinked parents, and adult-mode parent requests receive 404. Supports sort=createdAt|amount (default -createdAt) with a matching id tiebreaker.',
  })
  @ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
  @ApiParam({ name: 'studentId', description: 'Target student user UUID', format: 'uuid' })
  @ApiOkResponse({ type: StudentWalletDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination, sort, or unknown query parameters.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Classmate student cannot access another student points wallet.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed, nonexistent, or inaccessible classroom or student resource.',
  })
  getStudentWallet(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('studentId') studentId: string,
    @Query() query: PointsQueryDto,
  ): Promise<StudentWalletDto> {
    return this.points.getStudentWallet(actorId, classroomId, studentId, query);
  }
}
