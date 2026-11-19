import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import {
  BotMaterialDto,
  EnableBotMaterialDto,
  ListBotMaterialsQueryDto,
} from './bot-materials.dto';
import { BotMaterialsService } from './bot-materials.service';

/**
 * Teacher bot material configuration (issue #40 / HU-BOT-001). Every actor
 * without teacher-level authority over the classroom receives 404, including
 * enrolled students and linked parents; there is no 403 case on these routes.
 */
@ApiTags('bot')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, absent, out-of-scope classroom, or a material outside it.',
})
@Controller('classrooms/:id/bot/materials')
export class BotMaterialsController {
  constructor(private readonly botMaterials: BotMaterialsService) {}

  @Post()
  @ApiOperation({
    summary: 'Allow one study material for the study guide bot',
    description:
      'Teacher-level staff only; every other actor receives 404. The material must belong to ' +
      'this classroom and not be soft-removed. It is indexed under the classroom partition; ' +
      'a duplicate enable re-indexes from scratch without reusing earlier chunks. Indexing ' +
      'failure is returned as `failed` with a visible reason and leaves the material usable ' +
      'for its normal purposes.',
  })
  @ApiCreatedResponse({ type: BotMaterialDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid body: materialId must be the only field and a UUID.',
  })
  enable(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() body: EnableBotMaterialDto,
  ) {
    return this.botMaterials.enable(actorId, classroomId, body.materialId);
  }

  @Get()
  @ApiOperation({
    summary: 'List materials allowed for the bot with their indexing state',
    description:
      'Teacher-level staff only; every other actor receives 404. Offset pagination; sort is ' +
      'createdAt or -createdAt (default), with ID in the same direction as tiebreaker. ' +
      'Soft-removed materials are excluded.',
  })
  @ApiPaginatedResponse(BotMaterialDto, 'Allowed materials with per-material indexing state.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination or sort.',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListBotMaterialsQueryDto,
  ) {
    return this.botMaterials.list(actorId, classroomId, query);
  }

  @Delete(':materialId')
  @HttpCode(204)
  @ApiParam({ name: 'materialId', description: 'Material UUID' })
  @ApiOperation({
    summary: 'Disallow one study material for the bot',
    description:
      'Teacher-level staff only; every other actor receives 404. The material is excluded ' +
      'from bot retrieval immediately and its indexed chunks are removed; re-enabling indexes ' +
      'from scratch. Repeated disable returns 404.',
  })
  @ApiNoContentResponse()
  @ApiServiceUnavailableResponse({
    type: ErrorEnvelopeDto,
    description: 'The material is excluded but its index partition cleanup is pending.',
  })
  async disable(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('materialId') materialId: string,
  ) {
    await this.botMaterials.disable(actorId, classroomId, materialId);
  }
}
