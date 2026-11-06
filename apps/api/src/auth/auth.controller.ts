import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { AuthService } from './auth.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { RegisterResponseDto } from './dto/register-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  @ApiOkResponse({ type: LoginResponseDto, description: 'Session opened.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Validation failed (malformed email or missing password).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorEnvelopeDto,
    description:
      'Invalid credentials. The response is identical for an unknown email and a wrong password.',
  })
  async login(@Body() dto: LoginRequestDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }
}
