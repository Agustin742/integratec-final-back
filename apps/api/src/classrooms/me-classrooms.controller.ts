import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import { parseSort } from '../http/pagination/sort';
import type { Paginated } from '../http/pagination/paginated';
import { ClassroomsService } from './classrooms.service';
import { ClassroomListItemDto } from './dto/classroom-response.dto';
import { CLASSROOM_SORT_OPTIONS, ListClassroomsQueryDto } from './dto/list-classrooms-query.dto';

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
  @ApiPaginatedResponse(ClassroomListItemDto, 'Paginated list of accessible classrooms.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination or sort parameters (page, pageSize, sort).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  async listMyClassrooms(
    @CurrentUser('userId') actorUserId: string,
    @Query() query: ListClassroomsQueryDto,
  ): Promise<Paginated<ClassroomListItemDto>> {
    return this.classroomsService.listForActor(actorUserId, {
      page: query.page,
      pageSize: query.pageSize,
      sort: parseSort(query.sort, CLASSROOM_SORT_OPTIONS),
    });
  }
}
