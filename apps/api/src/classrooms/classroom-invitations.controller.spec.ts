import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomInvitationsService } from './classroom-invitations.service';
import { ClassroomsController } from './classrooms.controller';
import type { ClassroomsService } from './classrooms.service';
import { InvitationsController } from './invitations.controller';

describe('Invitations & Join Codes Controllers (Unit)', () => {
  let classroomsController: ClassroomsController;
  let invitationsController: InvitationsController;
  let mockClassroomsService: Record<string, ReturnType<typeof vi.fn>>;
  let mockInvitationsService: Record<string, ReturnType<typeof vi.fn>>;

  const ACTOR_USER_ID = randomUUID();
  const CLASSROOM_ID = randomUUID();
  const INVITATION_ID = randomUUID();

  beforeEach(() => {
    mockClassroomsService = {
      create: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      listForActor: vi.fn(),
    };

    mockInvitationsService = {
      createEmailInvitation: vi.fn(),
      listInvitations: vi.fn(),
      revokeInvitation: vi.fn(),
      generateJoinCode: vi.fn(),
      revokeJoinCode: vi.fn(),
      joinWithCode: vi.fn(),
      acceptEmailInvitation: vi.fn(),
    };

    classroomsController = new ClassroomsController(
      mockClassroomsService as unknown as ClassroomsService,
      mockInvitationsService as unknown as ClassroomInvitationsService,
    );

    invitationsController = new InvitationsController(
      mockInvitationsService as unknown as ClassroomInvitationsService,
    );
  });

  describe('ClassroomsController invitation & join code endpoints', () => {
    it('delegates POST /classrooms/:id/invitations to service', async () => {
      const dto = { email: 'student@example.edu.ar' };
      const expected = { id: INVITATION_ID, targetEmail: 'student@example.edu.ar' };
      mockInvitationsService.createEmailInvitation.mockResolvedValue(expected);

      const res = await classroomsController.createInvitation(ACTOR_USER_ID, CLASSROOM_ID, dto);

      expect(mockInvitationsService.createEmailInvitation).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        CLASSROOM_ID,
        dto,
      );
      expect(res).toBe(expected);
    });

    it('delegates GET /classrooms/:id/invitations to service', async () => {
      const query = { page: 1, pageSize: 20, status: 'PENDING' as const };
      const expected = { items: [], page: 1, pageSize: 20, total: 0 };
      mockInvitationsService.listInvitations.mockResolvedValue(expected);

      const res = await classroomsController.listInvitations(ACTOR_USER_ID, CLASSROOM_ID, query);

      expect(mockInvitationsService.listInvitations).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        CLASSROOM_ID,
        query,
      );
      expect(res).toBe(expected);
    });

    it('delegates DELETE /classrooms/:id/invitations/:invitationId to service', async () => {
      const expected = { id: INVITATION_ID, state: 'REVOKED' };
      mockInvitationsService.revokeInvitation.mockResolvedValue(expected);

      const res = await classroomsController.revokeInvitation(
        ACTOR_USER_ID,
        CLASSROOM_ID,
        INVITATION_ID,
      );

      expect(mockInvitationsService.revokeInvitation).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        CLASSROOM_ID,
        INVITATION_ID,
      );
      expect(res).toBe(expected);
    });

    it('delegates POST /classrooms/:id/join-code to service', async () => {
      const dto = { maxUses: 30 };
      const expected = { id: INVITATION_ID, code: 'ABC1234' };
      mockInvitationsService.generateJoinCode.mockResolvedValue(expected);

      const res = await classroomsController.generateJoinCode(ACTOR_USER_ID, CLASSROOM_ID, dto);

      expect(mockInvitationsService.generateJoinCode).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        CLASSROOM_ID,
        dto,
      );
      expect(res).toBe(expected);
    });

    it('delegates DELETE /classrooms/:id/join-code to service', async () => {
      const expected = { success: true, message: 'Revoked' };
      mockInvitationsService.revokeJoinCode.mockResolvedValue(expected);

      const res = await classroomsController.revokeJoinCode(ACTOR_USER_ID, CLASSROOM_ID);

      expect(mockInvitationsService.revokeJoinCode).toHaveBeenCalledWith(
        ACTOR_USER_ID,
        CLASSROOM_ID,
      );
      expect(res).toBe(expected);
    });

    it('delegates POST /classrooms/join to service', async () => {
      const dto = { code: 'ABC1234' };
      const expected = {
        classroomId: CLASSROOM_ID,
        membershipId: randomUUID(),
        alreadyMember: false,
      };
      mockInvitationsService.joinWithCode.mockResolvedValue(expected);

      const res = await classroomsController.joinClassroom(ACTOR_USER_ID, dto);

      expect(mockInvitationsService.joinWithCode).toHaveBeenCalledWith(ACTOR_USER_ID, dto);
      expect(res).toBe(expected);
    });
  });

  describe('InvitationsController accept endpoint', () => {
    it('delegates POST /invitations/accept to service', async () => {
      const dto = { token: 'sample-token' };
      const expected = {
        classroomId: CLASSROOM_ID,
        membershipId: randomUUID(),
        alreadyMember: false,
      };
      mockInvitationsService.acceptEmailInvitation.mockResolvedValue(expected);

      const res = await invitationsController.accept(ACTOR_USER_ID, dto);

      expect(mockInvitationsService.acceptEmailInvitation).toHaveBeenCalledWith(ACTOR_USER_ID, dto);
      expect(res).toBe(expected);
    });
  });
});
