import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../http/pagination/pagination-query.dto';
import { Length } from 'class-validator';
import type { SortOptions } from '../../http/pagination/sort';

/** Matches the `activity_forum_posts.body` column (VARCHAR(2000)). */
export const FORUM_POST_BODY_MAX_LENGTH = 2000;

export const FORUM_THREAD_SORT_FIELDS = ['createdAt'] as const;
export type ForumThreadSortField = (typeof FORUM_THREAD_SORT_FIELDS)[number];

/** Allow-list and default order for the thread list: newest first, `id` tiebreaker. */
export const FORUM_THREAD_SORT_OPTIONS: SortOptions<ForumThreadSortField> = {
  allowed: FORUM_THREAD_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'desc' },
};

export const FORUM_POST_SORT_FIELDS = ['createdAt'] as const;
export type ForumPostSortField = (typeof FORUM_POST_SORT_FIELDS)[number];

/** Allow-list and default order for the posts of one thread: oldest first (reading order). */
export const FORUM_POST_SORT_OPTIONS: SortOptions<ForumPostSortField> = {
  allowed: FORUM_POST_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'asc' },
};

/**
 * Post bodies are plain text: non-empty after trimming and bounded server-side. The
 * backend stores and returns them as text and never interprets them as HTML.
 */
export class CreateForumThreadDto {
  @ApiProperty({ minLength: 1, maxLength: FORUM_POST_BODY_MAX_LENGTH })
  @Length(1, FORUM_POST_BODY_MAX_LENGTH)
  body!: string;
}

export class CreateForumPostDto {
  @ApiProperty({ minLength: 1, maxLength: FORUM_POST_BODY_MAX_LENGTH })
  @Length(1, FORUM_POST_BODY_MAX_LENGTH)
  body!: string;
}

export class ListForumThreadsQueryDto extends PaginationQueryDto {}
export class ListForumPostsQueryDto extends PaginationQueryDto {}

export class ForumPostDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  threadId!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({ description: 'Plain text; the server trims and bounds it.' })
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ForumThreadSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  activityId!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({ description: 'Body of the first post (the original question).' })
  firstPostBody!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  replyCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ForumThreadDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  activityId!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({ type: [ForumPostDto], description: 'Only the posts created by this request.' })
  posts!: ForumPostDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
