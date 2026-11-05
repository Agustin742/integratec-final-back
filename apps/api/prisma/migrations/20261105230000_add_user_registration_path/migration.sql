-- CreateEnum
CREATE TYPE "registration_path" AS ENUM ('independent_teacher', 'school');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "registration_path" "registration_path" NOT NULL DEFAULT 'independent_teacher';
