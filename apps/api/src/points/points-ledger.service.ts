import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PointEntryKind, Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { paginated, toSkipTake } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import { PrismaService } from '../prisma/prisma.service';
import {
  POINT_SORT_OPTIONS,
  type PointMovementDto,
  type PointTransactionDto,
  type PointsQueryDto,
  type StudentWalletDto,
} from './points.dto';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const MAX_SOURCE_TYPE_LENGTH = 40;
const MAX_REASON_LENGTH = 240;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CreditPointsInput {
  classroomId: string;
  studentId: string;
  amount: number;
  sourceType: string;
  sourceId: string;
  reason: string;
  actorId?: string | null;
}

export interface DebitPointsInput {
  classroomId: string;
  studentId: string;
  amount: number;
  sourceType: string;
  sourceId: string;
  reason: string;
  actorId?: string | null;
  idempotencyKey?: string;
}

export interface CompensatePointsInput {
  classroomId: string;
  studentId: string;
  delta: number;
  sourceType: string;
  sourceId: string;
  reason: string;
  actorId: string;
  idempotencyKey?: string;
}

export interface LedgerWriteResult {
  entry: PointTransactionDto;
  created: boolean;
}

type PointRow = {
  id: string;
  classroomId: string;
  studentId: string;
  actorId: string | null;
  entryKind: PointEntryKind | string;
  amount: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string | null;
  reason: string;
  createdAt: Date | string;
};

const POINT_ROW_RETURNING = Prisma.sql`
  RETURNING
    "id",
    "classroom_id" AS "classroomId",
    "student_id" AS "studentId",
    "actor_id" AS "actorId",
    "entry_kind"::text AS "entryKind",
    "amount",
    "source_type" AS "sourceType",
    "source_id" AS "sourceId",
    "idempotency_key" AS "idempotencyKey",
    "reason",
    "created_at" AS "createdAt"
`;

const movementSelect = {
  id: true,
  entryKind: true,
  amount: true,
  sourceType: true,
  sourceId: true,
  reason: true,
  actorId: true,
  createdAt: true,
} satisfies Prisma.PointTransactionSelect;

type MovementRow = Prisma.PointTransactionGetPayload<{ select: typeof movementSelect }>;

function mapEntryKind(raw: PointEntryKind | string): PointEntryKind {
  switch (raw) {
    case PointEntryKind.EARNING:
    case 'earning':
      return PointEntryKind.EARNING;
    case PointEntryKind.DEBIT:
    case 'debit':
      return PointEntryKind.DEBIT;
    case PointEntryKind.COMPENSATION:
    case 'compensation':
      return PointEntryKind.COMPENSATION;
    default:
      throw new Error(`Unsupported point entry kind: ${String(raw)}`);
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTransactionDto(row: PointRow): PointTransactionDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    studentId: row.studentId,
    actorId: row.actorId,
    entryKind: mapEntryKind(row.entryKind),
    amount: Number(row.amount),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    reason: row.reason,
    createdAt: toIsoString(row.createdAt),
  };
}

function toMovementDto(row: MovementRow): PointMovementDto {
  return {
    id: row.id,
    entryKind: mapEntryKind(row.entryKind),
    amount: row.amount,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    reason: row.reason,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertUuid(value: string, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function normalizeOptionalUuid(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  return assertUuid(value, field);
}

function assertPositiveInt32(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > INT32_MAX) {
    throw new BadRequestException(`${field} must be a positive 32-bit integer`);
  }
  return value;
}

function assertNonZeroInt32(value: number, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value === 0 ||
    value < INT32_MIN ||
    value > INT32_MAX
  ) {
    throw new BadRequestException(`${field} must be a non-zero 32-bit integer`);
  }
  return value;
}

function normalizeText(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new BadRequestException(`${field} must be between 1 and ${maxLength} characters`);
  }
  return trimmed;
}

function normalizeOptionalIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  return normalizeText(value, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
}

function assertIdempotentMatch(
  existing: PointRow,
  expected: {
    classroomId: string;
    studentId: string;
    entryKind: PointEntryKind;
    amount: number;
    sourceType: string;
    sourceId: string;
    actorId?: string | null;
  },
): void {
  const actorMatches =
    expected.actorId === undefined ? true : existing.actorId === expected.actorId;
  if (
    existing.classroomId !== expected.classroomId ||
    existing.studentId !== expected.studentId ||
    mapEntryKind(existing.entryKind) !== expected.entryKind ||
    Number(existing.amount) !== expected.amount ||
    existing.sourceType !== expected.sourceType ||
    existing.sourceId !== expected.sourceId ||
    !actorMatches
  ) {
    throw new ConflictException('Idempotency key already used with different parameters');
  }
}

