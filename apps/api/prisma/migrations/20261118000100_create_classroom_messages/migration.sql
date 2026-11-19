-- Additive only: no backfill, purge, membership change or existing Mention rewrite.
-- ParentLink reserves the alternative storage context, not a parent messaging API.
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "classroom_id" UUID,
    "parent_link_id" UUID,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "hidden_at" TIMESTAMPTZ(6),
    "hidden_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_context_check"
        CHECK (("classroom_id" IS NOT NULL) <> ("parent_link_id" IS NOT NULL)),
    CONSTRAINT "messages_moderation_check"
        CHECK (("hidden_at" IS NULL) = ("hidden_by_id" IS NULL))
);

-- Stable history ordering and persisted per-author window counts for future admission.
CREATE INDEX "messages_classroom_id_created_at_id_idx"
    ON "messages"("classroom_id", "created_at", "id");
CREATE INDEX "messages_classroom_id_author_id_created_at_id_idx"
    ON "messages"("classroom_id", "author_id", "created_at", "id");
CREATE INDEX "messages_parent_link_id_created_at_id_idx"
    ON "messages"("parent_link_id", "created_at", "id");
CREATE INDEX "messages_author_id_idx" ON "messages"("author_id");
CREATE INDEX "messages_hidden_by_id_idx" ON "messages"("hidden_by_id");

ALTER TABLE "messages" ADD CONSTRAINT "messages_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_link_id_fkey"
    FOREIGN KEY ("parent_link_id") REFERENCES "parent_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_hidden_by_id_fkey"
    FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
