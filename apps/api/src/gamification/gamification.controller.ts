import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { GamificationSummaryDto } from './gamification.dto';
import { StreakService } from './streak.service';

@ApiTags('gamification')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@Controller('gamification')
export class GamificationController {
  constructor(private readonly streaks: StreakService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Own study streak and earned badges',
    description:
      'Own recipient only; computed by the server in America/Argentina/Buenos_Aires. Badges are ordered by unlock time (awardedAt ASC, id ASC). No sort override.',
  })
  @ApiOkResponse({
    type: GamificationSummaryDto,
    description: 'Own streak summary and earned badges.',
  })
  getMySummary(@CurrentUser('userId') studentId: string): Promise<GamificationSummaryDto> {
    return this.streaks.getStudentSummary(studentId);
  }
}
