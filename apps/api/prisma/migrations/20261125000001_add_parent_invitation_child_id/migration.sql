-- AlterTable
ALTER TABLE "invitations" ADD COLUMN "child_id" UUID;

-- CreateIndex
CREATE INDEX "invitations_child_id_idx" ON "invitations"("child_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Parent invitations MUST carry child_id and classroom_id; non-parent invitations MUST NOT carry child_id.
ALTER TABLE "invitations"
ADD CONSTRAINT "invitations_parent_child_check"
CHECK (
  ("role" <> 'parent' AND "child_id" IS NULL) OR
  ("role" = 'parent' AND "child_id" IS NOT NULL AND "classroom_id" IS NOT NULL)
);
