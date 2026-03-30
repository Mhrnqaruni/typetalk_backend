import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { getConfig } from "../../src/config/env";
import { runWebhookRetryJob } from "../../src/jobs/webhook-retry";
import { BillingRepository } from "../../src/modules/billing/repository";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("google play billing routes", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  const config = getConfig();

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
    harness.googlePlayProvider.subscriptionStates.clear();
    harness.googlePlayProvider.acknowledgedSubscriptions.length = 0;
    harness.googlePlayProvider.acknowledgmentFailures.clear();
    harness.googlePlayProvider.verifiedPurchaseTokens.length = 0;
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

  async function getPlan(code: "pro_monthly" | "pro_yearly") {
    return harness.prisma.plan.findUniqueOrThrow({
      where: {
        code
      }
    });
  }

  it("seeds Google plan identifiers and verifies subscriptions idempotently through the plans table", async () => {
    const session = await signIn("google-verify@example.com");
    const monthlyPlan = await getPlan("pro_monthly");

    expect(monthlyPlan.googleProductId).toBe("typetalk.pro.monthly");
    expect(monthlyPlan.googleBasePlanId).toBe("monthly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_verify_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_verify_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T09:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T09:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: false,
      shouldAcknowledge: true
    });

    const missingKeyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      },
      payload: {
        purchase_token: "gp_token_verify_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(missingKeyResponse.statusCode).toBe(400);
    expect(missingKeyResponse.json().error.code).toBe("missing_idempotency_key");

    const firstResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-verify-1"
      },
      payload: {
        purchase_token: "gp_token_verify_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({
      subscription: {
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "active",
        is_trial: false,
        billing_overlap: false,
        current_period_start: "2026-03-26T09:00:00.000Z",
        current_period_end: "2026-04-26T09:00:00.000Z",
        trial_ends_at: null,
        canceled_at: null,
        entitlement_code: "pro_active"
      },
      purchase: {
        purchase_token: "gp_token_verify_1",
        linked_purchase_token: null,
        product_id: "typetalk.pro.monthly",
        base_plan_id: "monthly",
        acknowledged: true,
        acknowledgment_status: "acknowledged"
      }
    });
    expect(harness.googlePlayProvider.verifiedPurchaseTokens).toEqual(["gp_token_verify_1"]);
    expect(harness.googlePlayProvider.acknowledgedSubscriptions).toEqual([
      {
        productId: "typetalk.pro.monthly",
        purchaseToken: "gp_token_verify_1"
      }
    ]);

    const replayResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-verify-1"
      },
      payload: {
        purchase_token: "gp_token_verify_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toEqual(firstResponse.json());
    expect(harness.googlePlayProvider.verifiedPurchaseTokens).toEqual(["gp_token_verify_1"]);
    expect(harness.googlePlayProvider.acknowledgedSubscriptions).toHaveLength(1);

    const conflictResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-verify-1"
      },
      payload: {
        purchase_token: "gp_token_verify_1",
        product_id: "typetalk.pro.yearly",
        base_plan_id: "yearly"
      }
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json().error.code).toBe("idempotency_key_conflict");

    const providerCustomer = await harness.prisma.providerCustomer.findUniqueOrThrow({
      where: {
        organizationId_provider: {
          organizationId: session.organization_id,
          provider: "GOOGLE_PLAY"
        }
      }
    });
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "GOOGLE_PLAY",
          externalSubscriptionId: "gpsub_verify_1"
        }
      }
    });
    const purchaseToken = await harness.prisma.purchaseToken.findUniqueOrThrow({
      where: {
        purchaseToken: "gp_token_verify_1"
      }
    });

    expect(providerCustomer.externalCustomerId).toBe(`google_play:${session.organization_id}`);
    expect(subscription.planId).toBe(monthlyPlan.id);
    expect(purchaseToken.planId).toBe(monthlyPlan.id);
    expect(purchaseToken.acknowledgmentStatus).toBe("ACKNOWLEDGED");
    expect(purchaseToken.acknowledgedAt).not.toBeNull();
  });

  it("keeps pending Google purchases non-entitling in the unified read APIs", async () => {
    const session = await signIn("google-pending@example.com");
    const monthlyPlan = await getPlan("pro_monthly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_pending_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_pending_1",
      status: "INCOMPLETE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T10:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T10:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: false,
      shouldAcknowledge: false
    });

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-pending-1"
      },
      payload: {
        purchase_token: "gp_token_pending_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      subscription: {
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "incomplete",
        entitlement_code: "free"
      },
      purchase: {
        purchase_token: "gp_token_pending_1",
        acknowledged: false,
        acknowledgment_status: "not_required"
      }
    });
    expect(harness.googlePlayProvider.acknowledgedSubscriptions).toHaveLength(0);

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
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "incomplete",
        is_trial: false,
        billing_overlap: false,
        current_period_start: "2026-03-26T10:00:00.000Z",
        current_period_end: "2026-04-26T10:00:00.000Z",
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
        status: "inactive",
        billing_overlap: false,
        primary_subscription_id: expect.any(String) as string,
        plan_code: "pro_monthly",
        starts_at: "2026-03-26T10:00:00.000Z",
        ends_at: "2026-04-26T10:00:00.000Z",
        source_provider: "google_play"
      }
    });
  });

  it("keeps canceled-but-unexpired Google subscriptions entitled during verify and restore until the period ends", async () => {
    const session = await signIn("google-canceled-active@example.com");
    const monthlyPlan = await getPlan("pro_monthly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_canceled_active_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_canceled_active_1",
      status: "CANCELED",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: new Date("2026-03-26T00:00:00.000Z"),
      acknowledged: true,
      shouldAcknowledge: false
    });

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-canceled-active-verify"
      },
      payload: {
        purchase_token: "gp_token_canceled_active_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toEqual({
      subscription: {
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "canceled",
        is_trial: false,
        billing_overlap: false,
        current_period_start: "2026-03-01T00:00:00.000Z",
        current_period_end: "2026-04-01T00:00:00.000Z",
        trial_ends_at: null,
        canceled_at: "2026-03-26T00:00:00.000Z",
        entitlement_code: "pro_active"
      },
      purchase: {
        purchase_token: "gp_token_canceled_active_1",
        linked_purchase_token: null,
        product_id: "typetalk.pro.monthly",
        base_plan_id: "monthly",
        acknowledged: true,
        acknowledgment_status: "acknowledged"
      }
    });

    const restoreResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/restore",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-canceled-active-restore"
      },
      payload: {
        purchase_token: "gp_token_canceled_active_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toEqual(verifyResponse.json());

    const subscriptionResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const entitlementResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/entitlements/current",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(subscriptionResponse.statusCode).toBe(200);
    expect(subscriptionResponse.json()).toEqual({
      subscription: {
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "canceled",
        is_trial: false,
        billing_overlap: false,
        current_period_start: "2026-03-01T00:00:00.000Z",
        current_period_end: "2026-04-01T00:00:00.000Z",
        trial_ends_at: null,
        canceled_at: "2026-03-26T00:00:00.000Z",
        entitlement_code: "pro_active"
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
        source_provider: "google_play"
      }
    });
  });

  it("restores existing durable state, follows linked purchase tokens, and keeps overlap detection unified", async () => {
    const session = await signIn("google-restore@example.com");
    const monthlyPlan = await getPlan("pro_monthly");
    const yearlyPlan = await getPlan("pro_yearly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_restore_old",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_restore_chain",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T11:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T11:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });

    const firstVerifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-restore-verify-old"
      },
      payload: {
        purchase_token: "gp_token_restore_old",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(firstVerifyResponse.statusCode).toBe(200);

    const restoreResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/restore",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-restore-1"
      },
      payload: {
        purchase_token: "gp_token_restore_old",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(restoreResponse.statusCode).toBe(200);

    const replayRestoreResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/restore",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-restore-1"
      },
      payload: {
        purchase_token: "gp_token_restore_old",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(replayRestoreResponse.statusCode).toBe(200);
    expect(replayRestoreResponse.json()).toEqual(restoreResponse.json());

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_restore_new",
      linkedPurchaseToken: "gp_token_restore_old",
      productId: yearlyPlan.googleProductId!,
      basePlanId: yearlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_restore_chain",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T12:00:00.000Z"),
      currentPeriodEnd: new Date("2027-03-26T12:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });

    const upgradeResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-restore-upgrade"
      },
      payload: {
        purchase_token: "gp_token_restore_new",
        product_id: yearlyPlan.googleProductId,
        base_plan_id: yearlyPlan.googleBasePlanId
      }
    });

    expect(upgradeResponse.statusCode).toBe(200);
    expect(upgradeResponse.json()).toMatchObject({
      subscription: {
        provider: "google_play",
        plan_code: "pro_yearly",
        status: "active"
      },
      purchase: {
        purchase_token: "gp_token_restore_new",
        linked_purchase_token: "gp_token_restore_old",
        product_id: "typetalk.pro.yearly",
        base_plan_id: "yearly",
        acknowledged: true,
        acknowledgment_status: "acknowledged"
      }
    });

    const providerCustomerCount = await harness.prisma.providerCustomer.count({
      where: {
        organizationId: session.organization_id,
        provider: "GOOGLE_PLAY"
      }
    });
    const subscriptionCount = await harness.prisma.subscription.count({
      where: {
        organizationId: session.organization_id,
        provider: "GOOGLE_PLAY"
      }
    });
    const purchaseTokens = await harness.prisma.purchaseToken.findMany({
      where: {
        organizationId: session.organization_id
      },
      orderBy: {
        purchaseToken: "asc"
      }
    });
    const newPurchaseToken = purchaseTokens.find(
      (purchaseToken) => purchaseToken.purchaseToken === "gp_token_restore_new"
    );

    expect(providerCustomerCount).toBe(1);
    expect(subscriptionCount).toBe(1);
    expect(purchaseTokens).toHaveLength(2);
    expect(newPurchaseToken?.linkedPurchaseToken).toBe("gp_token_restore_old");

    await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "STRIPE",
        externalCustomerId: "cus_google_overlap"
      }
    });
    await harness.prisma.subscription.create({
      data: {
        organizationId: session.organization_id,
        planId: yearlyPlan.id,
        providerCustomerId: null,
        provider: "STRIPE",
        externalSubscriptionId: "sub_google_overlap",
        status: "ACTIVE",
        isTrial: false,
        conflictFlag: false,
        currentPeriodStart: new Date("2026-03-26T12:30:00.000Z"),
        currentPeriodEnd: new Date("2027-04-26T12:30:00.000Z")
      }
    });
    await harness.prisma.entitlement.delete({
      where: {
        organizationId: session.organization_id
      }
    });

    const overlapSubscriptionResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });
    const overlapEntitlementResponse = await harness.app.inject({
      method: "GET",
      url: "/v1/entitlements/current",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(overlapSubscriptionResponse.statusCode).toBe(200);
    expect(overlapSubscriptionResponse.json().subscription.billing_overlap).toBe(true);
    expect(overlapSubscriptionResponse.json().subscription.entitlement_code).toBe("pro_active");
    expect(overlapEntitlementResponse.statusCode).toBe(200);
    expect(overlapEntitlementResponse.json().entitlement.billing_overlap).toBe(true);
    expect(overlapEntitlementResponse.json().entitlement.code).toBe("pro_active");
  });

  it("retries failed initial acknowledgments without duplicating entitlements and keeps Google invoices available when Google is active", async () => {
    const session = await signIn("google-ack-retry@example.com");
    const monthlyPlan = await getPlan("pro_monthly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_ack_retry_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_ack_retry_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T13:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T13:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: false,
      shouldAcknowledge: true
    });
    harness.googlePlayProvider.acknowledgmentFailures.set(
      "gp_token_ack_retry_1",
      "temporary ack failure"
    );

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-ack-retry-1"
      },
      payload: {
        purchase_token: "gp_token_ack_retry_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      subscription: {
        provider: "google_play",
        plan_code: "pro_monthly",
        status: "active",
        entitlement_code: "pro_active"
      },
      purchase: {
        purchase_token: "gp_token_ack_retry_1",
        acknowledged: false,
        acknowledgment_status: "failed"
      }
    });

    const failedToken = await harness.prisma.purchaseToken.findUniqueOrThrow({
      where: {
        purchaseToken: "gp_token_ack_retry_1"
      }
    });
    const initialEntitlement = await harness.prisma.entitlement.findUniqueOrThrow({
      where: {
        organizationId: session.organization_id
      }
    });

    expect(failedToken.acknowledgmentStatus).toBe("FAILED");
    expect(failedToken.acknowledgmentAttemptCount).toBe(1);
    expect(failedToken.acknowledgmentNextRetryAt).not.toBeNull();
    expect(initialEntitlement.code).toBe("PRO_ACTIVE");

    await harness.prisma.providerCustomer.create({
      data: {
        organizationId: session.organization_id,
        provider: "STRIPE",
        externalCustomerId: "cus_stale_google_invoice"
      }
    });

    const invoicesBeforeRetry = await harness.app.inject({
      method: "GET",
      url: "/v1/billing/invoices?limit=10",
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    });

    expect(invoicesBeforeRetry.statusCode).toBe(200);
    expect(invoicesBeforeRetry.json()).toEqual({
      items: [
        {
          id: "gp_token_ack_retry_1",
          status: "active",
          currency: "usd",
          amount_due_cents: 999,
          amount_paid_cents: 999,
          hosted_url: null,
          invoice_pdf_url: null,
          period_start: "2026-03-26T13:00:00.000Z",
          period_end: "2026-04-26T13:00:00.000Z",
          created_at: expect.any(String) as string
        }
      ],
      next_cursor: null
    });

    await harness.prisma.purchaseToken.update({
      where: {
        purchaseToken: "gp_token_ack_retry_1"
      },
      data: {
        acknowledgmentNextRetryAt: new Date(Date.now() - 60_000)
      }
    });
    harness.googlePlayProvider.acknowledgmentFailures.delete("gp_token_ack_retry_1");

    const retryResult = await runWebhookRetryJob(harness.prisma, {
      paddleProvider: harness.paddleProvider,
      stripeProvider: harness.stripeProvider,
      googlePlayProvider: harness.googlePlayProvider
    });
    const acknowledgedToken = await harness.prisma.purchaseToken.findUniqueOrThrow({
      where: {
        purchaseToken: "gp_token_ack_retry_1"
      }
    });
    const subscriptionCount = await harness.prisma.subscription.count({
      where: {
        organizationId: session.organization_id,
        provider: "GOOGLE_PLAY"
      }
    });
    const entitlementCount = await harness.prisma.entitlement.count({
      where: {
        organizationId: session.organization_id
      }
    });

    expect(retryResult.processed).toBe(1);
    expect(acknowledgedToken.acknowledgmentStatus).toBe("ACKNOWLEDGED");
    expect(acknowledgedToken.acknowledgedAt).not.toBeNull();
    expect(subscriptionCount).toBe(1);
    expect(entitlementCount).toBe(1);
  });

  it("reclaims claimed acknowledgment retries after the reclaim window instead of stranding them", async () => {
    const session = await signIn("google-ack-reclaim@example.com");
    const monthlyPlan = await getPlan("pro_monthly");

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_ack_reclaim_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_ack_reclaim_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T14:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T14:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: false,
      shouldAcknowledge: true
    });
    harness.googlePlayProvider.acknowledgmentFailures.set(
      "gp_token_ack_reclaim_1",
      "temporary ack failure"
    );

    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "idempotency-key": "google-ack-reclaim-verify"
      },
      payload: {
        purchase_token: "gp_token_ack_reclaim_1",
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(verifyResponse.statusCode).toBe(200);

    await harness.prisma.purchaseToken.update({
      where: {
        purchaseToken: "gp_token_ack_reclaim_1"
      },
      data: {
        acknowledgmentNextRetryAt: new Date(Date.now() - 60_000)
      }
    });

    const billingRepository = new BillingRepository(harness.prisma);
    const claimed = await billingRepository.claimPurchaseTokenAcknowledgmentRetry(
      "gp_token_ack_reclaim_1",
      new Date(),
      new Date(Date.now() + 10 * 60 * 1000)
    );
    const claimedRow = await harness.prisma.purchaseToken.findUniqueOrThrow({
      where: {
        purchaseToken: "gp_token_ack_reclaim_1"
      }
    });

    expect(claimed?.purchaseToken).toBe("gp_token_ack_reclaim_1");
    expect(claimedRow.acknowledgmentStatus).toBe("PENDING");
    expect(claimedRow.acknowledgmentNextRetryAt).not.toBeNull();

    harness.googlePlayProvider.acknowledgmentFailures.delete("gp_token_ack_reclaim_1");
    await harness.prisma.purchaseToken.update({
      where: {
        purchaseToken: "gp_token_ack_reclaim_1"
      },
      data: {
        acknowledgmentNextRetryAt: new Date(Date.now() - 60_000)
      }
    });

    const retryResult = await runWebhookRetryJob(harness.prisma, {
      paddleProvider: harness.paddleProvider,
      stripeProvider: harness.stripeProvider,
      googlePlayProvider: harness.googlePlayProvider
    });
    const recoveredToken = await harness.prisma.purchaseToken.findUniqueOrThrow({
      where: {
        purchaseToken: "gp_token_ack_reclaim_1"
      }
    });

    expect(retryResult.processed).toBe(1);
    expect(recoveredToken.acknowledgmentStatus).toBe("ACKNOWLEDGED");
    expect(recoveredToken.acknowledgmentNextRetryAt).toBeNull();
    expect(recoveredToken.acknowledgedAt).not.toBeNull();
  });
});
