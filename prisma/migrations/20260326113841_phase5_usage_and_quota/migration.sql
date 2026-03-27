-- CreateEnum
CREATE TYPE "RealtimeSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UsageEventStatus" AS ENUM ('FINALIZED', 'TELEMETRY');

-- CreateTable
CREATE TABLE "realtime_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "feature_code" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_session_ref" TEXT,
    "status" "RealtimeSessionStatus" NOT NULL DEFAULT 'OPEN',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "final_word_count" INTEGER,
    "audio_seconds" INTEGER,
    "request_count" INTEGER,
    "trusted_result_source" TEXT,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realtime_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_windows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature_code" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "word_limit" INTEGER NOT NULL,
    "used_words" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "realtime_session_id" TEXT,
    "idempotency_key" TEXT,
    "feature_code" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "audio_seconds" INTEGER NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "status" "UsageEventStatus" NOT NULL,
    "metadata_json" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_rollups_weekly" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "total_words" INTEGER NOT NULL DEFAULT 0,
    "total_audio_seconds" INTEGER NOT NULL DEFAULT 0,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_rollups_weekly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "realtime_sessions_organization_id_user_id_started_at_idx" ON "realtime_sessions"("organization_id", "user_id", "started_at");

-- CreateIndex
CREATE INDEX "realtime_sessions_device_id_idx" ON "realtime_sessions"("device_id");

-- CreateIndex
CREATE INDEX "realtime_sessions_provider_provider_session_ref_idx" ON "realtime_sessions"("provider", "provider_session_ref");

-- CreateIndex
CREATE INDEX "realtime_sessions_status_started_at_idx" ON "realtime_sessions"("status", "started_at");

-- CreateIndex
CREATE INDEX "quota_windows_organization_id_user_id_feature_code_updated__idx" ON "quota_windows"("organization_id", "user_id", "feature_code", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "quota_windows_organization_id_user_id_feature_code_window_s_key" ON "quota_windows"("organization_id", "user_id", "feature_code", "window_start");

-- CreateIndex
CREATE INDEX "usage_events_organization_id_user_id_occurred_at_idx" ON "usage_events"("organization_id", "user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_events_realtime_session_id_idx" ON "usage_events"("realtime_session_id");

-- CreateIndex
CREATE INDEX "usage_events_device_id_idx" ON "usage_events"("device_id");

-- CreateIndex
CREATE INDEX "usage_events_status_occurred_at_idx" ON "usage_events"("status", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_rollups_weekly_organization_id_user_id_week_start_idx" ON "usage_rollups_weekly"("organization_id", "user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "usage_rollups_weekly_organization_id_user_id_week_start_key" ON "usage_rollups_weekly"("organization_id", "user_id", "week_start");

-- AddForeignKey
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_windows" ADD CONSTRAINT "quota_windows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_windows" ADD CONSTRAINT "quota_windows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_realtime_session_id_fkey" FOREIGN KEY ("realtime_session_id") REFERENCES "realtime_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_rollups_weekly" ADD CONSTRAINT "usage_rollups_weekly_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_rollups_weekly" ADD CONSTRAINT "usage_rollups_weekly_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
