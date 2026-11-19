import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GamificationController } from './gamification.controller';
import { BadgesService } from './badges.service';
import { StreakService } from './streak.service';

/**
 * Gamification domain (HU-GAM-002): the daily study streak engine fed by real
 * academic events and catalog-driven idempotent badge awarding. Qualifying
 * producers call {@link StreakService.recordQualifying} inside their own
 * transaction; reads go through `GET /gamification/me`.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [GamificationController],
  providers: [BadgesService, StreakService],
  exports: [StreakService],
})
export class GamificationModule {}
