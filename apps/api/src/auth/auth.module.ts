import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { type ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionVerifier } from './session-verifier.service';

@Module({
  imports: [
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
  providers: [AuthService, SessionVerifier],
  exports: [AuthService, SessionVerifier],
})
export class AuthModule {}
