import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeEventsModule } from '../platform/realtime/realtime-events.module';
import { EquipmentController } from './equipment.controller';
import { EquipmentRateLimiter } from './equipment-rate-limiter.service';
import { EquipmentService } from './equipment.service';

/** Classroom-scoped student equipment state endpoints (equip/unequip with ownership checks). */
@Module({
  imports: [PrismaModule, AccessModule, RealtimeEventsModule],
  controllers: [EquipmentController],
  providers: [EquipmentService, EquipmentRateLimiter],
})
export class EquipmentModule {}
