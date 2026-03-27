-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('STRIPE', 'GOOGLE_PLAY');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('NONE', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'GRACE', 'PAYMENT_ISSUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EntitlementCode" AS ENUM ('FREE', 'TRIAL_ACTIVE', 'PRO_ACTIVE', 'PRO_GRACE', 'PAYMENT_ISSUE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'LIMITED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "billing_interval" "BillingInterval" NOT NULL,
    "weekly_word_limit" INTEGER NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "stripe_price_id" TEXT,
    "google_product_id" TEXT,
    "google_base_plan_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_customers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "provider_customer_id" TEXT,
    "provider" "BillingProvider" NOT NULL,
    "external_subscription_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "conflict_flag" BOOLEAN NOT NULL DEFAULT false,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "code" "EntitlementCode" NOT NULL,
    "status" "EntitlementStatus" NOT NULL,
    "billing_overlap" BOOLEAN NOT NULL DEFAULT false,
    "primary_subscription_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "source_provider" "BillingProvider",
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_price_id_key" ON "plans"("stripe_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_google_product_id_google_base_plan_id_key" ON "plans"("google_product_id", "google_base_plan_id");

-- CreateIndex
CREATE INDEX "provider_customers_organization_id_idx" ON "provider_customers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_customers_organization_id_provider_key" ON "provider_customers"("organization_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "provider_customers_provider_external_customer_id_key" ON "provider_customers"("provider", "external_customer_id");

-- CreateIndex
CREATE INDEX "subscriptions_organization_id_provider_status_idx" ON "subscriptions"("organization_id", "provider", "status");

-- CreateIndex
CREATE INDEX "subscriptions_provider_customer_id_idx" ON "subscriptions"("provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_external_subscription_id_key" ON "subscriptions"("provider", "external_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_organization_id_key" ON "entitlements"("organization_id");

-- CreateIndex
CREATE INDEX "entitlements_user_id_idx" ON "entitlements"("user_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_next_retry_at_received_at_idx" ON "webhook_events"("status", "next_retry_at", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_locked_at_idx" ON "webhook_events"("locked_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_external_event_id_key" ON "webhook_events"("provider", "external_event_id");

-- AddForeignKey
ALTER TABLE "provider_customers" ADD CONSTRAINT "provider_customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_customer_id_fkey" FOREIGN KEY ("provider_customer_id") REFERENCES "provider_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_primary_subscription_id_fkey" FOREIGN KEY ("primary_subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
