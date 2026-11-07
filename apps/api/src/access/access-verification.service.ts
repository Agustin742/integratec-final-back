import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
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

    let derivedRole: ClassroomAccessRole | null = null;
    let linkedChildIds: string[] | undefined;
    let activeSchoolMember: { role: SchoolRole } | null = null;

    // Hierarchy step a: School classroom check
    if (classroom.schoolId !== null) {
      const school = await this.prisma.school.findFirst({
        where: { id: classroom.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!school) {
        throw new NotFoundException('Classroom not found');
      }

      activeSchoolMember = await this.prisma.schoolMember.findFirst({
        where: {
          schoolId: classroom.schoolId,
          userId: actorUserId,
          state: MembershipState.ACTIVE,
        },
        select: { role: true },
      });

      if (activeSchoolMember) {
        if (activeSchoolMember.role === SchoolRole.OWNER) {
          derivedRole = 'OWNER';
        } else if (activeSchoolMember.role === SchoolRole.ADMIN) {
          derivedRole = 'ADMIN';
        }
        // Note: A teacher in the school does NOT get authority over this classroom
        // unless they are explicitly assigned to teach this classroom (handled below in step b).
      }
    }

    // Hierarchy step b & c: Classroom membership (Teacher or Student)
    if (!derivedRole) {
      if (
        classroom.independentTeacherId !== null &&
        classroom.independentTeacherId === actorUserId
      ) {
        derivedRole = 'TEACHER';
      } else {
        const membership = await this.prisma.classroomMembership.findFirst({
          where: {
            classroomId: classroom.id,
            userId: actorUserId,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
          select: { role: true },
        });

        if (membership) {
          if (membership.role === ClassroomRole.TEACHER) {
            // When classroom.schoolId !== null, verify that the teacher has an ACTIVE membership in the school.
            // If not active in school, teacher has lost school authority; do not grant TEACHER role (yields 404).
            if (classroom.schoolId !== null) {
              if (activeSchoolMember) {
                derivedRole = 'TEACHER';
              }
            } else {
              derivedRole = 'TEACHER';
            }
          } else if (membership.role === ClassroomRole.STUDENT) {
            derivedRole = 'STUDENT';
          }
        }
      }
    }

    // Hierarchy step d: Parent linked to a child in that classroom (disabled in adult mode)
    if (!derivedRole && !classroom.adultMode) {
      const parentLinks = await this.prisma.parentLink.findMany({
        where: {
          classroomId: classroom.id,
          parentId: actorUserId,
          state: MembershipState.ACTIVE,
        },
        select: { childId: true },
      });
      if (parentLinks.length > 0) {
        derivedRole = 'PARENT';
        linkedChildIds = parentLinks.map((p) => p.childId);
      }
    }

    // If no relationship was found, return 404 to avoid leaking existence
    if (!derivedRole) {
      throw new NotFoundException('Classroom not found');
    }

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