/**
 * Append-only server-owned points ledger and wallet read service.
 * Exposes no update or delete APIs; immutability and balance floors are also enforced in PostgreSQL.
 */
@Injectable()
export class PointsLedgerService {
  private readonly logger = new Logger(PointsLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  /**
   * Idempotently credits positive points for an earning source (`sourceType`, `sourceId`).
   * Uses `ON CONFLICT DO NOTHING` on the earning partial unique index so replays never abort
   * an outer caller transaction (`25P02`).
   */
  async credit(
    input: CreditPointsInput,
    tx?: Prisma.TransactionClient,
  ): Promise<LedgerWriteResult> {
    const classroomId = assertUuid(input.classroomId, 'classroomId');
    const studentId = assertUuid(input.studentId, 'studentId');
    const sourceId = assertUuid(input.sourceId, 'sourceId');
    const actorId = normalizeOptionalUuid(input.actorId, 'actorId');
    const amount = assertPositiveInt32(input.amount, 'amount');
    const sourceType = normalizeText(input.sourceType, 'sourceType', MAX_SOURCE_TYPE_LENGTH);
    const reason = normalizeText(input.reason, 'reason', MAX_REASON_LENGTH);

    return this.withTransaction(tx, async (client) => {
      // Check earning replay before locking membership so retries return the stored entry even
      // if the student later left the classroom.
      const existingBeforeLock = await client.pointTransaction.findFirst({
        where: { sourceType, sourceId, entryKind: PointEntryKind.EARNING },
      });
      if (existingBeforeLock) {
        if (
          existingBeforeLock.classroomId !== classroomId ||
          existingBeforeLock.studentId !== studentId ||
          existingBeforeLock.amount !== amount
        ) {
          throw new ConflictException('Earning source already recorded with different parameters');
        }
        return { entry: toTransactionDto(existingBeforeLock), created: false };
      }

      await this.lockActiveStudentMembership(client, classroomId, studentId);

      const inserted = await this.insertIdempotentRow(
        client,
        {
          classroomId,
          studentId,
          actorId,
          entryKind: PointEntryKind.EARNING,
          amount,
          sourceType,
          sourceId,
          idempotencyKey: null,
          reason,
        },
        'earning_source',
      );

      if (inserted) {
        return { entry: toTransactionDto(inserted), created: true };
      }

      const existing = await client.pointTransaction.findFirst({
        where: { sourceType, sourceId, entryKind: PointEntryKind.EARNING },
      });
      if (!existing) {
        throw new ConflictException('Earning conflict detected without existing record');
      }
      if (
        existing.classroomId !== classroomId ||
        existing.studentId !== studentId ||
        existing.amount !== amount
      ) {
        throw new ConflictException('Earning source already recorded with different parameters');
      }
      return { entry: toTransactionDto(existing), created: false };
    });
  }

  /**
   * Atomically debits positive `amount` (stored as `-amount`) under a row-level lock on the
   * student's active classroom membership so concurrent debits cannot drive the balance negative.
   */
  async debit(input: DebitPointsInput, tx?: Prisma.TransactionClient): Promise<LedgerWriteResult> {
    const classroomId = assertUuid(input.classroomId, 'classroomId');
    const studentId = assertUuid(input.studentId, 'studentId');
    const sourceId = assertUuid(input.sourceId, 'sourceId');
    const actorId = normalizeOptionalUuid(input.actorId, 'actorId');
    const amount = assertPositiveInt32(input.amount, 'amount');
    const sourceType = normalizeText(input.sourceType, 'sourceType', MAX_SOURCE_TYPE_LENGTH);
    const reason = normalizeText(input.reason, 'reason', MAX_REASON_LENGTH);
    const idempotencyKey = normalizeOptionalIdempotencyKey(input.idempotencyKey);

    return this.withTransaction(tx, async (client) => {
      if (idempotencyKey !== null) {
        const existing = await client.pointTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          assertIdempotentMatch(existing, {
            classroomId,
            studentId,
            entryKind: PointEntryKind.DEBIT,
            amount: -amount,
            sourceType,
            sourceId,
          });
          return { entry: toTransactionDto(existing), created: false };
        }
      }

      await this.lockActiveStudentMembership(client, classroomId, studentId);

      const balance = await this.readLockedBalance(client, classroomId, studentId);
      if (balance - amount < 0) {
        throw new ConflictException('Insufficient points balance');
      }

      return this.insertNonEarningEntry(client, {
        classroomId,
        studentId,
        actorId,
        entryKind: PointEntryKind.DEBIT,
        amount: -amount,
        sourceType,
        sourceId,
        idempotencyKey,
        reason,
      });
    });
  }

