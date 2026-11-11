import {
  Body,
  Controller,
  Delete,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import { parseSort } from '../http/pagination/sort';
import type { Paginated } from '../http/pagination/paginated';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { ClassroomsService } from './classrooms.service';
import { ClassroomDetailResponseDto, ClassroomListItemDto } from './dto/classroom-response.dto';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { CreateClassroomInvitationDto } from './dto/create-invitation.dto';
import { CreateJoinCodeDto } from './dto/create-join-code.dto';
import {
  ClassroomInvitationResponseDto,
  CreatedClassroomInvitationResponseDto,
  RevokeInvitationResponseDto,
} from './dto/invitation-response.dto';
import { JoinClassroomResponseDto } from './dto/join-classroom-response.dto';
import { JoinClassroomWithCodeDto } from './dto/join-classroom.dto';
import { JoinCodeResponseDto } from './dto/join-code-response.dto';
import { CLASSROOM_SORT_OPTIONS, ListClassroomsQueryDto } from './dto/list-classrooms-query.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomsController {
  constructor(
    private readonly classroomsService: ClassroomsService,
    private readonly invitationsService: ClassroomInvitationsService,
  ) {}

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

  @Post('join')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Join a classroom with access code',
    description:
      'Redeems a valid classroom join code to atomically enroll the authenticated student and assign an available desk. Protected by sliding-window rate limiting against brute force attempts. Dynamic desk auto-expansion ensures desk allocation even if default desks are fully occupied.',
  })
  @ApiCreatedResponse({
    type: JoinClassroomResponseDto,
    description: 'Successfully joined the classroom with desk allocated.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Malformed code or join code is no longer active / expired.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Join code does not exist or classroom was deleted.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'Join code has reached maximum uses or concurrent join conflict occurred.',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    type: ErrorEnvelopeDto,
    description: 'Rate limit exceeded: too many invalid join code attempts.',
  })
  async joinClassroom(
    @CurrentUser('userId') actorUserId: string,
    @Body() dto: JoinClassroomWithCodeDto,
  ): Promise<JoinClassroomResponseDto> {
    return this.invitationsService.joinWithCode(actorUserId, dto);
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

  @Post(':id/invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue an email invitation to join a classroom',
    description:
      'Issues a single-use email invitation for the specified classroom and schedules asynchronous email delivery via the transactional outbox. Restricted to teaching staff (School Owner/Admin or the classroom Teacher). Completely preserves non-disclosure (never reveals whether the email exists).',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
    example: '4e5f6a7b-0000-4000-8000-000000000002',
  })
  @ApiCreatedResponse({
    type: CreatedClassroomInvitationResponseDto,
    description:
      'Email invitation created, raw secret token returned once, and outbox event scheduled.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Validation failed on email or role.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller is a student or parent without invite_members capability.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom does not exist or caller has no relationship with it.',
  })
  async createInvitation(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Body() dto: CreateClassroomInvitationDto,
  ): Promise<CreatedClassroomInvitationResponseDto> {
    return this.invitationsService.createEmailInvitation(actorUserId, classroomId, dto);
  }

  @Get(':id/invitations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List email invitations for a classroom',
    description:
      'Returns a paginated list of email invitations for the classroom. Restricted to classroom staff.',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
    example: '4e5f6a7b-0000-4000-8000-000000000002',
  })
  @ApiPaginatedResponse(ClassroomInvitationResponseDto, 'Paginated list of invitations.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination or status filter parameters.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller is a student or parent without invite_members capability.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom does not exist or caller has no relationship with it.',
  })
  async listInvitations(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Query() query: ListInvitationsQueryDto,
  ): Promise<Paginated<ClassroomInvitationResponseDto>> {
    return this.invitationsService.listInvitations(actorUserId, classroomId, query);
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke an email invitation',
    description:
      'Marks an active email invitation as REVOKED so it can no longer be accepted. Restricted to classroom staff.',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
  })
  @ApiParam({
    name: 'invitationId',
    description: 'Invitation UUID to revoke',
  })
  @ApiOkResponse({
    type: RevokeInvitationResponseDto,
    description: 'Invitation revoked successfully.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller lacks invite_members authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom or invitation does not exist.',
  })
  async revokeInvitation(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<RevokeInvitationResponseDto> {
    return this.invitationsService.revokeInvitation(actorUserId, classroomId, invitationId);
  }

  @Post(':id/join-code')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate or regenerate classroom join code',
    description:
      'Generates a new shareable join code for the classroom. If an active join code already exists, marks the previous code as REVOKED. The raw join code is returned ONCE in this response; only its SHA-256 hash is persisted. Restricted to classroom staff.',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
  })
  @ApiCreatedResponse({
    type: JoinCodeResponseDto,
    description: 'New join code created. Raw code is exposed only in this response.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid parameters for maxUses or expiresInSeconds.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller lacks invite_members authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom does not exist or caller has no relationship with it.',
  })
  async generateJoinCode(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Body() dto: CreateJoinCodeDto,
  ): Promise<JoinCodeResponseDto> {
    return this.invitationsService.generateJoinCode(actorUserId, classroomId, dto);
  }

  @Delete(':id/join-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke active classroom join code',
    description:
      'Revokes the current active join code for this classroom, preventing any further student enrolments using it. Restricted to classroom staff.',
  })
  @ApiParam({
    name: 'id',
    description: 'Classroom UUID',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Join code revoked successfully' },
      },
    },
    description: 'Join code revoked successfully.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Caller lacks invite_members authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom not found or no active join code exists.',
  })
  async revokeJoinCode(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.invitationsService.revokeJoinCode(actorUserId, classroomId);
  }
}
