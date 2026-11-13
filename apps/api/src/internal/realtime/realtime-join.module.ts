import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { ConnectedTimeService } from './connected-time.service';
import { InternalServiceGuard } from './internal-service.guard';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeConnectedTimeController } from './realtime-connected-time.controller';
import { RealtimeJoinController } from './realtime-join.controller';

@Module({
  imports: [AuthModule, AccessModule],
  controllers: [RealtimeJoinController, RealtimeConnectedTimeController],
  providers: [InternalServiceGuard, RealtimeAccessService, ConnectedTimeService],
})
export class RealtimeJoinModule {}
