import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import { parseSort } from '../http/pagination/sort';
import type { Paginated } from '../http/pagination/paginated';
import { ClassroomsService } from './classrooms.service';
import { ClassroomDetailResponseDto, ClassroomListItemDto } from './dto/classroom-response.dto';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { CLASSROOM_SORT_OPTIONS, ListClassroomsQueryDto } from './dto/list-classrooms-query.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a virtual classroom',
    description:
      'Atomically creates a persistent classroom together with its default classroom pet, initial desk layout, and school teacher membership when applicable. Allowed for independent teachers and school staff (Owner, Admin, Teacher).',
  })
  @ApiCreatedResponse({
    type: ClassroomDetailResponseDto,
    description: 'Classroom, pet, and initial desks created atomically.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'Validation failed (missing or invalid fields), or schoolId is missing for a caller who belongs to several schools.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description:
      'Caller is a student or parent related to the target school and is not allowed to create classrooms.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description:
      'Specified school does not exist or the caller has no relation to it (indistinguishable by design).',
  })
  async create(
    @CurrentUser('userId') actorUserId: string,
    @Body() dto: CreateClassroomDto,
  ): Promise<ClassroomDetailResponseDto> {
    return this.classroomsService.create(actorUserId, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List accessible classrooms',
    description:
      'Returns a paginated list (page, pageSize, sort=createdAt|name, default -createdAt) of classrooms accessible to the authenticated user (as School Owner/Admin, Teacher, enrolled Student, or active linked Parent when adultMode is false).',
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
  async list(
    @CurrentUser('userId') actorUserId: string,
    @Query() query: ListClassroomsQueryDto,
  ): Promise<Paginated<ClassroomListItemDto>> {
    return this.classroomsService.listForActor(actorUserId, {
      page: query.page,
      pageSize: query.pageSize,
      sort: parseSort(query.sort, CLASSROOM_SORT_OPTIONS),
    });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get classroom details and caller capabilities',
    description:
      'Returns the persistent state of a virtual classroom, its pet, desk count, and the server-derived role and capabilities for the authenticated caller.',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
    example: '4e5f6a7b-0000-4000-8000-000000000002',
  })
  @ApiOkResponse({
    type: ClassroomDetailResponseDto,
    description: 'Classroom details and caller capabilities.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom does not exist or caller has no relationship with it.',
  })
  async findOne(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
  ): Promise<ClassroomDetailResponseDto> {
    return this.classroomsService.findOne(actorUserId, classroomId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update classroom configuration and control flags',
    description:
      'Updates classroom name, subject, adultMode, or live control flags (chatMuted, collaborationLocked, gamesDisabled). Restricted to staff of the classroom (School Owner/Admin or the classroom Teacher).',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
    example: '4e5f6a7b-0000-4000-8000-000000000002',
  })
  @ApiOkResponse({
    type: ClassroomDetailResponseDto,
    description: 'Updated classroom details.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'Validation failed: invalid or unknown fields, invisible or control characters in name or subject, or an empty body (at least one field is required).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller is a member (student or parent) with insufficient role.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom does not exist or caller has no relationship with it.',
  })
  async update(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Body() dto: UpdateClassroomDto,
  ): Promise<ClassroomDetailResponseDto> {
    return this.classroomsService.update(actorUserId, classroomId, dto);
  }
}
