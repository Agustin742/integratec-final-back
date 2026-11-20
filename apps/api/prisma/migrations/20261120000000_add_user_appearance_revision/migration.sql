ALTER TABLE "users"
ADD COLUMN "appearance_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
ADD CONSTRAINT "users_appearance_revision_check"
CHECK ("appearance_revision" >= 0);
