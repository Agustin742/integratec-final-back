-- Additive only: no existing records are rewritten or removed.

-- CreateEnum
CREATE TYPE "shop_item_kind" AS ENUM ('classroom_item', 'avatar_accessory', 'desk_upgrade', 'pet_accessory');

-- CreateEnum
CREATE TYPE "classroom_item_state" AS ENUM ('unlocked', 'active', 'disabled');

-- CreateTable
CREATE TABLE "shop_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "shop_item_kind" NOT NULL,
    "default_price" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_implemented" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_shop_items" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "shop_item_id" UUID NOT NULL,
    "price_override" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classroom_shop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_purchases" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "shop_item_id" UUID NOT NULL,
    "point_transaction_id" UUID NOT NULL,
    "price_paid" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_items" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "shop_item_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "state" "classroom_item_state" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classroom_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_items_code_key" ON "shop_items"("code");

-- CreateIndex
CREATE INDEX "shop_items_kind_is_active_idx" ON "shop_items"("kind", "is_active");

-- CreateIndex
CREATE INDEX "shop_items_default_price_id_idx" ON "shop_items"("default_price", "id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_shop_items_classroom_id_shop_item_id_key" ON "classroom_shop_items"("classroom_id", "shop_item_id");

-- CreateIndex
CREATE INDEX "classroom_shop_items_shop_item_id_idx" ON "classroom_shop_items"("shop_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_purchases_point_transaction_id_key" ON "student_purchases"("point_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_purchases_classroom_id_student_id_shop_item_id_key" ON "student_purchases"("classroom_id", "student_id", "shop_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_purchases_classroom_id_student_id_idempotency_key_key" ON "student_purchases"("classroom_id", "student_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "student_purchases_classroom_id_student_id_created_at_id_idx" ON "student_purchases"("classroom_id", "student_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "student_purchases_student_id_idx" ON "student_purchases"("student_id");

-- CreateIndex
CREATE INDEX "student_purchases_shop_item_id_idx" ON "student_purchases"("shop_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_items_purchase_id_key" ON "classroom_items"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_items_classroom_id_shop_item_id_key" ON "classroom_items"("classroom_id", "shop_item_id");

-- CreateIndex
CREATE INDEX "classroom_items_classroom_id_state_idx" ON "classroom_items"("classroom_id", "state");

-- CreateIndex
CREATE INDEX "classroom_items_shop_item_id_idx" ON "classroom_items"("shop_item_id");

-- AddForeignKey
ALTER TABLE "classroom_shop_items" ADD CONSTRAINT "classroom_shop_items_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_shop_items" ADD CONSTRAINT "classroom_shop_items_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_purchases" ADD CONSTRAINT "student_purchases_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_purchases" ADD CONSTRAINT "student_purchases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_purchases" ADD CONSTRAINT "student_purchases_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_purchases" ADD CONSTRAINT "student_purchases_point_transaction_id_fkey" FOREIGN KEY ("point_transaction_id") REFERENCES "point_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_items" ADD CONSTRAINT "classroom_items_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_items" ADD CONSTRAINT "classroom_items_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_items" ADD CONSTRAINT "classroom_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "student_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business integrity CHECK constraints
ALTER TABLE "shop_items"
ADD CONSTRAINT "shop_items_default_price_positive_check"
CHECK ("default_price" > 0);

ALTER TABLE "shop_items"
ADD CONSTRAINT "shop_items_code_non_empty_check"
CHECK (char_length(btrim("code")) > 0);

ALTER TABLE "shop_items"
ADD CONSTRAINT "shop_items_name_non_empty_check"
CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "classroom_shop_items"
ADD CONSTRAINT "classroom_shop_items_price_override_positive_check"
CHECK ("price_override" IS NULL OR "price_override" > 0);

ALTER TABLE "student_purchases"
ADD CONSTRAINT "student_purchases_price_paid_positive_check"
CHECK ("price_paid" > 0);

ALTER TABLE "student_purchases"
ADD CONSTRAINT "student_purchases_idempotency_key_non_empty_check"
CHECK (char_length(btrim("idempotency_key")) > 0);
