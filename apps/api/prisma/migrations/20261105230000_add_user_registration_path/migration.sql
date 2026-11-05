-- CreateEnum
CREATE TYPE "registration_path" AS ENUM ('independent_teacher', 'school');

-- AlterTable: Add column as nullable first to allow backfill
ALTER TABLE "users" ADD COLUMN "registration_path" "registration_path";

-- Backfill: label users with an OWNER membership in a school as 'school'
UPDATE "users"
SET "registration_path" = 'school'
WHERE "id" IN (
    SELECT "user_id"
    FROM "school_members"
    WHERE "role" = 'owner'
);

-- Backfill: label all remaining users as 'independent_teacher'
UPDATE "users"
SET "registration_path" = 'independent_teacher'
WHERE "registration_path" IS NULL;

-- AlterTable: set NOT NULL constraint without default
ALTER TABLE "users" ALTER COLUMN "registration_path" SET NOT NULL;
