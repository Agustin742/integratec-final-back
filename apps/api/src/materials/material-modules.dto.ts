import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VisibleText } from '../http/visible-text';

export const MATERIAL_MODULE_LIMITS = {
  nameMax: 80,
  descriptionMax: 500,
  /** Per classroom, active modules only. */
  maxModules: 100,
} as const;

export class MaterialModuleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ maxLength: MATERIAL_MODULE_LIMITS.nameMax, example: 'Unit 1' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: MATERIAL_MODULE_LIMITS.descriptionMax,
  })
  description!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Zero-based order within the classroom.',
  })
  position!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Active materials in this module.' })
  materialCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MaterialModuleListDto {
  @ApiProperty({ type: [MaterialModuleDto], description: 'Active modules ordered by position.' })
  items!: MaterialModuleDto[];
}

/** Trims; an empty description is normalized to `null` by the service. */
const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

export class CreateMaterialModuleDto {
  @ApiProperty({ maxLength: MATERIAL_MODULE_LIMITS.nameMax })
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @VisibleText('name')
  @MaxLength(MATERIAL_MODULE_LIMITS.nameMax)
  name!: string;

  @ApiPropertyOptional({ maxLength: MATERIAL_MODULE_LIMITS.descriptionMax })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(MATERIAL_MODULE_LIMITS.descriptionMax)
  description?: string;
}

/** At least one field is required; `description: null` clears it, `name: null` is invalid. */
export class UpdateMaterialModuleDto {
  @ApiPropertyOptional({ maxLength: MATERIAL_MODULE_LIMITS.nameMax })
  @ValidateIf((_o: unknown, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @VisibleText('name')
  @MaxLength(MATERIAL_MODULE_LIMITS.nameMax)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MATERIAL_MODULE_LIMITS.descriptionMax,
    description: 'Send null to clear the description.',
  })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(MATERIAL_MODULE_LIMITS.descriptionMax)
  description?: string | null;
}

export class ReorderMaterialModulesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Every active module of the classroom exactly once, in the desired order. Anything else is rejected.',
  })
  @IsArray()
  @ArrayMaxSize(MATERIAL_MODULE_LIMITS.maxModules)
  @IsUUID(undefined, { each: true })
  moduleIds!: string[];
}

export class MoveMaterialDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Target module of this classroom, or null to unassign the material.',
  })
  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsUUID(undefined, { message: 'moduleId must be a UUID or null' })
  moduleId!: string | null;
}
