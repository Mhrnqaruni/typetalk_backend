import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { EntitlementService } from "../../src/modules/entitlements/service";
import type { BillingProviderClients } from "../../src/modules/billing/provider";
import { BillingRepository } from "../../src/modules/billing/repository";
import { BillingService } from "../../src/modules/billing/service";

function createBillingServiceWithPlans() {
  const billingRepository = {
    listActivePlans: vi.fn().mockResolvedValue([
      {
        id: "plan_free",
        code: "free",
        displayName: "Free",
        amountCents: 0,
        currency: "usd",
        billingInterval: "NONE",
        weeklyWordLimit: 10_000,
        trialDays: 0,
        paddlePriceId: null,
        stripePriceId: null,
        googleProductId: null,
        googleBasePlanId: null,
        isActive: true
      },
      {
        id: "plan_pro_monthly",
        code: "pro_monthly",
        displayName: "Pro Monthly",
        amountCents: 999,
        currency: "usd",
        billingInterval: "MONTHLY",
        weeklyWordLimit: 1_000_000,
        trialDays: 30,
        paddlePriceId: "pri_paddle_monthly_test",
        stripePriceId: "price_typetalk_pro_monthly_test",
        googleProductId: "typetalk.pro.monthly",
        googleBasePlanId: "monthly",
        isActive: true
      }
    ])
  } as unknown as BillingRepository;

  const providers = {
    paddle: {} as BillingProviderClients["paddle"],
    googlePlay: {} as BillingProviderClients["googlePlay"],
    stripe: null
  } satisfies BillingProviderClients;

  return {
    service: new BillingService(
      {} as PrismaClient,
      billingRepository,
      {} as EntitlementService,
      providers
    ),
    listActivePlansMock: billingRepository.listActivePlans as unknown as ReturnType<typeof vi.fn>
  };
}

describe("billing plans public contract", () => {
  it("returns only the display-safe public fields", async () => {
    const { service, listActivePlansMock } = createBillingServiceWithPlans();

    const result = await service.listPlans();

    expect(listActivePlansMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [
        {
          code: "free",
          display_name: "Free",
          amount_cents: 0,
          currency: "usd",
          billing_interval: "none",
          weekly_word_limit: 10_000,
          trial_days: 0,
          is_active: true
        },
        {
          code: "pro_monthly",
          display_name: "Pro Monthly",
          amount_cents: 999,
          currency: "usd",
          billing_interval: "monthly",
          weekly_word_limit: 1_000_000,
          trial_days: 30,
          is_active: true
        }
      ]
    });

    expect(Object.keys(result.items[1] ?? {}).sort()).toEqual([
      "amount_cents",
      "billing_interval",
      "code",
      "currency",
      "display_name",
      "is_active",
      "trial_days",
      "weekly_word_limit"
    ]);

    expect(result.items[1]).not.toHaveProperty("id");
    expect(result.items[1]).not.toHaveProperty("paddle_price_id");
    expect(result.items[1]).not.toHaveProperty("stripe_price_id");
    expect(result.items[1]).not.toHaveProperty("google_product_id");
    expect(result.items[1]).not.toHaveProperty("google_base_plan_id");
  });
});
