import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import type { Paginated } from '../http/pagination/paginated';
import {
  DailyMetricDto,
  ListClassroomMetricsQueryDto,
  ListDailyMetricsQueryDto,
  ListReportCardQueryDto,
  ReportCardItemDto,
  StudentMetricSummaryDto,
} from './metrics.dto';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Visible classroom, but the caller lacks the role this resource requires.',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Malformed, nonexistent, or inaccessible classroom.',
})
@Controller('classrooms/:id/me')
export class StudentMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('report-card')
  @ApiOperation({
    summary: "Read the authenticated student's graded activities of one classroom",
    description:
      'One item per graded activity: score, feedback and net credited points, latest grading first. ' +
      'Ungraded submissions and deleted activities are not listed. This card is the student resource; ' +
      'staff and parents answer 403 (the parent view is HU-ACT-006, out of scope here).',
  })
  @ApiPaginatedResponse(ReportCardItemDto, "The student's graded activities, paginated.")
  reportCard(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListReportCardQueryDto,
  ): Promise<Paginated<ReportCardItemDto>> {
    return this.metrics.reportCard(actorId, classroomId, query);
  }

  @Get('activity-metrics')
  @ApiOperation({
    summary: "Read the authenticated student's own daily activity metrics",
    description:
      'Raw per-UTC-day signals for the caller only: connected seconds, submissions and classroom-channel ' +
      'messages. No composite level is computed (gap 17 stays open); messageCount stays 0 until chat ships.',
  })
  @ApiPaginatedResponse(DailyMetricDto, 'Raw daily metric rows, latest day first.')
  myDailyMetrics(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListDailyMetricsQueryDto,
  ): Promise<Paginated<DailyMetricDto>> {
    return this.metrics.myDailyMetrics(actorId, classroomId, query);
  }
}

@ApiTags('metrics')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Visible classroom, but the caller is not teaching staff (students and parents).',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Malformed, nonexistent, or inaccessible classroom.',
})
@Controller('classrooms/:id/activity-metrics')
export class ClassroomMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the raw per-student activity totals of one classroom',
    description:
      'Teaching-staff summary: raw totals per active enrolled student (connected seconds, submissions, ' +
      'messages, graded and ungraded submission counts), display name ascending. Students who left keep ' +
      'their daily history but no longer appear here. The school owner and admin read any classroom of ' +
      'their school without membership.',
  })
  @ApiPaginatedResponse(StudentMetricSummaryDto, 'Raw per-student totals, paginated.')
  classroomMetrics(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListClassroomMetricsQueryDto,
  ): Promise<Paginated<StudentMetricSummaryDto>> {
    return this.metrics.classroomMetrics(actorId, classroomId, query);
  }
}
