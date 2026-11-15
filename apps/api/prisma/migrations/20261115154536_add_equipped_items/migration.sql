-- CreateEnum
CREATE TYPE "equipped_slot" AS ENUM ('head', 'face', 'back', 'desk_decor');

-- CreateTable
CREATE TABLE "equipped_items" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "slot" "equipped_slot" NOT NULL,
    "shop_item_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipped_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipped_items_shop_item_id_idx" ON "equipped_items"("shop_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipped_items_classroom_id_student_id_slot_key" ON "equipped_items"("classroom_id", "student_id", "slot");

-- AddForeignKey
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipped_items" ADD CONSTRAINT "equipped_items_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "shop_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
