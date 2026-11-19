import { PrismaClient, RegistrationPath, ShopItemKind } from '@prisma/client';
import { assertSafeToSeed } from './seed-guard';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  assertSafeToSeed(process.env);

  // Clean existing seed data
  // point_transactions is append-only against UPDATE/DELETE, and student_purchases / classroom_items /
  // grades / grade_revisions reference point_transactions; TRUNCATE together is allowed for dev/test seed resets.
  await prisma.$executeRaw`TRUNCATE TABLE "grade_revisions", "grades", "classroom_items", "student_purchases", "point_transactions"`;
  await prisma.equippedItem.deleteMany();
  await prisma.studentBadge.deleteMany();
  await prisma.streakQualifyingDay.deleteMany();
  await prisma.streak.deleteMany();
  await prisma.badgeDefinition.deleteMany();
  await prisma.submissionFile.deleteMany();
  await prisma.submissionAnswer.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.option.deleteMany();
  await prisma.question.deleteMany();
  await prisma.activityForumPost.deleteMany();
  await prisma.activityForumThread.deleteMany();
  await prisma.mention.deleteMany();
  await prisma.message.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.studyMaterial.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.classroomShopItem.deleteMany();
  await prisma.shopItem.deleteMany();
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

  // 6. Synthetic classroom shop catalog (never seeded in production or SQL migrations)
  await prisma.shopItem.createMany({
    data: [
      {
        code: 'cap_blue',
        name: 'Blue Classroom Cap',
        description: 'Classic blue cap accessory for your 3D avatar.',
        kind: ShopItemKind.AVATAR_ACCESSORY,
        defaultPrice: 50,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'cap', slot: 'head', color: '#1E3A8A' },
      },
      {
        code: 'headphones_studio',
        name: 'Studio Headphones',
        description: 'Over-ear headphones accessory for your 3D avatar.',
        kind: ShopItemKind.AVATAR_ACCESSORY,
        defaultPrice: 80,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'headphones', slot: 'head' },
      },
      {
        code: 'glasses_round',
        name: 'Round Reading Glasses',
        description: 'Lightweight round glasses for your 3D avatar.',
        kind: ShopItemKind.AVATAR_ACCESSORY,
        defaultPrice: 40,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'glasses', slot: 'face' },
      },
      {
        code: 'backpack_explorer',
        name: 'Explorer Backpack',
        description: 'Campus backpack accessory for your 3D avatar.',
        kind: ShopItemKind.AVATAR_ACCESSORY,
        defaultPrice: 100,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'backpack', slot: 'back' },
      },
      {
        code: 'desk_plant',
        name: 'Desk Succulent Plant',
        description: 'Small potted succulent upgrade for your classroom desk.',
        kind: ShopItemKind.DESK_UPGRADE,
        defaultPrice: 60,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'desk_plant', slot: 'desk_decor' },
      },
      {
        code: 'classroom_theme_warm',
        name: 'Warm Classroom Theme',
        description: 'Unlocks a warm lighting and accent theme for the whole classroom.',
        kind: ShopItemKind.CLASSROOM_ITEM,
        defaultPrice: 150,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'classroom_theme_warm', effect: 'theme_warm' },
      },
      {
        code: 'minigame_pong',
        name: 'Classroom Pong Mini-Game',
        description: 'Planned classroom mini-game (not yet implemented and unpurchasable).',
        kind: ShopItemKind.CLASSROOM_ITEM,
        defaultPrice: 200,
        isActive: true,
        isImplemented: false,
        metadata: { assetId: 'minigame_pong', planned: true },
      },
      {
        code: 'pet_scarf',
        name: 'Classroom Pet Scarf',
        description: 'Planned pet accessory (not yet implemented and unpurchasable).',
        kind: ShopItemKind.PET_ACCESSORY,
        defaultPrice: 45,
        isActive: true,
        isImplemented: false,
        metadata: { assetId: 'pet_scarf', planned: true },
      },
    ],
  });

  // 7. Test badge catalog for the idempotent awarding mechanism (HU-GAM-002).
  // The real medal catalog, its conditions, and its rewards are open (gap 18);
  // these synthetic entries exist so the mechanism is demonstrable and testable.
  await prisma.badgeDefinition.createMany({
    data: [
      {
        code: 'streak_3',
        name: 'Three-Day Study Streak',
        description: 'Reach a study streak of 3 consecutive qualifying days.',
        conditionType: 'STREAK_REACHED',
        threshold: 3,
        isActive: true,
      },
      {
        code: 'streak_7',
        name: 'Week of Constancy',
        description: 'Reach a study streak of 7 consecutive qualifying days.',
        conditionType: 'STREAK_REACHED',
        threshold: 7,
        isActive: true,
      },
      {
        code: 'active_days_5',
        name: 'Five Study Days',
        description: 'Complete qualifying study activity on 5 different days.',
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
