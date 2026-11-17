import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import { MATERIAL_MAX_BYTES, type MaterialFile } from './material-file';
import { ListMaterialsQueryDto, MaterialDownloadDto, MaterialDto } from './materials.dto';
import { MaterialsService } from './materials.service';

@ApiTags('materials')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
@ApiForbiddenResponse({
  type: ErrorEnvelopeDto,
  description: 'Visible classroom, insufficient role.',
})
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, absent, removed or out-of-scope resource.',
})
@Controller('classrooms/:id/materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer treats its byte threshold as exclusive. Allow the extra byte into memory
      // and reject it in the service, so exactly 10 MiB is accepted.
      limits: { fileSize: MATERIAL_MAX_BYTES + 1, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ApiOperation({
    summary: 'Upload one private study material',
    description:
      'Teacher-level staff only. One nonempty PDF/PNG/JPEG, at most 10 MiB. Leading byte signature, declared MIME and filename extension must agree; no scanning or complete content parsing. Filename: 1–120 ASCII letters, digits, spaces, dots, underscores, parentheses or hyphens, starting with a letter or digit. No other multipart fields.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: MaterialDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid file, filename, type, fields or count.',
  })
  @ApiResponse({ status: 413, type: ErrorEnvelopeDto, description: 'File exceeds 10 MiB.' })
  @ApiServiceUnavailableResponse({
    type: ErrorEnvelopeDto,
    description: 'Upload outcome uncertain; refresh before retrying.',
  })
  upload(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @UploadedFile() file: MaterialFile | undefined,
  ) {
    return this.materials.upload(actorId, classroomId, file);
  }

  @Get()
  @ApiOperation({
    summary: 'List active study materials',
    description:
      'Staff and current students only. Offset pagination; sort is createdAt or -createdAt (default), with ID in the same direction as tiebreaker. Parents have no material permission.',
  })
  @ApiPaginatedResponse(MaterialDto, 'Active classroom material metadata; no storage keys.')
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Invalid pagination or sort.' })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListMaterialsQueryDto,
  ) {
    return this.materials.list(actorId, classroomId, query);
  }

  @Get(':materialId/download')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'materialId', description: 'Material UUID' })
  @ApiOperation({
    summary: 'Issue a short-lived signed download URL',
    description:
      'Current staff or student membership required. Uses the existing configured storage URL TTL. Already issued links remain usable until expiry even after logical removal or membership revocation. Treat the URL as a secret bearer capability.',
  })
  @ApiOkResponse({ type: MaterialDownloadDto })
  @ApiServiceUnavailableResponse({ type: ErrorEnvelopeDto })
  download(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('materialId') materialId: string,
  ) {
    return this.materials.download(actorId, classroomId, materialId);
  }

  @Delete(':materialId')
  @HttpCode(204)
  @ApiParam({ name: 'materialId', description: 'Material UUID' })
  @ApiOperation({
    summary: 'Logically remove study material',
    description:
      'Teacher-level staff only. Retains author, metadata, removal actor/time and private object; hides it from lists and blocks new signed URLs. Repeated removal returns 404.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('materialId') materialId: string,
  ) {
    await this.materials.remove(actorId, classroomId, materialId);
  }
}
