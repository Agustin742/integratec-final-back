-- AlterTable
ALTER TABLE "activity_metrics" ADD COLUMN     "message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submission_count" INTEGER NOT NULL DEFAULT 0;
