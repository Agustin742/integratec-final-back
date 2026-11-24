import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import {
  CreateMaterialModuleDto,
  MaterialModuleDto,
  MaterialModuleListDto,
  ReorderMaterialModulesDto,
  UpdateMaterialModuleDto,
} from './material-modules.dto';
import { MaterialModulesService } from './material-modules.service';

/** Transport adapter only; rules live in `MaterialModulesService`. */
@ApiTags('materials')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Visible classroom, insufficient role (students write, parents read).',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, absent, removed or out-of-scope classroom or module.',
})
@Controller('classrooms/:id/material-modules')
export class MaterialModulesController {
  constructor(private readonly modules: MaterialModulesService) {}

  @Get()
  @ApiOperation({
    summary: 'List the classroom material modules in order',
    description:
      'Staff and current students only (same visibility as materials). Active modules ordered by position, with the count of active materials in each. Materials with no module are "unassigned": list them with `GET /classrooms/:id/materials?moduleId=unassigned`.',
  })
  @ApiOkResponse({ type: MaterialModuleListDto })
  list(@CurrentUser('userId') actorId: string, @Param('id') classroomId: string) {
    return this.modules.list(actorId, classroomId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a module',
    description: 'Teacher-level staff only. The module is appended after the last one.',
  })
  @ApiCreatedResponse({ type: MaterialModuleDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiConflictResponse({ type: ErrorEnvelopeDto, description: 'Module limit reached (100).' })
  create(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() dto: CreateMaterialModuleDto,
  ) {
    return this.modules.create(actorId, classroomId, dto);
  }

  @Put('order')
  @ApiOperation({
    summary: 'Reorder the modules',
    description:
      'Teacher-level staff only. `moduleIds` must list every active module of the classroom exactly once; positions are rewritten to 0..n-1. Returns the new ordered list.',
  })
  @ApiOkResponse({ type: MaterialModuleListDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'The list misses, repeats or invents modules.',
  })
  reorder(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() dto: ReorderMaterialModulesDto,
  ) {
    return this.modules.reorder(actorId, classroomId, dto);
  }

  @Patch(':moduleId')
  @ApiParam({ name: 'moduleId', description: 'Module UUID' })
  @ApiOperation({
    summary: 'Rename a module or change its description',
    description:
      'Teacher-level staff only. At least one field is required; `description: null` clears it.',
  })
  @ApiOkResponse({ type: MaterialModuleDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  update(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateMaterialModuleDto,
  ) {
    return this.modules.update(actorId, classroomId, moduleId, dto);
  }

  @Delete(':moduleId')
  @HttpCode(204)
  @ApiParam({ name: 'moduleId', description: 'Module UUID' })
  @ApiOperation({
    summary: 'Remove a module',
    description:
      'Teacher-level staff only. Logical removal. The module never blocks on content: its materials are NOT deleted, they return to unassigned (`moduleId: null`) in the same transaction. Repeated removal returns 404.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('moduleId') moduleId: string,
  ) {
    await this.modules.remove(actorId, classroomId, moduleId);
  }
}
