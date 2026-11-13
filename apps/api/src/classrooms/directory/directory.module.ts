import { Module } from '@nestjs/common';
import { AccessModule } from '../../access/access.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassroomDirectoryController } from './directory.controller';
import { ClassroomDirectoryService } from './directory.service';

@Module({
  imports: [AccessModule, PrismaModule],
  controllers: [ClassroomDirectoryController],
  providers: [ClassroomDirectoryService],
  exports: [ClassroomDirectoryService],
})
export class ClassroomDirectoryModule {}
