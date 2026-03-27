import type { PrismaClient } from "@prisma/client";

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "usage_rollups_weekly",
      "usage_events",
      "quota_windows",
      "realtime_sessions",
      "webhook_events",
      "entitlements",
      "purchase_tokens",
      "subscriptions",
      "provider_customers",
      "idempotency_keys",
      "app_profiles",
      "writing_profiles",
      "dictionary_entries",
      "user_preferences",
      "security_events",
      "sessions",
      "devices",
      "auth_identities",
      "email_challenges",
      "organization_members",
      "organizations",
      "users"
    CASCADE;
  `);
}
