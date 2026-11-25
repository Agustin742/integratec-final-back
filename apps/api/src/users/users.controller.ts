import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { AvatarDto } from './avatar.dto';
import { AvatarStylesDto } from './avatar-styles.dto';
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

  @Get('avatar/styles')
  @ApiOperation({
    summary: 'List avatar style availability',
    description:
      'Every hair and top id with `free`, `owned` and the code of the shop item that sells it. Free styles are always owned. A paid style is owned once the user bought it in any classroom, even if the shop item was later deactivated.',
  })
  @ApiOkResponse({ type: AvatarStylesDto })
  listAvatarStyles(@CurrentUser('userId') userId: string): Promise<AvatarStylesDto> {
    return this.users.listAvatarStyles(userId);
  }

  @Patch('avatar')
  @ApiOperation({
    summary: 'Replace own base avatar',
    description:
      'Uses the global SessionAuthGuard identity with one session verification. All five fields required, not a partial merge. Replaces stored base-only appearance, including unsupported legacy values. Body, free hair and free tops need no purchase; paid hair and tops require a shop purchase made in any classroom. Accessories and uniforms are not supported.',
  })
  @ApiOkResponse({ type: AvatarDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'VALIDATION_FAILED with per-field details; unknown fields, incompatible choices and non-palette colors rejected.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description:
      'FORBIDDEN when hairId or topId is a paid style the user has not unlocked in the shop, or the avatar access adapter denied use.',
  })
  updateAvatar(@CurrentUser('userId') userId: string, @Body() dto: AvatarDto): Promise<AvatarDto> {
    return this.users.updateAvatar(userId, dto);
  }
}
