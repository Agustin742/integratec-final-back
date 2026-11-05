import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { AuthService } from './auth.service';
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
}
