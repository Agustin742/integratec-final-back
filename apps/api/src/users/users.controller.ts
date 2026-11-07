import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { OwnSessionGuard, type OwnUserRequest } from './own-session.guard';
import { OwnProfileDto, UpdateProfileDto } from './profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorEnvelopeDto,
  description: 'Missing, malformed, expired or revoked session.',
})
@UseGuards(OwnSessionGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Read own profile and base avatar',
    description:
      'Identity comes only from the verified session. Missing/empty avatar returns base defaults without a write.',
  })
  @ApiOkResponse({ type: OwnProfileDto })
  @ApiInternalServerErrorResponse({
    type: ErrorEnvelopeDto,
    description: 'Unsupported nonempty stored appearance. No stored value is exposed or changed.',
  })
  getMe(@Req() req: OwnUserRequest): Promise<OwnProfileDto> {
    return this.users.getMe(req.verifiedUserId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update own display name' })
  @ApiOkResponse({ type: OwnProfileDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'VALIDATION_FAILED with per-field details; unknown fields rejected.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorEnvelopeDto,
    description: 'Unsupported nonempty stored appearance. Profile is not changed.',
  })
  updateProfile(@Req() req: OwnUserRequest, @Body() dto: UpdateProfileDto): Promise<OwnProfileDto> {
    return this.users.updateProfile(req.verifiedUserId, dto);
  }
}
