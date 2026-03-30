import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("paddle billing routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await seedPlans(harness.prisma);
    harness.emailProvider.sentOtps.length = 0;
    await harness.authRateLimiter.reset();
    harness.paddleProvider.createdCustomers.length = 0;
    harness.paddleProvider.checkoutSessions.length = 0;
    harness.paddleProvider.portalSessions.length = 0;
    harness.paddleProvider.invoicePages.clear();
    harness.paddleProvider.webhookEvents.clear();
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

  it("creates Paddle checkout sessions idempotently, preserves the 30-day trial, and blocks duplicate paid checkout", async () => {
    const session = await signIn("billing-paddle-checkout@example.com");

    const missingKeyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/paddle/checkout",
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
      url: "/v1/billing/paddle/checkout",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "paddle-checkout-key-1"
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().checkout_session).toMatchObject({
      provider: "paddle",
      trial_days: 30,
      plan_code: "pro_monthly"
    });
    expect(harness.paddleProvider.createdCustomers).toHaveLength(1);
    expect(harness.paddleProvider.checkoutSessions).toHaveLength(1);
    expect(harness.paddleProvider.checkoutSessions[0]?.priceId).toBe("pri_paddle_monthly_test");

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/paddle/checkout",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "paddle-checkout-key-1"
      },
      payload: {
        plan_code: "pro_monthly",
        success_url: "https://app.typetalk.test/success",
        cancel_url: "https://app.typetalk.test/cancel"
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toEqual(firstResponse.json());
    expect(harness.paddleProvider.checkoutSessions).toHaveLength(1);

    const conflictResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/paddle/checkout",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "paddle-checkout-key-1"
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
          provider: "PADDLE"
        }
      }
    });

    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: monthlyPlan.id,
        providerCustomerId: providerCustomer.id,
        provider: "PADDLE",
        externalSubscriptionId: "sub_paddle_active_existing",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
      }
    });

    const duplicatePaidResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/paddle/checkout",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "paddle-checkout-key-2"
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

  it("creates Paddle customer-portal sessions without requiring return_url and paginates Paddle-backed invoices", async () => {
    const session = await signIn("billing-paddle-portal@example.com");

    const missingCustomerResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/paddle/customer-portal",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {}
    });

    expect(missingCustomerResponse.statusCode).toBe(404);
    expect(missingCustomerResponse.json().error.code).toBe("billing_customer_not_found");

    const monthlyPlan = await harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });
    const providerCustomer = await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "PADDLE",
        externalCustomerId: "ctm_portal"
      }
    });
    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: monthlyPlan.id,
        providerCustomerId: providerCustomer.id,
        provider: "PADDLE",
        externalSubscriptionId: "sub_portal",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z")
      }
    });

    harness.paddleProvider.setInvoicePage({
      customerId: "ctm_portal",
      limit: 1
    }, {
      items: [
        {
          id: "txn_1",
          status: "completed",
          currency: "usd",
          amountDueCents: 999,
          amountPaidCents: 999,
          hostedUrl: "https://paddle.test/receipt/1",
          invoicePdfUrl: null,
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          createdAt: new Date("2026-03-01T00:00:00.000Z")
        }
      ],
      nextCursor: "txn_1"
    });
    harness.paddleProvider.setInvoicePage({
      customerId: "ctm_portal",
      limit: 1,
      startingAfter: "txn_1"
    }, {
      items: [
        {
          id: "txn_2",
          status: "completed",
          currency: "usd",
          amountDueCents: 999,
          amountPaidCents: 999,
          hostedUrl: "https://paddle.test/receipt/2",
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
      url: "/v1/billing/paddle/customer-portal",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {}
    });

    expect(portalResponse.statusCode).toBe(200);
    expect(portalResponse.json().portal_session.url).toContain("https://paddle.test/portal/");
    expect(harness.paddleProvider.portalSessions[0]).toEqual({
      customerId: "ctm_portal",
      subscriptionIds: ["sub_portal"]
    });

    await harness.prisma.entitlement.create({
      data: {
        organizationId: session.organization_id,
        userId: session.user.id,
        code: "PRO_ACTIVE",
        status: "ACTIVE",
        billingOverlap: false,
        primarySubscriptionId: (await harness.prisma.subscription.findUniqueOrThrow({
          where: {
            provider_externalSubscriptionId: {
              provider: "PADDLE",
              externalSubscriptionId: "sub_portal"
            }
          }
        })).id,
        startsAt: new Date("2026-03-01T00:00:00.000Z"),
        endsAt: new Date("2026-04-01T00:00:00.000Z"),
        sourceProvider: "PADDLE"
      }
    });

    const firstPage = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/invoices?limit=1",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items[0].id).toBe("txn_1");
    expect(firstPage.json().next_cursor).toBeTruthy();

    const secondPage = await harness.app.inject({
      method: "GET",
      url: `/v1/billing/invoices?limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().items[0].id).toBe("txn_2");
    expect(secondPage.json().next_cursor).toBeNull();
  });
});
