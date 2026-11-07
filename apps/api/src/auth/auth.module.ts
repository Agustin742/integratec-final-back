import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { type ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { EmailModule } from '../platform/email/email.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { AuthDataCleanupService } from './auth-data-cleanup.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetRequestedHandler } from './password-reset-requested.handler';
import { PasswordResetService } from './password-reset.service';
import { SessionVerifier } from './session-verifier.service';

@Module({
  imports: [
    EmailModule,
    OutboxModule,
    JwtModule.registerAsync({
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => ({
        secret: config.jwtSecret,
        // Pinned so a token cannot pick its own algorithm (for example `none`).
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionVerifier,
    PasswordResetService,
    PasswordResetRequestedHandler,
    AuthDataCleanupService,
  ],
  exports: [AuthService, SessionVerifier],
})
export class AuthModule {}
