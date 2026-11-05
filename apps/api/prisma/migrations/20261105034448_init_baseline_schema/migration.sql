-- CreateEnum
CREATE TYPE "school_role" AS ENUM ('owner', 'admin', 'teacher');

-- CreateEnum
CREATE TYPE "membership_state" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "classroom_role" AS ENUM ('teacher', 'student');

-- CreateEnum
CREATE TYPE "invitation_kind" AS ENUM ('email', 'join_code');

-- CreateEnum
CREATE TYPE "invitation_role" AS ENUM ('owner', 'admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "invitation_state" AS ENUM ('pending', 'used', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatar_configurations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "avatar_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_members" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "school_role" NOT NULL,
    "state" "membership_state" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "school_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "independent_teacher_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "adult_mode" BOOLEAN NOT NULL DEFAULT false,
    "chat_muted" BOOLEAN NOT NULL DEFAULT false,
    "collaboration_locked" BOOLEAN NOT NULL DEFAULT false,
    "games_disabled" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_memberships" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "classroom_role" NOT NULL DEFAULT 'student',
    "state" "membership_state" NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classroom_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desks" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "membership_id" UUID,
    "desk_index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "desks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_pets" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "species" VARCHAR(50) NOT NULL DEFAULT 'cat',
    "level" INTEGER NOT NULL DEFAULT 1,
    "experience" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classroom_pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_links" (
    "id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "child_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "state" "membership_state" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parent_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "kind" "invitation_kind" NOT NULL DEFAULT 'email',
    "secret_hash" VARCHAR(255) NOT NULL,
    "target_email" VARCHAR(255),
    "school_id" UUID,
    "classroom_id" UUID,
    "role" "invitation_role" NOT NULL DEFAULT 'student',
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" "invitation_state" NOT NULL DEFAULT 'pending',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "join_code_usages" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_refresh_token_hash_idx" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_configurations_user_id_key" ON "avatar_configurations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");

-- CreateIndex
CREATE INDEX "school_members_school_id_idx" ON "school_members"("school_id");

-- CreateIndex
CREATE INDEX "school_members_user_id_idx" ON "school_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_members_school_id_user_id_key" ON "school_members"("school_id", "user_id");

-- CreateIndex
CREATE INDEX "classrooms_school_id_idx" ON "classrooms"("school_id");

-- CreateIndex
CREATE INDEX "classrooms_independent_teacher_id_idx" ON "classrooms"("independent_teacher_id");

-- CreateIndex
CREATE INDEX "classroom_memberships_classroom_id_idx" ON "classroom_memberships"("classroom_id");

-- CreateIndex
CREATE INDEX "classroom_memberships_user_id_idx" ON "classroom_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_memberships_classroom_id_user_id_key" ON "classroom_memberships"("classroom_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "desks_membership_id_key" ON "desks"("membership_id");

-- CreateIndex
CREATE INDEX "desks_classroom_id_idx" ON "desks"("classroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "desks_classroom_id_desk_index_key" ON "desks"("classroom_id", "desk_index");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_pets_classroom_id_key" ON "classroom_pets"("classroom_id");

-- CreateIndex
CREATE INDEX "parent_links_parent_id_idx" ON "parent_links"("parent_id");

-- CreateIndex
CREATE INDEX "parent_links_child_id_idx" ON "parent_links"("child_id");

-- CreateIndex
CREATE INDEX "parent_links_classroom_id_idx" ON "parent_links"("classroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_links_parent_id_child_id_classroom_id_key" ON "parent_links"("parent_id", "child_id", "classroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_secret_hash_key" ON "invitations"("secret_hash");

-- CreateIndex
CREATE INDEX "invitations_school_id_idx" ON "invitations"("school_id");

-- CreateIndex
CREATE INDEX "invitations_classroom_id_idx" ON "invitations"("classroom_id");

-- CreateIndex
CREATE INDEX "invitations_created_by_id_idx" ON "invitations"("created_by_id");

-- CreateIndex
CREATE INDEX "invitations_target_email_idx" ON "invitations"("target_email");

-- CreateIndex
CREATE INDEX "join_code_usages_invitation_id_idx" ON "join_code_usages"("invitation_id");

-- CreateIndex
CREATE INDEX "join_code_usages_user_id_idx" ON "join_code_usages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "join_code_usages_invitation_id_user_id_key" ON "join_code_usages"("invitation_id", "user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_configurations" ADD CONSTRAINT "avatar_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_members" ADD CONSTRAINT "school_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_independent_teacher_id_fkey" FOREIGN KEY ("independent_teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desks" ADD CONSTRAINT "desks_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desks" ADD CONSTRAINT "desks_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "classroom_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_pets" ADD CONSTRAINT "classroom_pets_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_code_usages" ADD CONSTRAINT "join_code_usages_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_code_usages" ADD CONSTRAINT "join_code_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business constraints mandated by rules/data.md:

-- 1. Exactly one Owner per school (enforced via unique partial index)
CREATE UNIQUE INDEX "school_members_single_owner_per_school_idx"
ON "school_members"("school_id")
WHERE "role" = 'owner' AND "state" = 'active';

-- 2. Classroom MUST reference exactly one of school_id OR independent_teacher_id
ALTER TABLE "classrooms"
ADD CONSTRAINT "classrooms_owner_exclusion_check"
CHECK (
  ("school_id" IS NOT NULL AND "independent_teacher_id" IS NULL) OR
  ("school_id" IS NULL AND "independent_teacher_id" IS NOT NULL)
);

-- 3. Invitation integrity rules per D7:
-- Email invitations require target_email and at least one target (school_id or classroom_id);
-- Join codes MUST NOT have target_email, MUST have role 'student', and MUST have classroom_id
-- Join codes use_count cannot exceed max_uses when max_uses is set
ALTER TABLE "invitations"
ADD CONSTRAINT "invitations_kind_check"
CHECK (
  ("kind" = 'email' AND "target_email" IS NOT NULL AND ("school_id" IS NOT NULL OR "classroom_id" IS NOT NULL)) OR
  ("kind" = 'join_code' AND "target_email" IS NULL AND "role" = 'student' AND "classroom_id" IS NOT NULL)
);

ALTER TABLE "invitations"
ADD CONSTRAINT "invitations_max_uses_check"
CHECK (
  "max_uses" IS NULL OR "use_count" <= "max_uses"
);

-- 4. Unique normalized email
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users"(LOWER("email"));
