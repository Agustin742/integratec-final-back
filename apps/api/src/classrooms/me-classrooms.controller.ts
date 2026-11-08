import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ClassroomsService } from './classrooms.service';
import { PaginatedClassroomsResponseDto } from './dto/classroom-response.dto';
import { ListClassroomsQueryDto } from './dto/list-classrooms-query.dto';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('me/classrooms')
export class MeClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List classrooms accessible to the authenticated user',
    description:
      'Returns a paginated list of classrooms accessible to the authenticated user (as School Owner/Admin, Teacher, enrolled Student, or active linked Parent when adultMode is false) with derived role and capabilities.',
  })
  @ApiOkResponse({
    type: PaginatedClassroomsResponseDto,
    description: 'Paginated list of accessible classrooms for the current user.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination or ordering parameters.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  async listMyClassrooms(
    @CurrentUser('userId') actorUserId: string,
    @Query() query: ListClassroomsQueryDto,
  ): Promise<PaginatedClassroomsResponseDto> {
    return this.classroomsService.listForActor(actorUserId, query);
  }
}
