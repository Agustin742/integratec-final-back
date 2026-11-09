import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateJoinCodeDto {
  @ApiPropertyOptional({
    description: 'Maximum uses for this join code (omit for unlimited)',
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @ApiPropertyOptional({
    description:
      'Lifetime in seconds for this join code (defaults to server config INVITATION_TTL)',
    minimum: 60,
    maximum: 2592000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(2592000)
  expiresInSeconds?: number;
}
