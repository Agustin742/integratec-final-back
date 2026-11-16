import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OutboxModule } from '../platform/outbox/outbox.module';
import { StorageModule } from '../platform/storage/storage.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SubmissionOnTimeHandler } from './submission-on-time.handler';
import { SubmissionReadController, SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [AccessModule, OutboxModule, PrismaModule, StorageModule],
  controllers: [SubmissionsController, SubmissionReadController],
  providers: [SubmissionsService, SubmissionOnTimeHandler],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
