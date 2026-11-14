import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PointsController } from './points.controller';
import { PointsLedgerService } from './points-ledger.service';

/** Server-owned immutable points ledger and student wallet endpoints. */
@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [PointsController],
  providers: [PointsLedgerService],
  exports: [PointsLedgerService],
})
export class PointsModule {}
