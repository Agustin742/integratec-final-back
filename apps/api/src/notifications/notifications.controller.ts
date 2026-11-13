import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
  NotificationDto,
  NotificationsQueryDto,
  NotificationsReadResultDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List currently accessible notifications',
    description:
      'Own recipient only. Current classroom and exact student access are checked before pagination and total. Fixed order: createdAt DESC, id DESC; no sort override.',
  })
  @ApiPaginatedResponse(NotificationDto, 'Minimal navigation metadata; no source content.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid or unknown query parameters.',
  })
  list(@CurrentUser('userId') actorId: string, @Query() query: NotificationsQueryDto) {
    return this.notifications.list(actorId, query);
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all currently accessible notifications read',
    description:
      'Idempotent. Updates only unread visible notices; preserves previous readAt values. No request body.',
  })
  @ApiOkResponse({ type: NotificationsReadResultDto })
  readAll(@CurrentUser('userId') actorId: string) {
    return this.notifications.markAllRead(actorId);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one currently accessible notification read',
    description: 'Idempotent: replay preserves the original readAt. No request body.',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID', format: 'uuid' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description:
      'Malformed, nonexistent, foreign-recipient or currently inaccessible notification.',
  })
  read(@CurrentUser('userId') actorId: string, @Param('id') id: string) {
    return this.notifications.markRead(actorId, id);
  }
}
