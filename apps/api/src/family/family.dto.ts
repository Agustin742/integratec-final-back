import { ApiProperty } from '@nestjs/swagger';
import { ReportCardItemDto, StudentParticipationSummaryDto } from '../metrics/metrics.dto';

/** One active parent-child classroom link visible in the authenticated user's Family area. */
export class FamilyLinkDto {
  @ApiProperty({ format: 'uuid', description: 'ParentLink UUID.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Classroom UUID.' })
  classroomId!: string;

  @ApiProperty({ description: 'Classroom display name.' })
  classroomName!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Classroom subject or description, if configured.',
  })
  classroomSubject!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Owning school UUID, or null for an independent-teacher classroom.',
  })
  schoolId!: string | null;

  @ApiProperty({
    description:
      'Whether the classroom is currently in adult education mode. Existing links remain visible ' +
      'so clients can indicate that parent actions are disabled while adult mode is active.',
  })
  adultMode!: boolean;

  @ApiProperty({ format: 'uuid', description: 'Linked student user UUID.' })
  childId!: string;

  @ApiProperty({ description: 'Linked student display name.' })
  childDisplayName!: string;

  @ApiProperty({ format: 'date-time', description: 'Link creation timestamp (UTC ISO-8601).' })
  createdAt!: string;
}

/** Active parent-child links for the authenticated parent (`GET /me/parent-links`). */
export class FamilyLinksResponseDto {
  @ApiProperty({
    type: [FamilyLinkDto],
    description:
      'Active parent links where the classroom and school are live and the child is an active ' +
      'enrolled student, ordered by createdAt ascending then id ascending.',
  })
  items!: FamilyLinkDto[];
}

/**
 * Linked child's report card and participation metrics for one parent link
 * (`GET /me/parent-links/:linkId/report-card`).
 */
export class FamilyReportCardResponseDto {
  @ApiProperty({ type: FamilyLinkDto, description: 'Verified active parent-child link summary.' })
  link!: FamilyLinkDto;

  @ApiProperty({
    type: [ReportCardItemDto],
    description: 'Graded published activities for the linked child, latest grading first.',
  })
  items!: ReportCardItemDto[];

  @ApiProperty({ description: 'Current 1-based page number.' })
  page!: number;

  @ApiProperty({ description: 'Page size.' })
  pageSize!: number;

  @ApiProperty({ description: 'Total number of graded published activities for the linked child.' })
  total!: number;

  @ApiProperty({
    type: StudentParticipationSummaryDto,
    description: 'Aggregated participation and grade progress totals for the linked child.',
  })
  metrics!: StudentParticipationSummaryDto;
}
