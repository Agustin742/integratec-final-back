import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import type { ApiConfig } from './config/api-config';
import { ApiConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { RealtimeJoinModule } from './internal/realtime/realtime-join.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';

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
        NotificationsModule,
        SubmissionsModule,
      ],
    };
  }
}
