-- Additive only: no existing records are rewritten or removed.

-- CreateEnum
CREATE TYPE "point_entry_kind" AS ENUM ('earning', 'debit', 'compensation');

-- CreateTable
CREATE TABLE "point_transactions" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "actor_id" UUID,
    "entry_kind" "point_entry_kind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128),
    "reason" VARCHAR(240) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "point_transactions_idempotency_key_key" ON "point_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "point_transactions_classroom_id_student_id_created_at_id_idx" ON "point_transactions"("classroom_id", "student_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "point_transactions_student_id_idx" ON "point_transactions"("student_id");

-- Partial unique index: at most one earning entry per (source_type, source_id)
CREATE UNIQUE INDEX "point_transactions_earning_source_uidx"
ON "point_transactions"("source_type", "source_id")
WHERE "entry_kind" = 'earning';

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business integrity CHECK constraints
ALTER TABLE "point_transactions"
ADD CONSTRAINT "point_transactions_amount_non_zero_check"
CHECK ("amount" <> 0);

ALTER TABLE "point_transactions"
ADD CONSTRAINT "point_transactions_earning_positive_check"
CHECK ("entry_kind" <> 'earning' OR "amount" > 0);

ALTER TABLE "point_transactions"
ADD CONSTRAINT "point_transactions_debit_negative_check"
CHECK ("entry_kind" <> 'debit' OR "amount" < 0);

ALTER TABLE "point_transactions"
ADD CONSTRAINT "point_transactions_reason_non_empty_check"
CHECK (char_length(btrim("reason")) > 0);

ALTER TABLE "point_transactions"
ADD CONSTRAINT "point_transactions_source_type_non_empty_check"
CHECK (char_length(btrim("source_type")) > 0);

-- Database-level immutability: reject any UPDATE or DELETE even via raw SQL
CREATE OR REPLACE FUNCTION prevent_point_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'point_transactions entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "point_transactions_immutable_trg"
BEFORE UPDATE OR DELETE ON "point_transactions"
FOR EACH ROW
EXECUTE FUNCTION prevent_point_transaction_mutation();
