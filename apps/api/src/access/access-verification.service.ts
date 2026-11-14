import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type Classroom,
  ClassroomRole,
  MembershipState,
  type Prisma,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import type { Sort } from '../http/pagination/sort';
import { RequestValidationException } from '../http/validation';
import { PrismaService } from '../prisma/prisma.service';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClassroomAccessRole = 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export type ClassroomCapability =
  | 'manage_school'
  | 'configure_classroom'
  | 'invite_members'
  | 'publish_content'
  | 'moderate_chat'
  | 'configure_bot'
  | 'view_metrics'
  | 'participate_activities'
  | 'chat_classmates'
  | 'list_directory'
  | 'message_teacher';

export interface SchoolAccessResult {
  schoolId: string;
  userId: string;
  role: SchoolRole;
}

export interface ClassroomAccessResult {
  classroom: {
    id: string;
    schoolId: string | null;
    independentTeacherId: string | null;
    name: string;
    adultMode: boolean;
  };
  myRole: ClassroomAccessRole;
  capabilities: ClassroomCapability[];
  linkedChildIds?: string[];
}

export interface VerifyClassroomAccessOptions {
  requiredRole?: 'STAFF' | 'TEACHER' | 'STUDENT' | 'ANY';
}

export interface VerifySchoolAccessOptions {
  requiredRole?: 'OWNER' | 'ADMIN' | 'STAFF' | 'ANY';
}

/** Where a new classroom goes and the actor's resulting authority over it. */
export interface ClassroomCreationTarget {
  /** Exactly one of `schoolId` and `independentTeacherId` is set. */
  schoolId: string | null;
  independentTeacherId: string | null;
  /** The actor's school role when the target is a school; `null` for an independent classroom. */
  schoolRole: SchoolRole | null;
  myRole: 'OWNER' | 'ADMIN' | 'TEACHER';
  capabilities: ClassroomCapability[];
}

/** Persisted facts the hierarchy is derived from; see {@link deriveClassroomAccessRole}. */
export interface ClassroomRoleFacts {
  actorUserId: string;
  classroom: {
    schoolId: string | null;
    independentTeacherId: string | null;
    adultMode: boolean;
  };
  /** The actor's ACTIVE role in the classroom's school, if any. */
  schoolRole: SchoolRole | null;
  /** The actor's ACTIVE, non-deleted membership role in this classroom, if any. */
  membershipRole: ClassroomRole | null;
  /** The actor has an ACTIVE parent link in this classroom. */
  hasActiveParentLink: boolean;
}

export interface AccessibleClassroom {
  classroom: Classroom;
  myRole: ClassroomAccessRole;
  capabilities: ClassroomCapability[];
}

export interface ListAccessibleClassroomsOptions {
  skip: number;
  take: number;
  sort: Sort<'createdAt' | 'name'>;
}

/**
 * The single place that turns persisted facts into the actor's classroom role, in
 * the hierarchy of `rules/classrooms-and-roles.md`: school Owner/Admin, then the
 * classroom's teacher, then an enrolled student, then a linked parent (never in
 * adult mode). Returns `null` when no relation resolves: callers must fail closed.
 * Detail, list and any later authorization share this function so they cannot
 * disagree.
 */
export function deriveClassroomAccessRole(facts: ClassroomRoleFacts): ClassroomAccessRole | null {
  const { classroom, schoolRole, membershipRole, actorUserId } = facts;

  if (classroom.schoolId !== null) {
    if (schoolRole === SchoolRole.OWNER) return 'OWNER';
    if (schoolRole === SchoolRole.ADMIN) return 'ADMIN';
  }

  if (classroom.independentTeacherId !== null && classroom.independentTeacherId === actorUserId) {
    return 'TEACHER';
  }

  if (membershipRole === ClassroomRole.TEACHER) {
    // A school classroom teacher keeps authority only while active in that school.
    if (classroom.schoolId === null || schoolRole !== null) return 'TEACHER';
  } else if (membershipRole === ClassroomRole.STUDENT) {
    return 'STUDENT';
  }

  if (!classroom.adultMode && facts.hasActiveParentLink) return 'PARENT';

  return null;
}

/**
 * Derives classroom capabilities for an actor's resolved role according to the
 * Permission Matrix defined in `rules/classrooms-and-roles.md`.
 */
