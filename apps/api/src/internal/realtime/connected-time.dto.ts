import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsUUID, Matches, Max, Min } from 'class-validator';

/** A presence session cannot be longer than the longest a room could stay up; one week is generous. */
export const MAX_CONNECTED_SECONDS_PER_REPORT = 7 * 24 * 3600;

/** One aggregate reported by the realtime server when a user's presence in a classroom ends. */
export class ConnectedTimeReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'userId must be a UUID' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'classroomId must be a UUID' })
  classroomId!: string;

  /** Whole seconds the user had at least one live connection, with overlaps counted once. */
  @ApiProperty({ minimum: 1, maximum: MAX_CONNECTED_SECONDS_PER_REPORT })
  @IsInt({ message: 'connectedSeconds must be an integer' })
  @Min(1, { message: 'connectedSeconds must be at least 1' })
  @Max(MAX_CONNECTED_SECONDS_PER_REPORT, {
    message: `connectedSeconds must not exceed ${MAX_CONNECTED_SECONDS_PER_REPORT}`,
  })
  connectedSeconds!: number;

  /** Instant at which the presence session ended, in UTC (ISO 8601 with a `Z` suffix). */
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true }, { message: 'endedAt must be an ISO 8601 date-time' })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, {
    message: 'endedAt must be a UTC date-time ending in Z',
  })
  endedAt!: string;
}
