import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export const BOT_MAX_QUESTION_LENGTH = 2000;

export const BOT_STATUS_REASONS = ['exam_in_progress', 'no_materials', 'disabled'] as const;
export type BotStatusReason = (typeof BOT_STATUS_REASONS)[number];

export const BOT_ANSWER_OUTCOMES = ['answered', 'out_of_scope', 'guided_only'] as const;
export type BotAnswerOutcome = (typeof BOT_ANSWER_OUTCOMES)[number];

function BotQuestion(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      minLength: 1,
      maxLength: BOT_MAX_QUESTION_LENGTH,
      description: 'Plain-text study question for the classroom Study Guide Bot.',
    }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    // eslint-disable-next-line no-control-regex -- Reject NUL and unsafe control chars while allowing tabs and newlines.
    Matches(/^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]*$/u, {
      message: 'question must not contain control characters',
    }),
    Matches(/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{M}\u2800]/u, {
      message: 'question must contain a visible character',
    }),
    Length(1, BOT_MAX_QUESTION_LENGTH),
  );
}

export class AskStudyGuideBotDto {
  @BotQuestion()
  question!: string;
}

export class BotStatusDto {
  @ApiProperty({ description: 'Whether the Study Guide Bot is currently available to the caller.' })
  available!: boolean;

  @ApiProperty({
    enum: BOT_STATUS_REASONS,
    nullable: true,
    type: String,
    description: 'Server-decided reason when `available` is `false`; otherwise `null`.',
  })
  reason!: BotStatusReason | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'User-facing explanation when unavailable; otherwise `null`.',
  })
  message!: string | null;
}

export class BotCitationDto {
  @ApiProperty({ format: 'uuid' })
  materialId!: string;

  @ApiProperty({ maxLength: 120, example: 'guia-unidad-1.pdf' })
  filename!: string;

  @ApiProperty({ nullable: true, type: String })
  excerpt!: string | null;
}

export class BotAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Plain-text study guidance answer from the server.' })
  answer!: string;

  @ApiProperty({ enum: BOT_ANSWER_OUTCOMES })
  outcome!: BotAnswerOutcome;

  @ApiProperty({ type: [BotCitationDto] })
  citations!: BotCitationDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
