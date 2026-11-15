import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { EquipItemDto, EquipmentStateDto } from './equipment.dto';
import { EquipmentService } from './equipment.service';

@ApiTags('equipment')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description:
    'Visible classroom, but caller is not an active enrolled student (staff and non-adult parents).',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description:
    'Malformed, nonexistent, or inaccessible classroom; unknown equipment slot; or unknown shop item.',
})
@ApiConflictResponse({
  type: ErrorEnvelopeDto,
  description: 'Shop item kind does not fit the requested slot or the item is not equipable.',
})
@ApiTooManyRequestsResponse({
  type: ErrorEnvelopeDto,
  description: 'Per-user equipment change rate limit exceeded.',
})
@Controller('classrooms/:id/me/equipment')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @ApiOperation({
    summary: "Read the authenticated student's classroom-scoped equipment state",
    description:
      'Returns one equipped purchase per slot (head, face, back, desk_decor) or null when the slot is empty. Classroom-scoped: purchases and equipment never cross classrooms.',
  })
  @ApiOkResponse({
    type: EquipmentStateDto,
    description: 'Current equipment state with one entry per known slot.',
  })
  getEquipment(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
  ): Promise<EquipmentStateDto> {
    return this.equipment.getEquipment(actorId, classroomId);
  }

  @Put(':slot')
  @ApiOperation({
    summary: 'Equip a purchased item in a slot, or unequip the slot',
    description:
      'Atomically saves `EquippedItem` for the authenticated active student after validating the slot (404), the shop item (404), its kind/slot compatibility (409), and classroom-scoped ownership against StudentPurchase (403). Body `{ shopItemId: string | null }`; null (or an absent field) unequips the slot. Idempotent.',
  })
  @ApiOkResponse({
    type: EquipmentStateDto,
    description: 'Full equipment state after the change.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid slot value, invalid shopItemId, or extra body fields.',
  })
  setSlot(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('slot') slot: string,
    @Body() dto: EquipItemDto,
  ): Promise<EquipmentStateDto> {
    return this.equipment.setSlot(actorId, classroomId, slot, dto);
  }
}