export function computeClassroomCapabilities(role: ClassroomAccessRole): ClassroomCapability[] {
  switch (role) {
    case 'OWNER':
      return [
        'manage_school',
        'configure_classroom',
        'invite_members',
        'publish_content',
        'moderate_chat',
        'configure_bot',
        'view_metrics',
        'chat_classmates',
        'list_directory',
        'message_teacher',
      ];
    case 'ADMIN':
      return [
        'configure_classroom',
        'invite_members',
        'publish_content',
        'moderate_chat',
        'configure_bot',
        'view_metrics',
        'chat_classmates',
        'list_directory',
        'message_teacher',
      ];
    case 'TEACHER':
      return [
        'configure_classroom',
        'invite_members',
        'publish_content',
        'moderate_chat',
        'configure_bot',
        'view_metrics',
        'chat_classmates',
        'list_directory',
        'message_teacher',
      ];
    case 'STUDENT':
      return [
        'view_metrics',
        'participate_activities',
        'chat_classmates',
        'list_directory',
        'message_teacher',
      ];
    case 'PARENT':
      return ['view_metrics', 'message_teacher'];
  }
}

/**
 * Central contextual authorization service enforcing server-side persisted state
 * per request. Implements resource isolation without existence leakage (404 for
 * strangers and cross-organization requests, 403 for members with insufficient role).
 */
