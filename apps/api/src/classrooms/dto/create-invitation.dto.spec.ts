import { randomUUID } from 'node:crypto';
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

  it('accepts a PARENT role with a valid childId UUID', async () => {
    expect(
      await errorsFor({
        email: 'parent@example.edu.ar',
        role: InvitationRole.PARENT,
        childId: randomUUID(),
      }),
    ).toEqual([]);
  });

  it('rejects a non-UUID childId', async () => {
    const errors = await errorsFor({
      email: 'parent@example.edu.ar',
      role: InvitationRole.PARENT,
      childId: 'not-a-uuid',
    });
    expect(errors.map((e) => e.property)).toEqual(['childId']);
  });

  it.each([InvitationRole.TEACHER, InvitationRole.ADMIN, InvitationRole.OWNER])(
    'rejects the %s role',
    async (role) => {
      const errors = await errorsFor({ email: 'a@example.edu.ar', role });
      expect(errors.map((e) => e.property)).toEqual(['role']);
    },
  );
});
