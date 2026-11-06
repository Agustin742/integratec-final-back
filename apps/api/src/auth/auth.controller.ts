import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { AuthService } from './auth.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { TokenPairResponseDto } from './dto/token-pair-response.dto';
import { SessionVerifier } from './session-verifier.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionVerifier: SessionVerifier,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register account and select organizational path',
    description:
      'Creates a user account, baseline avatar configuration, and the initial organizational structure atomically.',
  })
  @ApiCreatedResponse({
    type: RegisterResponseDto,
    description: 'Account and organizational structure created successfully.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'Validation failed or missing required fields (e.g. invalid email, short password).',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'A user with this normalized email address already exists.',
  })
  async register(@Body() dto: RegisterRequestDto): Promise<RegisterResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Opens a session and returns a short-lived access token (JWT) plus an opaque refresh token. ' +
      'Send the access token in the Authorization header as a Bearer credential.',
  })
  @ApiOkResponse({ type: TokenPairResponseDto, description: 'Session opened.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Validation failed (malformed email or missing password).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description:
      'Invalid credentials. The response is identical for an unknown email and a wrong password.',
  })
  async login(@Body() dto: LoginRequestDto): Promise<TokenPairResponseDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Exchanges a refresh token for a new access token and a new refresh token for the same ' +
      'session. The presented refresh token becomes invalid; presenting an already rotated ' +
      'token revokes the whole session. The session keeps its original expiry.',
  })
  @ApiOkResponse({ type: TokenPairResponseDto, description: 'New token pair issued.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Validation failed (missing or malformed refreshToken).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description:
      'Unknown, already rotated, or expired refresh token, or a revoked or expired session. ' +
      'The response is the same generic error in every case.',
  })
  async refresh(@Body() dto: RefreshRequestDto): Promise<TokenPairResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out and revoke the current session',
    description:
      'Revokes the session of the Bearer access token. Afterwards that access token and the ' +
      "session's refresh tokens are rejected with 401.",
  })
  @ApiNoContentResponse({ description: 'Session revoked.' })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing, malformed, expired, or revoked access token.',
  })
  async logout(@Headers('authorization') authorization: string | undefined): Promise<void> {
    const { sessionId } = await this.sessionVerifier.verifyAuthorizationHeader(authorization);
    await this.authService.logout(sessionId);
  }
}
