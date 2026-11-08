import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessVerificationService } from './access-verification.service';

@Module({
  imports: [PrismaModule],
  providers: [AccessVerificationService],
  exports: [AccessVerificationService],
})
export class AccessModule {}