  /**
   * Appends a signed non-zero compensation entry (for example regrades or authorized corrections),
   * enforces a non-negative resulting balance, and logs the correction without PII.
   */
  async compensate(
    input: CompensatePointsInput,
    tx?: Prisma.TransactionClient,
  ): Promise<LedgerWriteResult> {
    const classroomId = assertUuid(input.classroomId, 'classroomId');
    const studentId = assertUuid(input.studentId, 'studentId');
    const sourceId = assertUuid(input.sourceId, 'sourceId');
    const actorId = assertUuid(input.actorId, 'actorId');
    const delta = assertNonZeroInt32(input.delta, 'delta');
    const sourceType = normalizeText(input.sourceType, 'sourceType', MAX_SOURCE_TYPE_LENGTH);
    const reason = normalizeText(input.reason, 'reason', MAX_REASON_LENGTH);
    const idempotencyKey = normalizeOptionalIdempotencyKey(input.idempotencyKey);

    const result = await this.withTransaction(tx, async (client) => {
      if (idempotencyKey !== null) {
        const existing = await client.pointTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          assertIdempotentMatch(existing, {
            classroomId,
            studentId,
            entryKind: PointEntryKind.COMPENSATION,
            amount: delta,
            sourceType,
            sourceId,
            actorId,
          });
          return { entry: toTransactionDto(existing), created: false };
        }
      }

      await this.lockActiveStudentMembership(client, classroomId, studentId);

      const balance = await this.readLockedBalance(client, classroomId, studentId);
      if (balance + delta < 0) {
        throw new ConflictException('Point balance cannot become negative');
      }

      return this.insertNonEarningEntry(client, {
        classroomId,
        studentId,
        actorId,
        entryKind: PointEntryKind.COMPENSATION,
        amount: delta,
        sourceType,
        sourceId,
        idempotencyKey,
        reason,
      });
    });

    if (result.created) {
      // Non-PII security audit log per rules/points-and-shop.md and rules/observability-and-privacy.md.
      this.logger.log({
        event: 'points_compensation_recorded',
        classroomId: result.entry.classroomId,
        entryId: result.entry.id,
        actorId: result.entry.actorId,
        amount: result.entry.amount,
        sourceType: result.entry.sourceType,
        sourceId: result.entry.sourceId,
      });
    }

