import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import type { Paginated } from '../http/pagination/paginated';
import {
  ListShopItemsQueryDto,
  ListShopPurchasesQueryDto,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  PurchaseResponseDto,
  PurchaseShopItemDto,
  ShopCatalogItemDto,
  StudentPurchaseDto,
  parseIdempotencyKeyHeader,
} from './shop.dto';
import { ShopService } from './shop.service';

@ApiTags('shop')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Visible classroom, but caller is not an active enrolled student.',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Malformed, nonexistent, or inaccessible classroom or shop item.',
})
@Controller('classrooms/:id/shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('items')
  @ApiOperation({
    summary: 'List classroom shop catalog items',
    description:
      'Returns paginated active shop items available in the classroom for an active enrolled student, resolving per-classroom price overrides and availability, student/classroom ownership flags, and server-side purchasability. Supports optional kind filter and sort=defaultPrice|name|createdAt (default createdAt) with a matching id tiebreaker.',
  })
  @ApiPaginatedResponse(ShopCatalogItemDto, 'Paginated classroom shop catalog items.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination, sort, kind filter, or unknown query parameters.',
  })
  listItems(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListShopItemsQueryDto,
  ): Promise<Paginated<ShopCatalogItemDto>> {
    return this.shop.listItems(actorId, classroomId, query);
  }

  @Get('purchases')
  @ApiOperation({
    summary: 'List authenticated student shop purchases in the classroom',
    description:
      'Returns paginated immutable purchase records for the authenticated active student in the classroom. Supports sort=createdAt|pricePaid (default -createdAt) with a matching id tiebreaker.',
  })
  @ApiPaginatedResponse(StudentPurchaseDto, 'Paginated student shop purchases.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination, sort, or unknown query parameters.',
  })
  listPurchases(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListShopPurchasesQueryDto,
  ): Promise<Paginated<StudentPurchaseDto>> {
    return this.shop.listPurchases(actorId, classroomId, query);
  }

  @Post('purchase')
  @ApiOperation({
    summary: 'Purchase a classroom shop item atomically',
    description:
      'Atomically validates student membership, catalog availability, implementation status, and unique ownership; debits the server-derived effective price from the points ledger; and records the purchase (plus ClassroomItem for classroom_item kinds). Requires an Idempotency-Key header (1-128 trimmed characters): returns 201 Created on new purchases and 200 OK on idempotent replays.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated idempotency key (1-128 trimmed non-empty characters).',
    schema: { type: 'string', minLength: 1, maxLength: MAX_IDEMPOTENCY_KEY_LENGTH },
  })
  @ApiCreatedResponse({
    type: PurchaseResponseDto,
    description: 'New purchase recorded and points debited from the student ledger.',
  })
  @ApiOkResponse({
    type: PurchaseResponseDto,
    description: 'Idempotent replay of a previous purchase; no second debit occurred.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'Missing/invalid Idempotency-Key header, invalid shopItemId, or extra body fields.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description:
      'Insufficient points balance, unimplemented item, duplicate ownership, or Idempotency-Key reused with another item.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorEnvelopeDto,
    description: 'Per-user purchase rate limit exceeded.',
  })
  async purchase(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
    @Body() dto: PurchaseShopItemDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseResponseDto> {
    const idempotencyKey = parseIdempotencyKeyHeader(rawIdempotencyKey);
    const result = await this.shop.purchase(actorId, classroomId, dto, idempotencyKey);
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }
}
