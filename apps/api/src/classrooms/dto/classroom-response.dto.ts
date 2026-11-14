import { ApiProperty } from '@nestjs/swagger';
import { ClassroomPanelKey } from '../../access/access-verification.service';
import type {
  ClassroomAccessRole,
  ClassroomCapability,
} from '../../access/access-verification.service';
import { CLASSROOM_ACCESS_ROLES, CLASSROOM_CAPABILITIES } from '../classrooms.constants';

export class ClassroomPetSummaryDto {
  @ApiProperty({
    example: '9a1b2c3d-0000-4000-8000-000000000001',
    description: 'Unique identifier of the classroom pet (UUID)',
  })
  id!: string;

  @ApiProperty({
    example: 'Michi',
    description: 'Display name of the classroom pet',
  })
  name!: string;

  @ApiProperty({
    example: 'cat',
    description: 'Species identifier of the classroom pet',
  })
  species!: string;

  @ApiProperty({
    example: 1,
    description: 'Current level of the classroom pet',
  })
  level!: number;

  @ApiProperty({
    example: 0,
    description: 'Accumulated experience points of the classroom pet',
  })
  experience!: number;
}

export class ClassroomListItemDto {
  @ApiProperty({
    example: '4e5f6a7b-0000-4000-8000-000000000002',
    description: 'Unique classroom identifier (UUID)',
  })
  id!: string;

  @ApiProperty({
    example: '3° Año B - Matemática',
    description: 'Display name of the virtual classroom',
  })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Matemática y Geometría',
    description: 'Optional subject or course description',
  })
  subject!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3f6c2d9e-0000-4000-8000-000000000000',
    description: 'Owning school UUID when the classroom belongs to a school, or null',
  })
  schoolId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'Owning independent teacher user UUID when the classroom belongs to an independent teacher, or null',
  })
  independentTeacherId!: string | null;

  @ApiProperty({
    example: false,
    description: 'Whether the classroom runs in adult education mode',
  })
  adultMode!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether the classroom student chat is muted',
  })
  chatMuted!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether collaborative editing is locked',
  })
  collaborationLocked!: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether interactive classroom games are disabled',
  })
  gamesDisabled!: boolean;

  @ApiProperty({
    enum: CLASSROOM_ACCESS_ROLES,
    example: 'TEACHER',
    description: 'Resolved role of the authenticated caller in this classroom',
  })
  myRole!: ClassroomAccessRole;

  @ApiProperty({
    enum: CLASSROOM_CAPABILITIES,
    isArray: true,
    example: [
      'configure_classroom',
      'invite_members',
      'publish_content',
      'moderate_chat',
      'configure_bot',
      'view_metrics',
      'chat_classmates',
      'list_directory',
      'message_teacher',
    ],
    description: 'Server-derived capabilities granted to the caller in this classroom',
  })
  capabilities!: ClassroomCapability[];

  @ApiProperty({
    example: '2026-11-07T20:00:00.000Z',
    description: 'Classroom creation timestamp in UTC (ISO 8601)',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-11-07T20:00:00.000Z',
    description: 'Classroom last update timestamp in UTC (ISO 8601)',
  })
  updatedAt!: string;
}

export class ClassroomDetailResponseDto extends ClassroomListItemDto {
  @ApiProperty({
    example: 12,
    description: 'Total number of desks provisioned in the classroom',
  })
  deskCount!: number;

  @ApiProperty({
    type: ClassroomPetSummaryDto,
    nullable: true,
    description: 'The classroom pet state',
  })
  pet!: ClassroomPetSummaryDto | null;
}

/** GET context only; creation, updates and classroom lists keep their existing shapes. */
export class ClassroomContextResponseDto extends ClassroomDetailResponseDto {
  @ApiProperty({
    enum: ClassroomPanelKey,
    enumName: 'ClassroomPanelKey',
    isArray: true,
    description:
      'Stable, unique panel availability for the authorized caller, not action permissions. An absent panel is unavailable; a present panel may be empty. Pet is reserved and never emitted.',
    example: ['grades'],
  })
  availablePanels!: ClassroomPanelKey[];
}
