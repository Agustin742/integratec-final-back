-- Additive only: creates new tables; no existing records are rewritten or removed.
-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_activity_id_student_id_key" ON "submissions"("activity_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_storage_key_key" ON "submission_files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_submission_id_position_key" ON "submission_files"("submission_id", "position");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The idempotency key is the client's Idempotency-Key header; bound it so it stays a sane lookup key.
ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_idempotency_key_check"
CHECK (char_length("idempotency_key") BETWEEN 1 AND 255);

-- Each file is 1 byte to 10 MB (10485760 bytes); the service validates the same bound.
ALTER TABLE "submission_files"
ADD CONSTRAINT "submission_files_size_bytes_check"
CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760);

-- Positions are 0-based and a submission holds at most five files.
ALTER TABLE "submission_files"
ADD CONSTRAINT "submission_files_position_check"
CHECK ("position" BETWEEN 0 AND 4);

ALTER TABLE "submission_files"
ADD CONSTRAINT "submission_files_original_name_check"
CHECK (char_length("original_name") BETWEEN 1 AND 255);

-- Allow-list agreed for submissions: PDF, PNG, JPEG and DOCX (detected server-side by magic bytes).
ALTER TABLE "submission_files"
ADD CONSTRAINT "submission_files_content_type_check"
CHECK ("content_type" IN (
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
));
