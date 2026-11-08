import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { OwnProfileDto, UpdateProfileDto } from './profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired or revoked session.',
})
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Read own profile and base avatar',
    description:
      'The global SessionAuthGuard verifies the session once; identity comes from CurrentUser. Missing, empty or unsupported stored appearance returns base defaults without changing stored appearance.',
  })
  @ApiOkResponse({ type: OwnProfileDto })
  getMe(@CurrentUser('userId') userId: string): Promise<OwnProfileDto> {
    return this.users.getMe(userId);
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update own display name',
    description:
      'Uses the global SessionAuthGuard identity. Changes only displayName; unsupported stored appearance returns base defaults and a privacy-safe warning without repairing stored appearance.',
  })
  @ApiOkResponse({ type: OwnProfileDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'VALIDATION_FAILED with per-field details; unknown fields rejected.',
  })
  updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<OwnProfileDto> {
    return this.users.updateProfile(userId, dto);
  }
}
