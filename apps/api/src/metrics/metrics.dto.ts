import { PickType } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';

/** Query for the student's own report card (`GET /classrooms/:id/me/report-card`). */
export class ListReportCardQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {}

/** Query for daily metric rows (`GET /classrooms/:id/me/activity-metrics`). */
export class ListDailyMetricsQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {}

/** Query for the teacher's classroom summary (`GET /classrooms/:id/activity-metrics`). */
export class ListClassroomMetricsQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {}

/** One graded activity in the student's report card. Raw server values only. */
export class ReportCardItemDto {
  @ApiProperty({ format: 'uuid', description: 'Graded activity UUID.' })
  activityId!: string;

  @ApiProperty({
    description: 'Activity title frozen at grading time; later edits do not change it.',
  })
  activityTitle!: string;

  @ApiProperty({ enum: ['TP', 'EXAM'], description: 'Activity type.' })
  activityType!: 'TP' | 'EXAM';

  @ApiProperty({
    description: 'Activity maxScore (0-100) frozen at grading time; later edits do not change it.',
  })
  maxScore!: number;

  @ApiProperty({ description: 'Awarded score (0..maxScore).' })
  score!: number;

  @ApiProperty({ description: 'Written feedback left by the grader.' })
  feedback!: string;

  @ApiProperty({ description: 'Net credited weighted points for this grade.' })
  pointsAwarded!: number;

  @ApiProperty({ description: 'Whether the submission was late.' })
  isLate!: boolean;

  @ApiProperty({ format: 'date-time', description: 'Submission instant (UTC).' })
  submittedAt!: string;

  @ApiProperty({ format: 'date-time', description: 'Latest grading instant (UTC).' })
  gradedAt!: string;
}

/** One UTC-day row of raw activity signals. The composite level (gap 17) is not computed. */
export class DailyMetricDto {
  @ApiProperty({ format: 'date', description: 'UTC calendar date the signals belong to.' })
  day!: string;

  @ApiProperty({ description: 'Aggregated connected seconds reported by the realtime server.' })
  connectedSeconds!: number;

  @ApiProperty({
    description: 'Raw submission events recorded that day, including to activities deleted later.',
  })
  submissionCount!: number;

  @ApiProperty({
    description:
      'Classroom-channel participation events that day. Always 0 until chat (RF-COM-002) ships.',
  })
  messageCount!: number;
}

/** Raw per-student totals for the teacher's classroom summary. */
export class StudentMetricSummaryDto {
  @ApiProperty({ format: 'uuid', description: 'Enrolled student UUID.' })
  studentId!: string;

  @ApiProperty({ description: 'Student display name.' })
  displayName!: string;

  @ApiProperty({ description: 'Sum of connected seconds across all recorded UTC days.' })
  connectedSeconds!: number;

  @ApiProperty({
    description:
      'Raw submission events summed over all recorded UTC days, kept as history: it includes ' +
      'submissions to activities deleted later, so it can exceed gradedCount + ungradedCount.',
  })
  submissionCount!: number;

  @ApiProperty({ description: 'Sum of message counts across all recorded UTC days.' })
  messageCount!: number;

  @ApiProperty({
    description: 'Submissions with a grade to non-deleted activities of this classroom.',
  })
  gradedCount!: number;

  @ApiProperty({
    description: 'Submissions without a grade yet to non-deleted activities of this classroom.',
  })
  ungradedCount!: number;
}
