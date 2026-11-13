import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { EmailModule } from '../platform/email/email.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassroomInvitationCreatedHandler } from './classroom-invitation-created.handler';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { ClassroomDesksModule } from './desks/desks.module';
import { InvitationsController } from './invitations.controller';
import { JoinCodeRateLimiter } from './join-code-rate-limiter.service';
import { MeClassroomsController } from './me-classrooms.controller';
import { ClassroomDirectoryModule } from './directory/directory.module';
import { ClassroomRemovalModule } from './removal/classroom-removal.module';
import { ClassroomRosterModule } from './roster/roster.module';

@Module({
  imports: [
    PrismaModule,
    AccessModule,
    OutboxModule,
    EmailModule,
    ClassroomRosterModule,
    ClassroomDirectoryModule,
    ClassroomRemovalModule,
    ClassroomDesksModule,
    ActivitiesModule,
  ],
  controllers: [ClassroomsController, MeClassroomsController, InvitationsController],
  providers: [
    ClassroomsService,
    ClassroomInvitationsService,
    JoinCodeRateLimiter,
    ClassroomInvitationCreatedHandler,
  ],
  exports: [ClassroomsService, ClassroomInvitationsService, JoinCodeRateLimiter],
})
export class ClassroomsModule {}
