-- Additive only: no backfill. A missing marker means "nothing read yet".
-- Foreign keys use RESTRICT like messages: chat rows are never deleted, so a marker can never
-- dangle and its last_read_message_id stays NOT NULL.
CREATE TABLE "chat_read_markers" (
    "user_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "last_read_message_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "chat_read_markers_pkey" PRIMARY KEY ("user_id", "classroom_id")
);

CREATE INDEX "chat_read_markers_classroom_id_idx" ON "chat_read_markers"("classroom_id");
CREATE INDEX "chat_read_markers_last_read_message_id_idx"
    ON "chat_read_markers"("last_read_message_id");

ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_last_read_message_id_fkey"
    FOREIGN KEY ("last_read_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
