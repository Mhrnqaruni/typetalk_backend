import { PrismaClient } from "@prisma/client";

import { getConfig } from "../config/env";
import { LiveGooglePlayProvider } from "../modules/billing/google-play";
import { BillingRepository } from "../modules/billing/repository";
import type { GooglePlayProvider, StripeProvider } from "../modules/billing/provider";
import { BillingService } from "../modules/billing/service";
import { LiveStripeProvider } from "../modules/billing/stripe";
import { EntitlementRepository } from "../modules/entitlements/repository";
import { EntitlementService } from "../modules/entitlements/service";

export async function runWebhookRetryJob(
  prisma?: PrismaClient,
  options?: {
    stripeProvider?: StripeProvider;
    googlePlayProvider?: GooglePlayProvider;
  }
) {
  const config = getConfig();
  const client = prisma ?? new PrismaClient();
  const billingRepository = new BillingRepository(client);
  const entitlementRepository = new EntitlementRepository(client);
  const entitlementService = new EntitlementService(billingRepository, entitlementRepository);
  const billingService = new BillingService(
    client,
    billingRepository,
    entitlementService,
    options?.stripeProvider ?? new LiveStripeProvider(config.stripeSecretKey, config.stripeWebhookSecret),
    options?.googlePlayProvider ?? new LiveGooglePlayProvider(
      config.playPackageName,
      config.playServiceAccountJson,
      config.playPubsubAudience,
      config.playPubsubServiceAccount
    )
  );

  try {
    return await billingService.retryWebhookEvents();
  } finally {
    if (!prisma) {
      await client.$disconnect();
    }
  }
}

async function main(): Promise<void> {
  const result = await runWebhookRetryJob();
  console.log(JSON.stringify(result, null, 2));
}

if (!process.env.VITEST && require.main === module) {
  void main().catch((error) => {
    console.error("Webhook retry job failed.", error);
    process.exit(1);
  });
}
