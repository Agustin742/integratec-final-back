import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

// eslint-disable-next-line no-control-regex -- Reject NUL and unsafe C0/C1 control characters while allowing tabs and newlines.
const UNSAFE_DESCRIPTION_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u;

/** The property may be omitted, but an explicit `null` is a validation error. */
function OptionalButNotNull() {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined);
}

/**
 * Multi-line plain text description: rejects NUL and unsafe C0/C1 control characters while
 * allowing tabs and newlines; trims safe strings so an empty value normalizes to `null`.
 */
function ModuleDescription(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' && !UNSAFE_DESCRIPTION_CONTROL_CHARS.test(value)
        ? value.trim()
        : value,
    ),
    IsString(),
    // eslint-disable-next-line no-control-regex -- Explicitly reject unsafe control characters.
    Matches(/^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]*$/u, {
      message: 'description must not contain control characters',
    }),
    MaxLength(MATERIAL_MODULE_LIMITS.descriptionMax),
  );
}

export class CreateMaterialModuleDto {
  @ApiProperty({ maxLength: MATERIAL_MODULE_LIMITS.nameMax })
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @VisibleText('name')
  @MaxLength(MATERIAL_MODULE_LIMITS.nameMax)
  name!: string;

  @ApiPropertyOptional({ maxLength: MATERIAL_MODULE_LIMITS.descriptionMax })
  @OptionalButNotNull()
  @ModuleDescription()
  description?: string;
}

/** At least one field is required; `description: null` clears it, `name: null` is invalid. */
export class UpdateMaterialModuleDto {
  @ApiPropertyOptional({ maxLength: MATERIAL_MODULE_LIMITS.nameMax })
  @OptionalButNotNull()
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
  @ModuleDescription()
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
