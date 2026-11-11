import { InvitationRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateClassroomInvitationDto } from './create-invitation.dto';

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(CreateClassroomInvitationDto, body));
}

describe('CreateClassroomInvitationDto', () => {
  it('defaults the role to STUDENT when omitted', async () => {
    const dto = plainToInstance(CreateClassroomInvitationDto, { email: 'a@example.edu.ar' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.role).toBe(InvitationRole.STUDENT);
  });

  it('accepts an explicit STUDENT role', async () => {
    expect(await errorsFor({ email: 'a@example.edu.ar', role: InvitationRole.STUDENT })).toEqual(
      [],
    );
  });

  it.each([InvitationRole.TEACHER, InvitationRole.ADMIN, InvitationRole.OWNER, 'PARENT'])(
    'rejects the %s role',
    async (role) => {
      const errors = await errorsFor({ email: 'a@example.edu.ar', role });
      expect(errors.map((e) => e.property)).toEqual(['role']);
    },
  );
});
