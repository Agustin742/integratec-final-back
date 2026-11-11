import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeJoinController } from './realtime-join.controller';
import { InternalServiceGuard } from './internal-service.guard';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [RealtimeJoinController],
  providers: [InternalServiceGuard, RealtimeAccessService],
})
export class RealtimeJoinModule {}