    return result;
  }

  /**
   * Computes the current server-derived balance (`SUM(amount)`, or `0` when empty) for a
   * student in a classroom. Accepts an optional transaction client for caller snapshots.
   */
  async getBalance(
    classroomId: string,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const normalizedClassroomId = assertUuid(classroomId, 'classroomId');
    const normalizedStudentId = assertUuid(studentId, 'studentId');
    const client = tx ?? this.prisma;
    const aggregate = await client.pointTransaction.aggregate({
      where: { classroomId: normalizedClassroomId, studentId: normalizedStudentId },
      _sum: { amount: true },
    });
    return aggregate._sum.amount ?? 0;
  }

  /** Returns the authenticated student's own wallet and paginated movements in a classroom. */
  async getOwnWallet(
    actorUserId: string,
    classroomId: string,
    query: PointsQueryDto,
  ): Promise<StudentWalletDto> {
    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });
    return this.readWallet(classroomId, actorUserId, query);
  }

  /**
   * Returns a target student's wallet and paginated movements when authorized as self,
   * classroom staff, or active linked parent outside adult mode.
   */
  async getStudentWallet(
    actorUserId: string,
    classroomId: string,
    targetStudentId: string,
    query: PointsQueryDto,
  ): Promise<StudentWalletDto> {
    await this.access.verifyStudentResourceAccess(actorUserId, targetStudentId, classroomId);
    return this.readWallet(classroomId, targetStudentId, query);
  }

  private async readWallet(
    classroomId: string,
    studentId: string,
    query: PointsQueryDto,
  ): Promise<StudentWalletDto> {
    const sort = parseSort(query.sort, POINT_SORT_OPTIONS);
    const where: Prisma.PointTransactionWhereInput = { classroomId, studentId };
    const orderBy: Prisma.PointTransactionOrderByWithRelationInput[] = [
      { [sort.field]: sort.direction },
      { id: sort.direction },
    ];

    const [aggregate, total, rows] = await this.prisma.$transaction(
      [
        this.prisma.pointTransaction.aggregate({ where, _sum: { amount: true } }),
        this.prisma.pointTransaction.count({ where }),
        this.prisma.pointTransaction.findMany({
          where,
          select: movementSelect,
          orderBy,
          ...toSkipTake(query),
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      classroomId,
      studentId,
      balance: aggregate._sum.amount ?? 0,
      ...paginated(rows.map(toMovementDto), total, query),
    };
  }

  private async withTransaction<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction((client) => fn(client));
  }

  private async lockActiveStudentMembership(
    client: Prisma.TransactionClient,
    classroomId: string,
    studentId: string,
  ): Promise<void> {
    const rows = await client.$queryRaw<Array<{ id: string }>>`
      SELECT cm."id"
      FROM "classroom_memberships" cm
      INNER JOIN "classrooms" c ON c."id" = cm."classroom_id"
      LEFT JOIN "schools" s ON s."id" = c."school_id"
      WHERE cm."classroom_id" = ${classroomId}::uuid
        AND cm."user_id" = ${studentId}::uuid
        AND cm."role" = 'student'::"classroom_role"
        AND cm."state" = 'active'::"membership_state"
        AND cm."deleted_at" IS NULL
        AND c."deleted_at" IS NULL
        AND (c."school_id" IS NULL OR s."deleted_at" IS NULL)
      FOR UPDATE OF cm
    `;
    if (rows.length === 0) {
      throw new NotFoundException('Active student membership not found in classroom');
    }
  }

  private async readLockedBalance(
    client: Prisma.TransactionClient,
    classroomId: string,
    studentId: string,
  ): Promise<number> {
    const rows = await client.$queryRaw<Array<{ balance: bigint | number }>>`
      SELECT COALESCE(SUM("amount"), 0)::bigint AS "balance"
      FROM "point_transactions"
      WHERE "classroom_id" = ${classroomId}::uuid
        AND "student_id" = ${studentId}::uuid
    `;
    return Number(rows[0]?.balance ?? 0);
  }

  private async insertIdempotentRow(
    client: Prisma.TransactionClient,
    data: {
      classroomId: string;
      studentId: string;
      actorId: string | null;
      entryKind: PointEntryKind;
      amount: number;
      sourceType: string;
      sourceId: string;
      idempotencyKey: string | null;
      reason: string;
    },
    conflictMode: 'earning_source' | 'idempotency_key',
  ): Promise<PointRow | null> {
    const pgKind =
      data.entryKind === PointEntryKind.EARNING
        ? 'earning'
        : data.entryKind === PointEntryKind.DEBIT
          ? 'debit'
          : 'compensation';
    const conflictClause =
      conflictMode === 'earning_source'
        ? Prisma.sql`ON CONFLICT ("source_type", "source_id") WHERE "entry_kind" = 'earning' DO NOTHING`
        : Prisma.sql`ON CONFLICT ("idempotency_key") DO NOTHING`;
    const id = randomUUID();
    const inserted = await client.$queryRaw<PointRow[]>(Prisma.sql`
      INSERT INTO "point_transactions" (
        "id", "classroom_id", "student_id", "actor_id", "entry_kind",
        "amount", "source_type", "source_id", "idempotency_key", "reason"
      )
      VALUES (
        ${id}::uuid,
        ${data.classroomId}::uuid,
        ${data.studentId}::uuid,
        ${data.actorId}::uuid,
        ${pgKind}::"point_entry_kind",
        ${data.amount}::integer,
        ${data.sourceType}::varchar(40),
        ${data.sourceId}::uuid,
        ${data.idempotencyKey}::varchar(128),
        ${data.reason}::varchar(240)
      )
      ${conflictClause}
      ${POINT_ROW_RETURNING}
    `);

    return inserted[0] ?? null;
  }

  private async insertNonEarningEntry(
    client: Prisma.TransactionClient,
    data: {
      classroomId: string;
      studentId: string;
      actorId: string | null;
      entryKind: typeof PointEntryKind.DEBIT | typeof PointEntryKind.COMPENSATION;
      amount: number;
      sourceType: string;
      sourceId: string;
      idempotencyKey: string | null;
      reason: string;
    },
  ): Promise<LedgerWriteResult> {
    if (data.idempotencyKey === null) {
      const created = await client.pointTransaction.create({ data });
      return { entry: toTransactionDto(created), created: true };
    }

    const inserted = await this.insertIdempotentRow(client, data, 'idempotency_key');
    if (inserted) {
      return { entry: toTransactionDto(inserted), created: true };
    }

    const existing = await client.pointTransaction.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (!existing) {
      throw new ConflictException('Idempotency key conflict detected without existing record');
    }
    assertIdempotentMatch(existing, {
      classroomId: data.classroomId,
      studentId: data.studentId,
      entryKind: data.entryKind,
      amount: data.amount,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      actorId: data.entryKind === PointEntryKind.COMPENSATION ? data.actorId : undefined,
    });
    return { entry: toTransactionDto(existing), created: false };
  }
}
