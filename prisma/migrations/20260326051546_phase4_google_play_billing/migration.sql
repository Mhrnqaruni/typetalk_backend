-- CreateEnum
CREATE TYPE "PurchaseAcknowledgmentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACKNOWLEDGED', 'FAILED');

-- CreateTable
CREATE TABLE "purchase_tokens" (
    "purchase_token" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "plan_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "base_plan_id" TEXT,
    "linked_purchase_token" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "acknowledgment_status" "PurchaseAcknowledgmentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "acknowledgment_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "acknowledgment_last_error" TEXT,
    "acknowledgment_next_retry_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_tokens_pkey" PRIMARY KEY ("purchase_token")
);

-- CreateIndex
CREATE INDEX "purchase_tokens_organization_id_updated_at_purchase_token_idx" ON "purchase_tokens"("organization_id", "updated_at", "purchase_token");

-- CreateIndex
CREATE INDEX "purchase_tokens_plan_id_idx" ON "purchase_tokens"("plan_id");

-- CreateIndex
CREATE INDEX "purchase_tokens_subscription_id_idx" ON "purchase_tokens"("subscription_id");

-- CreateIndex
CREATE INDEX "purchase_tokens_linked_purchase_token_idx" ON "purchase_tokens"("linked_purchase_token");

-- CreateIndex
CREATE INDEX "purchase_tokens_acknowledgment_status_acknowledgment_next_r_idx" ON "purchase_tokens"("acknowledgment_status", "acknowledgment_next_retry_at");

-- AddForeignKey
ALTER TABLE "purchase_tokens" ADD CONSTRAINT "purchase_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_tokens" ADD CONSTRAINT "purchase_tokens_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_tokens" ADD CONSTRAINT "purchase_tokens_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
