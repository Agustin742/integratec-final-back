-- AlterEnum
-- Only adds values: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "equipped_slot" ADD VALUE 'hand';
ALTER TYPE "equipped_slot" ADD VALUE 'neck';
ALTER TYPE "equipped_slot" ADD VALUE 'ears';
