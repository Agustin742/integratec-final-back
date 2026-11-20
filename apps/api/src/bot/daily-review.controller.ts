import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { DailyReviewResponseDto } from './daily-review.dto';
import { DailyReviewService } from './daily-review.service';

/**
 * Daily review endpoints for the authenticated user (HU-BOT-003, frontend
 * contract in issue #119). Lives in the bot domain because the review is the
 * bot's briefing feature (rules/ai-bot-and-daily-briefing.md); the path stays
 * under `users/me` because it is the user's own data, like the rest of that
 * controller's surface.
 */
@ApiTags('bot')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired or revoked session.',
})
@Controller('users/me/daily-review')
export class DailyReviewController {
  constructor(private readonly dailyReview: DailyReviewService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Daily review state for the authenticated user',
    description:
      'Server-decided state for the local day (America/Argentina/Buenos_Aires, server clock). ' +
      '`not_due` covers every non-delivery cause (already delivered today, another tab, parent, ' +
      'no classroom access, exam in progress); the client does not distinguish causes. The first ' +
      'authenticated access of the day delivers once under a unique constraint, so reloads and ' +
      'concurrent tabs cannot re-deliver.',
  })
  @ApiOkResponse({
    type: DailyReviewResponseDto,
    description: '`not_due`, or the full review payload with `status: due`.',
  })
  getDailyReview(@CurrentUser('userId') userId: string): Promise<DailyReviewResponseDto> {
    return this.dailyReview.getDailyReview(userId);
  }
}
