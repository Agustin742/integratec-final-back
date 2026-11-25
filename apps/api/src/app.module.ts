import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { ChatModule } from './chat/chat.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { ClassroomContextDeliveryModule } from './classrooms/context-delivery.module';
import type { ApiConfig } from './config/api-config';
import { ApiConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { RealtimeJoinModule } from './internal/realtime/realtime-join.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PointsModule } from './points/points.module';
import { ShopModule } from './shop/shop.module';
import { GradesModule } from './grades/grades.module';
import { MaterialsModule } from './materials/materials.module';
import { EquipmentModule } from './equipment/equipment.module';
import { FamilyModule } from './family/family.module';
import { GamificationModule } from './gamification/gamification.module';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ApiConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        AccessModule,
        UsersModule,
        RealtimeJoinModule,
        ClassroomsModule,
        ClassroomContextDeliveryModule,
        NotificationsModule,
        AnnouncementsModule,
        ChatModule,
        SubmissionsModule,
        PointsModule,
        ShopModule,
        GradesModule,
        MaterialsModule,
        EquipmentModule,
        FamilyModule,
        GamificationModule,
        BotModule,
      ],
    };
  }
}
