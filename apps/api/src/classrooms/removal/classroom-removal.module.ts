import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { OutboxModule } from '../../platform/outbox/outbox.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassroomRemovalController } from './classroom-removal.controller';
import { ClassroomRemovalService } from './classroom-removal.service';

@Module({
  imports: [PrismaModule, AccessModule, OutboxModule],
  controllers: [ClassroomRemovalController],
  providers: [ClassroomRemovalService],
  exports: [ClassroomRemovalService],
})
export class ClassroomRemovalModule {}
