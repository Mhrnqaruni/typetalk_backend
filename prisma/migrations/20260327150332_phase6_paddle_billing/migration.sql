-- AlterEnum
ALTER TYPE "BillingProvider" ADD VALUE 'PADDLE';

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "paddle_price_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "plans_paddle_price_id_key" ON "plans"("paddle_price_id");

