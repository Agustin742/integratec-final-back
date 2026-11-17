import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../../http/pagination/api-paginated-response';
import {
  CreateForumPostDto,
  CreateForumThreadDto,
  ForumPostDto,
  ForumThreadDetailDto,
  ForumThreadSummaryDto,
  ListForumPostsQueryDto,
  ListForumThreadsQueryDto,
} from './activity-forum.dto';
import { ActivityForumService } from './activity-forum.service';

/**
 * Transport adapter only: authorization and business rules live in
 * `ActivityForumService`. Threads are scoped to one activity; parents have no access.
 */
@ApiTags('activities')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiParam({ name: 'activityId', description: 'Activity UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, nonexistent or out-of-scope classroom, activity or thread.',
})
@Controller('classrooms/:id/activities/:activityId/forum')
export class ActivityForumController {
  constructor(private readonly forum: ActivityForumService) {}

  @Post('threads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a query thread',
    description:
      'Enrolled students and teaching staff only. Creates a thread scoped to the activity; ' +
      'the first post is the question. Bodies are trimmed and bounded (2000 chars).',
  })
  @ApiCreatedResponse({ type: ForumThreadDetailDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role (for example a parent).',
  })
  createThread(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('activityId') activityId: string,
    @Body() dto: CreateForumThreadDto,
  ) {
    return this.forum.createThread(actorId, classroomId, activityId, dto);
  }

  @Get('threads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List query threads',
    description:
      'Enrolled students and teaching staff only. Paginated, newest first by default ' +
      '(`sort=createdAt` or `-createdAt`); `id` is the tiebreaker. Each item carries the ' +
      'first post body (the question) and the reply count. Students only see threads of ' +
      'published activities.',
  })
  @ApiPaginatedResponse(ForumThreadSummaryDto, 'Paginated list of query threads.')
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Invalid query parameters.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  listThreads(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('activityId') activityId: string,
    @Query() query: ListForumThreadsQueryDto,
  ) {
    return this.forum.listThreads(actorId, classroomId, activityId, query);
  }

  @Get('threads/:threadId/posts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the posts of one thread',
    description:
      'Enrolled students and teaching staff only. Paginated, oldest first by default ' +
      '(`sort=createdAt` or `-createdAt`); `id` is the tiebreaker.',
  })
  @ApiParam({ name: 'threadId', description: 'Thread UUID' })
  @ApiPaginatedResponse(ForumPostDto, 'Paginated list of thread posts.')
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Invalid query parameters.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  listPosts(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('activityId') activityId: string,
    @Param('threadId') threadId: string,
    @Query() query: ListForumPostsQueryDto,
  ) {
    return this.forum.listPosts(actorId, classroomId, activityId, threadId, query);
  }

  @Post('threads/:threadId/posts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reply inside a thread',
    description:
      'Enrolled students and teaching staff only. When a teacher-level member replies in ' +
      "someone else's thread, one `activity_forum_reply` notification request is recorded " +
      'for the thread author in the same transaction, so the notice is delivered only after ' +
      'the reply commits.',
  })
  @ApiParam({ name: 'threadId', description: 'Thread UUID' })
  @ApiCreatedResponse({ type: ForumPostDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  createPost(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('activityId') activityId: string,
    @Param('threadId') threadId: string,
    @Body() dto: CreateForumPostDto,
  ) {
    return this.forum.createPost(actorId, classroomId, activityId, threadId, dto);
  }
}
