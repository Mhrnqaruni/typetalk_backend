import { BillingInterval, PrismaClient } from "@prisma/client";

import { getConfig } from "../src/config/env";

const FREE_WEEKLY_WORD_LIMIT = 10_000;
const PRO_WEEKLY_WORD_LIMIT = 1_000_000;
const GOOGLE_PRODUCT_ID_PRO_MONTHLY = "typetalk.pro.monthly";
const GOOGLE_BASE_PLAN_ID_PRO_MONTHLY = "monthly";
const GOOGLE_PRODUCT_ID_PRO_YEARLY = "typetalk.pro.yearly";
const GOOGLE_BASE_PLAN_ID_PRO_YEARLY = "yearly";

export function buildSeedPlans(config = getConfig()) {
  return [
    {
      code: "free",
      displayName: "Free",
      amountCents: 0,
      currency: "usd",
      billingInterval: BillingInterval.NONE,
      weeklyWordLimit: FREE_WEEKLY_WORD_LIMIT,
      trialDays: 0,
      stripePriceId: null,
      googleProductId: null,
      googleBasePlanId: null,
      isActive: true
    },
    {
      code: "pro_monthly",
      displayName: "Pro Monthly",
      amountCents: 999,
      currency: "usd",
      billingInterval: BillingInterval.MONTHLY,
      weeklyWordLimit: PRO_WEEKLY_WORD_LIMIT,
      trialDays: 30,
      stripePriceId: config.stripePriceIdProMonthly,
      googleProductId: GOOGLE_PRODUCT_ID_PRO_MONTHLY,
      googleBasePlanId: GOOGLE_BASE_PLAN_ID_PRO_MONTHLY,
      isActive: true
    },
    {
      code: "pro_yearly",
      displayName: "Pro Yearly",
      amountCents: 9_999,
      currency: "usd",
      billingInterval: BillingInterval.YEARLY,
      weeklyWordLimit: PRO_WEEKLY_WORD_LIMIT,
      trialDays: 30,
      stripePriceId: config.stripePriceIdProYearly,
      googleProductId: GOOGLE_PRODUCT_ID_PRO_YEARLY,
      googleBasePlanId: GOOGLE_BASE_PLAN_ID_PRO_YEARLY,
      isActive: true
    }
  ] as const;
}

export async function seedPlans(prisma: PrismaClient, config = getConfig()): Promise<void> {
  const plans = buildSeedPlans(config);

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: {
        code: plan.code
      },
      create: plan,
      update: plan
    });
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    await seedPlans(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error("Failed to seed plans.", error);
    process.exit(1);
  });
}
