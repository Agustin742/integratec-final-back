import { ApiProperty } from '@nestjs/swagger';

const LOCAL_DAY_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

export class StreakSummaryDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'Consecutive qualifying local days whose chain is still alive (the last one is today or yesterday). A bare login never changes it.',
  })
  currentStreak!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Longest qualifying-day chain ever reached.',
  })
  bestStreak!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: LOCAL_DAY_PATTERN,
    description:
      'Local calendar day (YYYY-MM-DD) of the last qualifying activity in America/Argentina/Buenos_Aires; null when none was recorded yet.',
  })
  lastQualifyingDay!: string | null;
}

export class EarnedBadgeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Stable catalog code of the badge.' })
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ format: 'date-time' })
  awardedAt!: string;
}

export class GamificationSummaryDto {
  @ApiProperty({ type: StreakSummaryDto })
  streak!: StreakSummaryDto;

  @ApiProperty({ type: [EarnedBadgeDto] })
  badges!: EarnedBadgeDto[];
}
