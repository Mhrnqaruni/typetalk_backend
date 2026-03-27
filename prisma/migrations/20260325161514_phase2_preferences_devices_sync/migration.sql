-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "default_language" TEXT NOT NULL DEFAULT 'auto',
    "auto_punctuation" BOOLEAN NOT NULL DEFAULT true,
    "remove_fillers" BOOLEAN NOT NULL DEFAULT false,
    "auto_format" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "dictionary_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "rules_json" JSONB NOT NULL,

    CONSTRAINT "writing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "app_key" TEXT NOT NULL,
    "writing_profile_id" TEXT,
    "settings_json" JSONB NOT NULL,

    CONSTRAINT "app_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("scope","idempotency_key")
);

-- CreateIndex
CREATE INDEX "dictionary_entries_user_id_organization_id_created_at_id_idx" ON "dictionary_entries"("user_id", "organization_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "writing_profiles_user_id_organization_id_id_idx" ON "writing_profiles"("user_id", "organization_id", "id");

-- CreateIndex
CREATE INDEX "app_profiles_user_id_organization_id_app_key_id_idx" ON "app_profiles"("user_id", "organization_id", "app_key", "id");

-- CreateIndex
CREATE UNIQUE INDEX "app_profiles_user_id_organization_id_app_key_key" ON "app_profiles"("user_id", "organization_id", "app_key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_profiles" ADD CONSTRAINT "writing_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_profiles" ADD CONSTRAINT "writing_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_profiles" ADD CONSTRAINT "app_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_profiles" ADD CONSTRAINT "app_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_profiles" ADD CONSTRAINT "app_profiles_writing_profile_id_fkey" FOREIGN KEY ("writing_profile_id") REFERENCES "writing_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
