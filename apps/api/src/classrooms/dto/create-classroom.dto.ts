import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { VisibleText } from '../../http/visible-text';

export class CreateClassroomDto {
  @ApiProperty({
    example: '3° Año B - Matemática',
    description: 'Display name of the virtual classroom',
    maxLength: 120,
  })
  @VisibleText('name')
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(120, { message: 'name must not exceed 120 characters' })
  name!: string;

  @ApiPropertyOptional({
    example: 'Matemática y Geometría',
    description: 'Optional subject or course description for the classroom',
    maxLength: 200,
  })
  @IsOptional()
  @VisibleText('subject')
  @IsString({ message: 'subject must be a string' })
  @IsNotEmpty({ message: 'subject must not be empty when provided' })
  @MaxLength(200, { message: 'subject must not exceed 200 characters' })
  subject?: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Whether the classroom runs in adult education mode (disables parent links and parent actions)',
  })
  @IsOptional()
  @IsBoolean({ message: 'adultMode must be a boolean' })
  adultMode?: boolean;

  @ApiPropertyOptional({
    example: '3f6c2d9e-0000-4000-8000-000000000000',
    description:
      'Optional target school UUID when the actor belongs to a school; omitted for independent teachers or resolved automatically from active school membership',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'schoolId must be a valid UUID' })
  schoolId?: string;
}