@Injectable()
export class AccessVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifies that the actor has active membership in the specified school and
   * optionally enforces role requirements.
   *
   * Unknown school, deleted school, or stranger -> 404 NotFound.
   * Member with insufficient role -> 403 Forbidden.
   */
  async verifySchoolAccess(
    actorUserId: string,
    schoolId: string,
    options?: VerifySchoolAccessOptions,
  ): Promise<SchoolAccessResult> {
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(schoolId)) {
      throw new NotFoundException('School not found');
    }

    const school = await this.prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!school) {
      throw new NotFoundException('School not found');
    }

    const member = await this.prisma.schoolMember.findFirst({
      where: {
        schoolId,
        userId: actorUserId,
        state: MembershipState.ACTIVE,
      },
      select: { role: true },
    });

    if (!member) {
      throw new NotFoundException('School not found');
    }

    const required = options?.requiredRole ?? 'ANY';
    if (required === 'OWNER' && member.role !== SchoolRole.OWNER) {
      throw new ForbiddenException('School owner authority required');
    }
    if (
      required === 'ADMIN' &&
      member.role !== SchoolRole.OWNER &&
      member.role !== SchoolRole.ADMIN
    ) {
      throw new ForbiddenException('School administrator authority required');
    }
    if (
      required === 'STAFF' &&
      member.role !== SchoolRole.OWNER &&
      member.role !== SchoolRole.ADMIN &&
      member.role !== SchoolRole.TEACHER
    ) {
      throw new ForbiddenException('School staff authority required');
    }

    return {
      schoolId: school.id,
      userId: actorUserId,
      role: member.role,
    };
  }

  /**
   * Resolves the classroom from database and derives authority in exact hierarchy:
   * 1. School Owner/Admin hold teacher-level authority over ALL classrooms of their school.
   * 2. Teacher of the classroom (independent teacher or ClassroomMembership with role TEACHER).
   *    Note: A teacher CANNOT act on another teacher's classroom in the same school (yields 404).
   * 3. Student enrolled in the classroom (ClassroomMembership with role STUDENT, state ACTIVE).
   * 4. Parent linked to a child in the classroom (ParentLink ACTIVE), unless adultMode is true.
   *
   * Uniform status codes:
   * - Stranger / no relationship -> 404 NotFound (does not reveal existence).
   * - Member with insufficient role -> 403 Forbidden.
   */
  async verifyClassroomAccess(
    actorUserId: string,
    classroomId: string,
    options?: VerifyClassroomAccessOptions,
  ): Promise<ClassroomAccessResult> {
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(classroomId)) {
      throw new NotFoundException('Classroom not found');
    }

    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      select: {
        id: true,
        schoolId: true,
        independentTeacherId: true,
        name: true,
        adultMode: true,
      },
    });

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    if (classroom.schoolId !== null) {
      const school = await this.prisma.school.findFirst({
        where: { id: classroom.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!school) {
        throw new NotFoundException('Classroom not found');
      }
    }

    const [schoolMember, membership, parentLinks] = await Promise.all([
      classroom.schoolId === null
        ? Promise.resolve(null)
        : this.prisma.schoolMember.findFirst({
            where: {
              schoolId: classroom.schoolId,
              userId: actorUserId,
              state: MembershipState.ACTIVE,
            },
            select: { role: true },
          }),
      this.prisma.classroomMembership.findFirst({
        where: {
          classroomId: classroom.id,
          userId: actorUserId,
          state: MembershipState.ACTIVE,
          deletedAt: null,
        },
        select: { role: true },
      }),
      classroom.adultMode
        ? Promise.resolve([])
        : this.prisma.parentLink.findMany({
            where: {
              classroomId: classroom.id,
              parentId: actorUserId,
              state: MembershipState.ACTIVE,
            },
            select: { childId: true },
          }),
    ]);

    const derivedRole = deriveClassroomAccessRole({
      actorUserId,
      classroom,
      schoolRole: schoolMember?.role ?? null,
      membershipRole: membership?.role ?? null,
      hasActiveParentLink: parentLinks.length > 0,
    });

    // If no relationship was found, return 404 to avoid leaking existence
    if (!derivedRole) {
      throw new NotFoundException('Classroom not found');
    }

    const linkedChildIds = derivedRole === 'PARENT' ? parentLinks.map((p) => p.childId) : undefined;

    // Enforce role constraints if requested
    const required = options?.requiredRole ?? 'ANY';
    if (required === 'STAFF') {
      if (derivedRole !== 'OWNER' && derivedRole !== 'ADMIN' && derivedRole !== 'TEACHER') {
        throw new ForbiddenException('Staff role required for this action');
      }
    } else if (required === 'TEACHER') {
      if (derivedRole !== 'OWNER' && derivedRole !== 'ADMIN' && derivedRole !== 'TEACHER') {
        throw new ForbiddenException('Teacher authority required for this action');
      }
    } else if (required === 'STUDENT') {
      if (derivedRole !== 'STUDENT') {
        throw new ForbiddenException('Student role required for this action');
      }
    }

    const capabilities = computeClassroomCapabilities(derivedRole);

    return {
      classroom,
      myRole: derivedRole,
      capabilities,
      ...(linkedChildIds ? { linkedChildIds } : {}),
    };
  }

  /**
   * Decides where a new classroom goes and whether the actor may create it there.
   *
   * With an explicit `schoolId`: the actor must be an ACTIVE member of that school
   * (Owner, Admin and Teacher all create; see the permission matrix). A school the
   * actor has no relation to answers 404 exactly like a school that does not
   * exist. 403 is reserved for a student or parent who can see that school, so the
   * two cases never reveal whether an unrelated school exists.
   *
   * Without `schoolId`: an INDEPENDENT_TEACHER-path account creates its own
   * classroom (enrollments elsewhere do not matter). A SCHOOL-path account uses its
   * only active school; with several it must choose one (400 on `schoolId`), and
   * with none it answers 404, or 403 when it is a student or parent.
   */
  async resolveClassroomCreationTarget(
    actorUserId: string,
    requestedSchoolId?: string,
  ): Promise<ClassroomCreationTarget> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (requestedSchoolId !== undefined) {
      if (!UUID_PATTERN.test(requestedSchoolId)) {
        throw new NotFoundException('School not found');
      }
      try {
        const access = await this.verifySchoolAccess(actorUserId, requestedSchoolId, {
          requiredRole: 'STAFF',
        });
        return this.schoolCreationTarget(access.schoolId, access.role);
      } catch (error) {
        if (
          error instanceof NotFoundException &&
          (await this.hasLearnerRelation(actorUserId, requestedSchoolId))
        ) {
          throw new ForbiddenException('Students and parents cannot create classrooms');
        }
        throw error;
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { registrationPath: true },
    });
    if (!user) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (user.registrationPath === RegistrationPath.INDEPENDENT_TEACHER) {
      return {
        schoolId: null,
        independentTeacherId: actorUserId,
        schoolRole: null,
        myRole: 'TEACHER',
        capabilities: computeClassroomCapabilities('TEACHER'),
      };
    }

    const memberships = await this.prisma.schoolMember.findMany({
      where: {
        userId: actorUserId,
        state: MembershipState.ACTIVE,
        school: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { schoolId: true, role: true },
    });

    if (memberships.length === 1) {
      return this.schoolCreationTarget(memberships[0].schoolId, memberships[0].role);
    }

    if (memberships.length > 1) {
      throw new RequestValidationException([
        {
          field: 'schoolId',
          messages: ['schoolId is required because you belong to more than one school'],
        },
      ]);
    }

    if (await this.hasLearnerRelation(actorUserId)) {
      throw new ForbiddenException('Students and parents cannot create classrooms');
    }
    throw new NotFoundException('School not found');
  }

  /**
   * Lists the classrooms the actor can access together with the role and
   * capabilities derived by the same hierarchy as {@link verifyClassroomAccess}.
   * The query only preselects candidates; the role of every row is derived with
   * {@link deriveClassroomAccessRole} and a row without a resolved role is dropped
   * (fail closed).
   */
  async listAccessibleClassrooms(
    actorUserId: string,
    options: ListAccessibleClassroomsOptions,
  ): Promise<{ total: number; items: AccessibleClassroom[] }> {
    if (!UUID_PATTERN.test(actorUserId)) {
      return { total: 0, items: [] };
    }

    const activeMembership = (
      role: ClassroomRole,
    ): Prisma.ClassroomMembershipListRelationFilter => ({
      some: { userId: actorUserId, role, state: MembershipState.ACTIVE, deletedAt: null },
    });

    const where: Prisma.ClassroomWhereInput = {
      deletedAt: null,
      AND: [{ OR: [{ schoolId: null }, { school: { deletedAt: null } }] }],
      OR: [
        {
          school: {
            members: {
              some: {
                userId: actorUserId,
                state: MembershipState.ACTIVE,
                role: { in: [SchoolRole.OWNER, SchoolRole.ADMIN] },
              },
            },
          },
        },
        { independentTeacherId: actorUserId },
        {
          memberships: activeMembership(ClassroomRole.TEACHER),
          OR: [
            { schoolId: null },
            {
              school: {
                members: { some: { userId: actorUserId, state: MembershipState.ACTIVE } },
              },
            },
          ],
        },
        { memberships: activeMembership(ClassroomRole.STUDENT) },
        {
          adultMode: false,
          parentLinks: { some: { parentId: actorUserId, state: MembershipState.ACTIVE } },
        },
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.classroom.count({ where }),
      this.prisma.classroom.findMany({
        where,
        orderBy: [{ [options.sort.field]: options.sort.direction }, { id: 'asc' }],
        skip: options.skip,
        take: options.take,
        include: {
          school: {
            select: {
              deletedAt: true,
              members: {
                where: { userId: actorUserId, state: MembershipState.ACTIVE },
                select: { role: true },
              },
            },
          },
          memberships: {
            where: { userId: actorUserId, state: MembershipState.ACTIVE, deletedAt: null },
            select: { role: true },
          },
          parentLinks: {
            where: { parentId: actorUserId, state: MembershipState.ACTIVE },
            select: { id: true },
          },
        },
      }),
    ]);

    const items: AccessibleClassroom[] = [];
    for (const { school, memberships, parentLinks, ...classroom } of rows) {
      if (classroom.schoolId !== null && (school === null || school.deletedAt !== null)) {
        continue;
      }
      const myRole = deriveClassroomAccessRole({
        actorUserId,
        classroom,
        schoolRole: school?.members[0]?.role ?? null,
        membershipRole: memberships[0]?.role ?? null,
        hasActiveParentLink: parentLinks.length > 0,
      });
      if (myRole === null) continue;
      items.push({ classroom, myRole, capabilities: computeClassroomCapabilities(myRole) });
    }

    return { total, items };
  }

  private schoolCreationTarget(schoolId: string, schoolRole: SchoolRole): ClassroomCreationTarget {
    const myRole = schoolRole === SchoolRole.TEACHER ? 'TEACHER' : schoolRole;
    return {
      schoolId,
      independentTeacherId: null,
      schoolRole,
      myRole,
      capabilities: computeClassroomCapabilities(myRole),
    };
  }

  /**
   * Ids of the students currently enrolled in the classroom (role STUDENT, ACTIVE, not deleted),
   * optionally excluding one user. Owned here so producers (for example activity publishing) fan
   * out to recipients without querying membership tables themselves. Pass the caller's
   * transaction client so the read joins that transaction; ordered by id for determinism.
   */
  async listActiveStudentIds(
    classroomId: string,
    options: { excludeUserId?: string; client?: Prisma.TransactionClient } = {},
  ): Promise<string[]> {
    const client = options.client ?? this.prisma;
    const rows = await client.classroomMembership.findMany({
      where: {
        classroomId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        ...(options.excludeUserId === undefined ? {} : { userId: { not: options.excludeUserId } }),
      },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Whether the user is currently an enrolled student of the classroom (role STUDENT, ACTIVE, not
   * deleted). Pass the caller's transaction client to re-check inside a transaction after a row
   * lock, so a removal that committed meanwhile is seen.
   */
  async isActiveStudent(
    classroomId: string,
    userId: string,
    options: { client?: Prisma.TransactionClient } = {},
  ): Promise<boolean> {
    const client = options.client ?? this.prisma;
    const row = await client.classroomMembership.findFirst({
      where: {
        classroomId,
        userId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Whether the actor is an enrolled student or a linked parent (outside adult
   * mode, where the parent cannot see the classroom) in a live classroom, in the
   * given school or in any when `schoolId` is omitted. Only a visible relation
   * justifies a 403 instead of a 404.
   */
  private async hasLearnerRelation(actorUserId: string, schoolId?: string): Promise<boolean> {
    const classroomScope: Prisma.ClassroomWhereInput = {
      deletedAt: null,
      ...(schoolId === undefined
        ? { OR: [{ schoolId: null }, { school: { deletedAt: null } }] }
        : { schoolId, school: { deletedAt: null } }),
    };

    const [enrollment, parentLink] = await Promise.all([
      this.prisma.classroomMembership.findFirst({
        where: {
          userId: actorUserId,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
          deletedAt: null,
          classroom: classroomScope,
        },
        select: { id: true },
      }),
      this.prisma.parentLink.findFirst({
        where: {
          parentId: actorUserId,
          state: MembershipState.ACTIVE,
          classroom: { ...classroomScope, adultMode: false },
        },
        select: { id: true },
      }),
    ]);

    return enrollment !== null || parentLink !== null;
  }

  /**
   * Verifies access to a student's private resource (grades, submissions, purchases).
   *
   * Rules:
   * - Staff (Owner, Admin, Teacher): allowed.
   * - Own student resource (actorUserId === targetStudentId): allowed.
   * - Linked parent (not adult mode): allowed for child.
   * - Classmate student attempting access to another student: 403 Forbidden.
   * - Stranger / unlinked parent / student outside classroom: 404 NotFound.
   */
  async verifyStudentResourceAccess(
    actorUserId: string,
    targetStudentId: string,
    classroomId: string,
  ): Promise<ClassroomAccessResult> {
    if (
      !UUID_PATTERN.test(actorUserId) ||
      !UUID_PATTERN.test(targetStudentId) ||
      !UUID_PATTERN.test(classroomId)
    ) {
      throw new NotFoundException('Student resource not found in this classroom');
    }

    const access = await this.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'ANY',
    });

    const targetStudent = await this.prisma.classroomMembership.findFirst({
      where: {
        classroomId,
        userId: targetStudentId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!targetStudent) {
      throw new NotFoundException('Student resource not found in this classroom');
    }

    // Staff authority (Owner, Admin, or Teacher of this classroom)
    if (access.myRole === 'OWNER' || access.myRole === 'ADMIN' || access.myRole === 'TEACHER') {
      return access;
    }

    // Own student resource
    if (access.myRole === 'STUDENT') {
      if (actorUserId === targetStudentId) {
        return access;
      }
      // Classmate student attempting access to another student's resource -> 403 Forbidden
      throw new ForbiddenException('Cannot access another student resource');
    }

    // Linked parent
    if (access.myRole === 'PARENT') {
      if (!access.classroom.adultMode && access.linkedChildIds?.includes(targetStudentId)) {
        return access;
      }
      throw new NotFoundException('Student resource not found in this classroom');
    }

    throw new NotFoundException('Student resource not found in this classroom');
  }
}
