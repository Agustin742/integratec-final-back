import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ActivitiesModule } from '../activities/activities.module';
import { ActivityForumModule } from '../activities/forum/activity-forum.module';
import { EmailModule } from '../platform/email/email.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { ClassroomContextModule } from '../platform/classroom-context/classroom-context.module';
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
    ClassroomContextModule,
    EmailModule,
    ClassroomRosterModule,
    ClassroomDirectoryModule,
    ClassroomRemovalModule,
    ClassroomDesksModule,
    ActivitiesModule,
    ActivityForumModule,
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
