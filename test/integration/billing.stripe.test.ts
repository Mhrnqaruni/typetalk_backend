import type { SubscriptionStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("stripe billing routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await seedPlans(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    harness.authRateLimiter.reset();
    harness.stripeProvider.createdCustomers.length = 0;
    harness.stripeProvider.checkoutSessions.length = 0;
    harness.stripeProvider.portalSessions.length = 0;
    harness.stripeProvider.invoicePages.clear();
    harness.stripeProvider.webhookEvents.clear();
  });

  afterAll(async () => {
    await harness.app.close();
    await harness.prisma.$disconnect();
  });

  async function signIn(email: string) {
    await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/request-code",
      payload: { email }
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/email/verify-code",
      payload: {
        email,
        code: harness.emailProvider.latestCodeFor(email)
      }
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("returns billing plans from the seeded database rows", async () => {
    const initialResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/plans"
    });

    expect(initialResponse.statusCode).toBe(200);
    expect(initialResponse.json().items.map((item: { code: string }) => item.code)).toEqual([
      "free",
      "pro_monthly",
      "pro_yearly"
    ]);

    await harness.prisma.plan.update({
      where: {
        code: "free"
      },
      data: {
        displayName: "Free Updated"
      }
    });

    const updatedResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/plans"
    });

    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json().items[0].display_name).toBe("Free Updated");
  });

  it("returns the free default for subscription and entitlement reads before any billing exists", async () => {
    const session = await signIn("billing-defaults@example.com");

    const subscriptionResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(subscriptionResponse.statusCode).toBe(200);
    expect(subscriptionResponse.json()).toEqual({
      subscription: {
        provider: null,
        plan_code: "free",
        status: "free",
        is_trial: false,
        billing_overlap: false,
        current_period_start: null,
        current_period_end: null,
        trial_ends_at: null,
        canceled_at: null,
        entitlement_code: "free"
      }
    });

    const entitlementResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/entitlements/current",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(entitlementResponse.statusCode).toBe(200);
    expect(entitlementResponse.json()).toEqual({
      entitlement: {
        code: "free",
        status: "active",
        billing_overlap: false,
        primary_subscription_id: null,
        plan_code: "free",
        starts_at: null,
        ends_at: null,
        source_provider: null
      }
    });
  });

  it("surfaces billing overlap when multiple active paid subscriptions exist for one organization", async () => {
    const session = await signIn("billing-overlap@example.com");
    const monthlyPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });
    const yearlyPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_yearly"
      }
    });
    const providerCustomer = await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "STRIPE",
        externalCustomerId: "cus_overlap"
      }
    });

    await harness.prisma.subscription.createMany({
      data: [
        {
          organizationId: session.organization_id,
          planId: monthlyPlan.id,
          providerCustomerId: providerCustomer.id,
          provider: "STRIPE",
          externalSubscriptionId: "sub_overlap_monthly",
          status: "ACTIVE",
          isTrial: false,
          conflictFlag: false,
          currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
        },
        {
          organizationId: session.organization_id,
          planId: yearlyPlan.id,
          providerCustomerId: providerCustomer.id,
          provider: "STRIPE",
          externalSubscriptionId: "sub_overlap_yearly",
          status: "ACTIVE",
          isTrial: false,
          conflictFlag: false,
          currentPeriodStart: new Date("2026-03-15T00:00:00.000Z"),
          currentPeriodEnd: new Date("2027-03-15T00:00:00.000Z")
        }
      ]
    });

    const subscriptionResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(subscriptionResponse.statusCode).toBe(200);
    expect(subscriptionResponse.json().subscription.plan_code).toBe("pro_yearly");
    expect(subscriptionResponse.json().subscription.status).toBe("active");
    expect(subscriptionResponse.json().subscription.billing_overlap).toBe(true);

    const entitlementResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/entitlements/current",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(entitlementResponse.statusCode).toBe(200);
    expect(entitlementResponse.json().entitlement.code).toBe("pro_active");
    expect(entitlementResponse.json().entitlement.billing_overlap).toBe(true);

    const conflictingSubscriptions = await harness.prisma.subscription.findMany({
      where: {
        organizationId: session.organization_id,
        conflictFlag: true
      }
    });

    expect(conflictingSubscriptions).toHaveLength(2);
  });

  it.each([
    {
      overlapStatus: "PAYMENT_ISSUE" as SubscriptionStatus,
      label: "payment issue"
    },
    {
      overlapStatus: "GRACE" as SubscriptionStatus,
      label: "grace"
    },
    {
      overlapStatus: "TRIALING" as SubscriptionStatus,
      label: "trialing"
    }
  ])(
    "preserves paid access when an ACTIVE subscription overlaps with $label",
    async ({ overlapStatus }) => {
      const session = await signIn(`billing-mixed-${overlapStatus.toLowerCase()}@example.com`);
      const monthlyPlan = await harness.prisma.plan.findUniqueOrThrow({
        where: {
          code: "pro_monthly"
        }
      });
      const yearlyPlan = await harness.prisma.plan.findUniqueOrThrow({
        where: {
          code: "pro_yearly"
        }
      });
      const providerCustomer = await harness.prisma.providerCustomer.create({
        data: {
          organizationId: session.organization_id,
          provider: "STRIPE",
          externalCustomerId: `cus_mixed_${overlapStatus.toLowerCase()}`
        }
      });

      await harness.prisma.subscription.create({
        data: {
          organizationId: session.organization_id,
          planId: monthlyPlan.id,
          providerCustomerId: providerCustomer.id,
          provider: "STRIPE",
          externalSubscriptionId: `sub_active_${overlapStatus.toLowerCase()}`,
          status: "ACTIVE",
          isTrial: false,
          conflictFlag: false,
          currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
        }
      });

      await harness.prisma.subscription.create({
        data: {
          organizationId: session.organization_id,
          planId: yearlyPlan.id,
          providerCustomerId: providerCustomer.id,
          provider: "STRIPE",
          externalSubscriptionId: `sub_overlap_${overlapStatus.toLowerCase()}`,
          status: overlapStatus,
          isTrial: overlapStatus === "TRIALING",
          conflictFlag: false,
          trialEndsAt: overlapStatus === "TRIALING"
            ? new Date("2026-04-15T00:00:00.000Z")
            : null,
          currentPeriodStart: new Date("2026-03-15T00:00:00.000Z"),
          currentPeriodEnd: new Date("2027-03-15T00:00:00.000Z")
        }
      });

      const subscriptionResponse = await harness.app.inject({
        method: "GET",
        url: "/v1/billing/subscription",
        headers: {
          authorization: `Bearer ${session.access_token}`
        }
      });

      expect(subscriptionResponse.statusCode).toBe(200);
      expect(subscriptionResponse.json()).toMatchObject({
        subscription: {
          plan_code: "pro_monthly",
          status: "active",
          billing_overlap: true,
          entitlement_code: "pro_active"
        }
      });

      const entitlementResponse = await harness.app.inject({
        method: "GET",
        url: "/v1/entitlements/current",
        headers: {
          authorization: `Bearer ${session.access_token}`
        }
      });

      expect(entitlementResponse.statusCode).toBe(200);
      expect(entitlementResponse.json()).toMatchObject({
        entitlement: {
          code: "pro_active",
          status: "active",
          billing_overlap: true,
          plan_code: "pro_monthly"
        }
      });
    }
  );

  it("recomputes entitlement state when /v1/entitlements/current is called before any entitlement row exists", async () => {
    const session = await signIn("billing-entitlements-first@example.com");
    const monthlyPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });
    const providerCustomer = await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "STRIPE",
        externalCustomerId: "cus_entitlements_first"
      }
    });

    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: monthlyPlan.id,
        providerCustomerId: providerCustomer.id,
        provider: "STRIPE",
        externalSubscriptionId: "sub_entitlements_first",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
      }
    });

    const entitlementResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/entitlements/current",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(entitlementResponse.statusCode).toBe(200);
    expect(entitlementResponse.json()).toEqual({
      entitlement: {
        code: "pro_active",
        status: "active",
        billing_overlap: false,
        primary_subscription_id: expect.any(String) as string,
        plan_code: "pro_monthly",
        starts_at: "2026-03-01T00:00:00.000Z",
        ends_at: "2026-04-01T00:00:00.000Z",
        source_provider: "stripe"
      }
    });

    const storedEntitlement = await harness.prisma.entitlement.findUnique({
      where: {
        organizationId: session.organization_id
      }
    });

    expect(storedEntitlement).not.toBeNull();
    expect(storedEntitlement?.code).toBe("PRO_ACTIVE");

    const subscriptionResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(subscriptionResponse.statusCode).toBe(200);
    expect(subscriptionResponse.json()).toMatchObject({
      subscription: {
        plan_code: "pro_monthly",
        status: "active",
        billing_overlap: false,
        entitlement_code: "pro_active"
      }
    });
  });

  it("creates checkout sessions idempotently, preserves the 30-day trial, and blocks duplicate paid checkout", async () => {
    const session = await signIn("billing-checkout@example.com");

    const missingKeyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/checkout-session",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(missingKeyResponse.statusCode).toBe(400);
    expect(missingKeyResponse.json().error.code).toBe("missing_idempotency_key");

    const firstResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/checkout-session",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "checkout-key-1"
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().checkout_session.trial_days).toBe(30);
    expect(harness.stripeProvider.createdCustomers).toHaveLength(1);
    expect(harness.stripeProvider.checkoutSessions).toHaveLength(1);

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/checkout-session",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "checkout-key-1"
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toEqual(firstResponse.json());
    expect(harness.stripeProvider.checkoutSessions).toHaveLength(1);

    const conflictResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/checkout-session",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "checkout-key-1"
      },
      payload: {
        plan_code: "pro_yearly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json().error.code).toBe("idempotency_key_conflict");

    const monthlyPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });
    const providerCustomer = await harness.prisma.providerCustomer.findUniqueOrThrow({
      where: {
        organizationId_provider: {
          organizationId: session.organization_id,
          provider: "STRIPE"
        }
      }
    });

    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: monthlyPlan.id,
        providerCustomerId: providerCustomer.id,
        provider: "STRIPE",
        externalSubscriptionId: "sub_active_existing",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
      }
    });

    const duplicatePaidResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/checkout-session",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "checkout-key-2"
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(duplicatePaidResponse.statusCode).toBe(409);
    expect(duplicatePaidResponse.json().error.code).toBe("active_paid_entitlement_exists");
  });

  it("creates portal sessions and paginates invoices for the current organization", async () => {
    const session = await signIn("billing-portal@example.com");

    const missingCustomerResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/customer-portal",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        return_url: "https://app.typetalk.test/account"
      }
    });

    expect(missingCustomerResponse.statusCode).toBe(404);
    expect(missingCustomerResponse.json().error.code).toBe("billing_customer_not_found");

    await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "STRIPE",
        externalCustomerId: "cus_portal"
      }
    });

    harness.stripeProvider.setInvoicePage({
      customerId: "cus_portal",
      limit: 1
    }, {
      items: [
        {
          id: "in_1",
          status: "paid",
          currency: "usd",
          amountDueCents: 999,
          amountPaidCents: 999,
          hostedUrl: "https://stripe.test/invoice/1",
          invoicePdfUrl: null,
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          createdAt: new Date("2026-03-01T00:00:00.000Z")
        }
      ],
      nextCursor: "in_1"
    });
    harness.stripeProvider.setInvoicePage({
      customerId: "cus_portal",
      limit: 1,
      startingAfter: "in_1"
    }, {
      items: [
        {
          id: "in_2",
          status: "paid",
          currency: "usd",
          amountDueCents: 999,
          amountPaidCents: 999,
          hostedUrl: "https://stripe.test/invoice/2",
          invoicePdfUrl: null,
          periodStart: new Date("2026-04-01T00:00:00.000Z"),
          periodEnd: new Date("2026-05-01T00:00:00.000Z"),
          createdAt: new Date("2026-04-01T00:00:00.000Z")
        }
      ],
      nextCursor: null
    });

    const portalResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/stripe/customer-portal",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        return_url: "https://app.typetalk.test/account"
      }
    });

    expect(portalResponse.statusCode).toBe(200);
    expect(portalResponse.json().portal_session.url).toContain("https://stripe.test/portal/");

    const firstPage = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/invoices?limit=1",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(1);
    expect(firstPage.json().items[0].id).toBe("in_1");
    expect(firstPage.json().next_cursor).toBeTruthy();

    const secondPage = await harness.app.inject({
      method: "GET",
      url: `/v1/billing/invoices?limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().items).toHaveLength(1);
    expect(secondPage.json().items[0].id).toBe("in_2");
    expect(secondPage.json().next_cursor).toBeNull();
  });
});
