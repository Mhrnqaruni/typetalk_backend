-- DropIndex
DROP INDEX "users_primary_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_primary_email_active_key"
ON "users"("primary_email")
WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "users_primary_email_deleted_at_idx" ON "users"("primary_email", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_challenges_email_purpose_active_key"
ON "email_challenges"("email", "purpose")
WHERE "used_at" IS NULL AND "superseded_at" IS NULL;
