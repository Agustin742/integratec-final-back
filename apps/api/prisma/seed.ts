import { PrismaClient, RegistrationPath } from '@prisma/client';
import { assertSafeToSeed } from './seed-guard';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  assertSafeToSeed(process.env);

  // Clean existing seed data
  await prisma.joinCodeUsage.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.desk.deleteMany();
  await prisma.classroomPet.deleteMany();
  await prisma.classroomMembership.deleteMany();
  await prisma.parentLink.deleteMany();
  await prisma.classroom.deleteMany();
  await prisma.schoolMember.deleteMany();
  await prisma.school.deleteMany();
  await prisma.session.deleteMany();
  await prisma.avatarConfiguration.deleteMany();
  await prisma.user.deleteMany();

  // 1. Synthetic users with hashed passwords (never plain text)
  const syntheticHash = '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekd58amL3pqjK4Wqa';

  const owner = await prisma.user.create({
    data: {
      email: 'directora@escuela-modelo.edu.ar',
      passwordHash: syntheticHash,
      displayName: 'Directora Marta',
      registrationPath: RegistrationPath.SCHOOL,
      avatarConfig: {
        create: {
          appearance: { style: 'professional', color: '#1E3A8A' },
        },
      },
    },
  });

  const teacher = await prisma.user.create({
    data: {
      email: 'profe.carlos@escuela-modelo.edu.ar',
      passwordHash: syntheticHash,
      displayName: 'Prof. Carlos Perez',
      registrationPath: RegistrationPath.SCHOOL,
    },
  });

  const student = await prisma.user.create({
    data: {
      email: 'alumno.lucas@escuela-modelo.edu.ar',
      passwordHash: syntheticHash,
      displayName: 'Lucas Alumno',
      registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
    },
  });

  const parent = await prisma.user.create({
    data: {
      email: 'padre.roberto@example.com',
      passwordHash: syntheticHash,
      displayName: 'Roberto Padre',
      registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
    },
  });

  // 2. Synthetic school
  const school = await prisma.school.create({
    data: {
      name: 'Colegio Modelo Integrar',
      slug: 'colegio-modelo-integrar',
      timeZone: 'America/Argentina/Buenos_Aires',
      members: {
        createMany: {
          data: [
            { userId: owner.id, role: 'OWNER', state: 'ACTIVE' },
            { userId: teacher.id, role: 'TEACHER', state: 'ACTIVE' },
          ],
        },
      },
    },
  });

  // 3. Synthetic classroom with pet and desk
  const classroom = await prisma.classroom.create({
    data: {
      schoolId: school.id,
      name: 'Matemática 5to A',
      pet: {
        create: {
          name: 'Michi',
          species: 'cat',
        },
      },
      memberships: {
        create: [
          { userId: teacher.id, role: 'TEACHER', state: 'ACTIVE' },
          { userId: student.id, role: 'STUDENT', state: 'ACTIVE' },
        ],
      },
      desks: {
        create: [{ deskIndex: 1 }],
      },
    },
    include: {
      memberships: true,
      desks: true,
    },
  });

  // Assign student to desk 1
  const studentMembership = classroom.memberships.find((m) => m.userId === student.id);
  if (studentMembership && classroom.desks[0]) {
    await prisma.desk.update({
      where: { id: classroom.desks[0].id },
      data: { membershipId: studentMembership.id },
    });
  }

  // 4. Parent link for student in classroom context
  await prisma.parentLink.create({
    data: {
      parentId: parent.id,
      childId: student.id,
      classroomId: classroom.id,
      state: 'ACTIVE',
    },
  });

  // 5. Synthetic invitations: one email invitation and one join code
  await prisma.invitation.createMany({
    data: [
      {
        kind: 'EMAIL',
        secretHash: 'hash-invitacion-correo-sintetico-001',
        targetEmail: 'nuevo.profe@escuela-modelo.edu.ar',
        schoolId: school.id,
        role: 'TEACHER',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: owner.id,
      },
      {
        kind: 'JOIN_CODE',
        secretHash: 'hash-codigo-union-aula-sintetico-001',
        classroomId: classroom.id,
        role: 'STUDENT',
        maxUses: 35,
        useCount: 0,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdById: teacher.id,
      },
    ],
  });

  console.log('Seed applied successfully with synthetic school domain data.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
