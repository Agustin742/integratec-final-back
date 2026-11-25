-- AlterTable
ALTER TABLE "classrooms" ADD COLUMN     "tutor_bot_skin" VARCHAR(20) NOT NULL DEFAULT 'none',
ADD COLUMN     "tutor_bot_skin_revision" INTEGER NOT NULL DEFAULT 0;
