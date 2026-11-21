import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { AskStudyGuideBotDto, BotAnswerDto, BotStatusDto } from './bot-ask.dto';
import { BotAskService } from './bot-ask.service';

/**
 * Classroom Study Guide Bot endpoints (issue #41 / HU-BOT-002).
 * Students and classroom staff may query availability and ask study questions;
 * linked parents receive 403 (`adultMode` parents and non-members receive 404).
 */
@ApiTags('bot')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Parents cannot use the Study Guide Bot.',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, absent, or inaccessible classroom.',
})
@Controller('classrooms/:id/bot')
export class BotAskController {
  constructor(private readonly botAsk: BotAskService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get server-decided Study Guide Bot availability for this classroom',
    description:
      'Returns whether the Study Guide Bot is available, locked during an active exam ' +
      '(students only), or missing indexed approved materials.',
  })
  @ApiOkResponse({ type: BotStatusDto })
  getStatus(@CurrentUser('userId') actorId: string, @Param('id') classroomId: string) {
    return this.botAsk.getStatus(actorId, classroomId);
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the classroom Study Guide Bot a study question',
    description:
      'Answers strictly from teacher-approved classroom material using pgvector RAG and ' +
      'returns server-verified citations. Rejects students while an exam is in progress ' +
      '(including in-flight queries) with 409 Conflict.',
  })
  @ApiOkResponse({ type: BotAnswerDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid question payload.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'Blocked because the student has an exam in progress.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorEnvelopeDto,
    description: 'Rate limit exceeded.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorEnvelopeDto,
    description: 'External AI provider is temporarily unavailable.',
  })
  ask(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() body: AskStudyGuideBotDto,
  ) {
    return this.botAsk.ask(actorId, classroomId, body.question);
  }
}
