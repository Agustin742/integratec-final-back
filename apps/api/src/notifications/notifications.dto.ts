import { ApiProperty, PickType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';

export class NotificationsQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['activity_published', 'grade_posted', 'announcement', 'mention'] })
  kind!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Navigation only; source endpoint authorizes detail access independently.',
  })
  resourceId!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  studentId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class NotificationsReadResultDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Number of previously unread, currently visible notices changed by this request.',
  })
  updated!: number;
}
