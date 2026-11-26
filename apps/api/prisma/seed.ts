import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  MembershipState,
  Prisma,
  PrismaClient,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import { hashPassword } from '../src/auth/password-hash';
import { assertSafeToSeed } from './seed-guard';
import { SHOP_CATALOG } from './seed-shop-catalog';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'AulaLocal2026!';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  assertSafeToSeed(process.env);

  // Reset local application data while preserving Prisma's migration history.
  await prisma.$executeRaw`
    TRUNCATE TABLE
      "outbox_events",
      "point_transactions",
      "shop_items",
      "badge_definitions",
      "schools",
      "classrooms",
      "users"
    RESTART IDENTITY CASCADE
  `;

  // 1. Synthetic accounts share a documented local-only password, stored as salted hashes.
  const owner = await prisma.user.create({
    data: {
      email: 'directora@escuela-modelo.edu.ar',
      passwordHash: await hashPassword(DEMO_PASSWORD),
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
      passwordHash: await hashPassword(DEMO_PASSWORD),
      displayName: 'Prof. Carlos Pérez',
      registrationPath: RegistrationPath.SCHOOL,
    },
  });

  const student = await prisma.user.create({
    data: {
      email: 'alumno.lucas@escuela-modelo.edu.ar',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      displayName: 'Lucas Alumno',
      registrationPath: RegistrationPath.SCHOOL,
    },
  });

  const parent = await prisma.user.create({
    data: {
      email: 'padre.roberto@example.com',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      displayName: 'Roberto Padre',
      registrationPath: RegistrationPath.SCHOOL,
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
            { userId: owner.id, role: SchoolRole.OWNER, state: MembershipState.ACTIVE },
            { userId: teacher.id, role: SchoolRole.TEACHER, state: MembershipState.ACTIVE },
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
          {
            userId: teacher.id,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
          {
            userId: student.id,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      },
      desks: {
        create: Array.from({ length: 12 }, (_, index) => ({ deskIndex: index + 1 })),
      },
    },
    include: {
      memberships: true,
      desks: true,
    },
  });

  const studentMembership = classroom.memberships.find((m) => m.userId === student.id);
  const firstDesk = classroom.desks.find((desk) => desk.deskIndex === 1);
  if (!studentMembership || !firstDesk) {
    throw new Error('Seed failed to create the student membership or first desk');
  }
  await prisma.desk.update({
    where: { id: firstDesk.id },
    data: { membershipId: studentMembership.id },
  });

  // 4. Parent link enables the limited linked-child grade view.
  await prisma.parentLink.create({
    data: {
      parentId: parent.id,
      childId: student.id,
      classroomId: classroom.id,
      state: 'ACTIVE',
    },
  });

  // 5. Draft activities let the teacher publish them through the app before student testing.
  const dueAt = new Date(Date.now() + 14 * DAY_IN_MS);
  const activityDefaults = {
    classroomId: classroom.id,
    createdById: teacher.id,
    type: ActivityType.TP,
    state: ActivityState.DRAFT,
    dueAt,
    allowLate: false,
    maxScore: 100,
    weightMultiplier: new Prisma.Decimal('1.00'),
  };

  await prisma.activity.create({
    data: {
      ...activityDefaults,
      format: ActivityFormat.MULTIPLE_CHOICE,
      title: 'Práctica de fracciones',
      description: 'Respondé las preguntas para practicar equivalencias.',
      questions: {
        create: [
          {
            position: 1,
            prompt: '¿Qué fracción es equivalente a 1/2?',
            options: {
              create: [
                { position: 1, label: '2/4', isCorrect: true },
                { position: 2, label: '2/3', isCorrect: false },
                { position: 3, label: '3/5', isCorrect: false },
              ],
            },
          },
          {
            position: 2,
            prompt: '¿Qué fracción es equivalente a 3/4?',
            options: {
              create: [
                { position: 1, label: '6/8', isCorrect: true },
                { position: 2, label: '4/6', isCorrect: false },
                { position: 3, label: '5/8', isCorrect: false },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.activity.create({
    data: {
      ...activityDefaults,
      format: ActivityFormat.FILE,
      title: 'Entrega: problemas de fracciones',
      description: 'Resolvé los ejercicios y entregá un PDF o una imagen.',
    },
  });

  // 6. Synthetic shop catalog: avatar accessories, desk decor and paid styles (never seeded in
  // production or SQL migrations).
  await prisma.shopItem.createMany({ data: [...SHOP_CATALOG] });

  // 7. Test badge catalog for the idempotent awarding mechanism (HU-GAM-002).
  // The real medal catalog, its conditions, and its rewards are open (gap 18);
  // these synthetic entries exist so the mechanism is demonstrable and testable.
  await prisma.badgeDefinition.createMany({
    data: [
      {
        code: 'streak_3',
        name: 'Racha de tres días',
        description: 'Alcanzá tres días consecutivos de actividad válida.',
        conditionType: 'STREAK_REACHED',
        threshold: 3,
        isActive: true,
      },
      {
        code: 'streak_7',
        name: 'Una semana de constancia',
        description: 'Alcanzá siete días consecutivos de actividad válida.',
        conditionType: 'STREAK_REACHED',
        threshold: 7,
        isActive: true,
      },
      {
        code: 'active_days_5',
        name: 'Cinco días de estudio',
        description: 'Completá actividad de estudio válida en cinco días distintos.',
        conditionType: 'QUALIFYING_DAYS_REACHED',
        threshold: 5,
        isActive: true,
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
