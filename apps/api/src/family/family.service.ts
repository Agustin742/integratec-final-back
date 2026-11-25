import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomRole, MembershipState, type Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { toIsoString } from '../http/iso-string';
import { type ListReportCardQueryDto } from '../metrics/metrics.dto';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  type FamilyLinkDto,
  type FamilyLinksResponseDto,
  type FamilyReportCardResponseDto,
} from './family.dto';

export const FAMILY_LINK_SELECT = {
  id: true,
  classroomId: true,
  childId: true,
  createdAt: true,
  classroom: {
    select: {
      name: true,
      subject: true,
      schoolId: true,
      adultMode: true,
      deletedAt: true,
      school: { select: { deletedAt: true } },
    },
  },
  child: {
    select: {
      displayName: true,
    },
  },
} satisfies Prisma.ParentLinkSelect;

export type FamilyLinkRow = Prisma.ParentLinkGetPayload<{ select: typeof FAMILY_LINK_SELECT }>;

export function toFamilyLinkDto(row: FamilyLinkRow): FamilyLinkDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    classroomName: row.classroom.name,
    classroomSubject: row.classroom.subject,
    schoolId: row.classroom.schoolId,
    adultMode: row.classroom.adultMode,
    childId: row.childId,
    childDisplayName: row.child.displayName,
    createdAt: toIsoString(row.createdAt),
  };
}

export function isClassroomLive(classroom: FamilyLinkRow['classroom']): boolean {
  if (classroom.deletedAt !== null) return false;
  if (
    classroom.schoolId !== null &&
    (classroom.school === null || classroom.school.deletedAt !== null)
  ) {
    return false;
  }
  return true;
}

/**
 * Read side of HU-ACT-006 (Family Area): lists the authenticated parent's active child links and
 * serves each linked child's report card and participation metrics by reusing `MetricsService`.
 */
@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Lists all ACTIVE parent links for the authenticated user whose classroom (and owning school,
   * if any) is live and whose linked child still holds an ACTIVE, non-deleted STUDENT membership
   * in that classroom. Includes links in adult-mode classrooms with `adultMode: true`.
   */
  async listMyParentLinks(actorUserId: string): Promise<FamilyLinksResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      return { items: [] };
    }

    const links = await this.prisma.parentLink.findMany({
      where: {
        parentId: actorUserId,
        state: MembershipState.ACTIVE,
        classroom: {
          deletedAt: null,
          OR: [{ schoolId: null }, { school: { deletedAt: null } }],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: FAMILY_LINK_SELECT,
    });

    const liveLinks = links.filter((row) => isClassroomLive(row.classroom));
    if (liveLinks.length === 0) {
      return { items: [] };
    }

    const activeMemberships = await this.prisma.classroomMembership.findMany({
      where: {
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        OR: liveLinks.map((row) => ({
          classroomId: row.classroomId,
          userId: row.childId,
        })),
      },
      select: { classroomId: true, userId: true },
    });

    const activePairKeys = new Set(
      activeMemberships.map((membership) => `${membership.classroomId}:${membership.userId}`),
    );

    return {
      items: liveLinks
        .filter((row) => activePairKeys.has(`${row.classroomId}:${row.childId}`))
        .map(toFamilyLinkDto),
    };
  }

  /**
   * Reads the linked child's paginated report card and participation summary for a single
   * ParentLink. Returns `404` for malformed UUIDs, foreign/inactive links, deleted classrooms or
   * schools, or removed students (anti-enumeration), and `403` when the classroom is in adult mode.
   */
  async getChildReportCard(
    actorUserId: string,
    linkId: string,
    query: ListReportCardQueryDto,
  ): Promise<FamilyReportCardResponseDto> {
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(linkId)) {
      throw new NotFoundException('Parent link not found');
    }

    const link = await this.prisma.parentLink.findFirst({
      where: {
        id: linkId,
        parentId: actorUserId,
        state: MembershipState.ACTIVE,
        classroom: {
          deletedAt: null,
          OR: [{ schoolId: null }, { school: { deletedAt: null } }],
        },
      },
      select: FAMILY_LINK_SELECT,
    });

    if (!link || !isClassroomLive(link.classroom)) {
      throw new NotFoundException('Parent link not found');
    }

    const childStillEnrolled = await this.access.isActiveStudent(link.classroomId, link.childId);
    if (!childStillEnrolled) {
      throw new NotFoundException('Parent link not found');
    }

    if (link.classroom.adultMode) {
      throw new ForbiddenException(
        'Parent viewing is disabled while the classroom is in adult education mode',
      );
    }

    const [reportCard, metrics] = await Promise.all([
      this.metrics.readStudentReportCard(link.classroomId, link.childId, query),
      this.metrics.readStudentActivitySummary(link.classroomId, link.childId),
    ]);

    return {
      link: toFamilyLinkDto(link),
      items: reportCard.items,
      page: reportCard.page,
      pageSize: reportCard.pageSize,
      total: reportCard.total,
      metrics,
    };
  }
}
