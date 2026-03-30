import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { getConfig } from "../../src/config/env";
import { runWebhookRetryJob } from "../../src/jobs/webhook-retry";
import type { StripeWebhookEvent } from "../../src/modules/billing/provider";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("stripe webhook processing", () => {
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

  function buildSubscriptionEvent(input: {
    id: string;
    organizationId: string;
    customerId: string;
    subscriptionId: string;
    priceId: string;
    status: string;
    trialEndsAt?: Date | null;
  }): StripeWebhookEvent {
    return {
      id: input.id,
      type: "customer.subscription.created",
      createdAt: new Date("2026-03-26T04:00:00.000Z"),
      livemode: false,
      payload: {
        objectType: "subscription",
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        checkoutSessionId: null,
        invoiceId: null,
        priceId: input.priceId,
        status: input.status,
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-03-26T04:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-26T04:00:00.000Z"),
        trialEndsAt: input.trialEndsAt ?? null,
        canceledAt: null,
        billingReason: null,
        organizationId: input.organizationId,
        planCode: null
      }
    };
  }

  function serializeWebhookEvent(event: StripeWebhookEvent) {
    return {
      provider: "stripe",
      external_event_id: event.id,
      type: event.type,
      created_at: event.createdAt.toISOString(),
      livemode: event.livemode,
      payload: {
        object_type: event.payload.objectType,
        customer_id: event.payload.customerId,
        subscription_id: event.payload.subscriptionId,
        checkout_session_id: event.payload.checkoutSessionId,
        invoice_id: event.payload.invoiceId,
        price_id: event.payload.priceId,
        status: event.payload.status,
        cancel_at_period_end: event.payload.cancelAtPeriodEnd,
        current_period_start: event.payload.currentPeriodStart?.toISOString() ?? null,
        current_period_end: event.payload.currentPeriodEnd?.toISOString() ?? null,
        trial_ends_at: event.payload.trialEndsAt?.toISOString() ?? null,
        canceled_at: event.payload.canceledAt?.toISOString() ?? null,
        billing_reason: event.payload.billingReason,
        organization_id: event.payload.organizationId,
        plan_code: event.payload.planCode
      }
    };
  }

  it("verifies raw webhook signatures, persists a minimal snapshot, and updates billing state", async () => {
    const session = await signIn("billing-webhook@example.com");
    const event = buildSubscriptionEvent({
      id: "evt_subscription_created_1",
      organizationId: session.organization_id,
      customerId: "cus_webhook_1",
      subscriptionId: "sub_webhook_1",
      priceId: config.stripePriceIdProMonthly!,
      status: "active"
    });

    harness.stripeProvider.setWebhookEvent(event);

    const invalidSignatureResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "evt_missing"
      },
      payload: JSON.stringify({
        id: event.id
      })
    });

    expect(invalidSignatureResponse.statusCode).toBe(400);
    expect(invalidSignatureResponse.json().error.code).toBe("invalid_webhook_signature");

    const validResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": event.id
      },
      payload: JSON.stringify({
        id: event.id
      })
    });

    expect(validResponse.statusCode).toBe(200);
    expect(validResponse.json().status).toBe("processed");

    const storedEvent = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "STRIPE",
          externalEventId: event.id
        }
      }
    });
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "STRIPE",
          externalSubscriptionId: "sub_webhook_1"
        }
      }
    });
    const entitlement = await harness.prisma.entitlement.findUniqueOrThrow({
      where: {
        organizationId: session.organization_id
      }
    });

    expect(storedEvent.status).toBe("PROCESSED");
    expect(storedEvent.attemptCount).toBe(1);
    expect(storedEvent.processedAt).not.toBeNull();
    expect(storedEvent.payloadJson).toMatchObject({
      provider: "stripe",
      external_event_id: event.id,
      payload: {
        customer_id: "cus_webhook_1",
        subscription_id: "sub_webhook_1",
        price_id: config.stripePriceIdProMonthly
      }
    });
    expect(JSON.stringify(storedEvent.payloadJson)).not.toContain("payment_method");
    expect(subscription.status).toBe("ACTIVE");
    expect(entitlement.code).toBe("PRO_ACTIVE");

    const duplicateResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": event.id
      },
      payload: JSON.stringify({
        id: event.id
      })
    });

    expect(duplicateResponse.statusCode).toBe(200);

    const webhookCount = await harness.prisma.webhookEvent.count();
    expect(webhookCount).toBe(1);
  });

  it("leaves failed webhook rows retryable and the retry job processes them once the payload is fixable", async () => {
    const session = await signIn("billing-webhook-retry@example.com");
    const event = buildSubscriptionEvent({
      id: "evt_subscription_failed_1",
      organizationId: session.organization_id,
      customerId: "cus_retry_1",
      subscriptionId: "sub_retry_1",
      priceId: "price_unknown",
      status: "active"
    });

    harness.stripeProvider.setWebhookEvent(event);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": event.id
      },
      payload: JSON.stringify({
        id: event.id
      })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("failed");

    const failedRow = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "STRIPE",
          externalEventId: event.id
        }
      }
    });

    expect(failedRow.status).toBe("FAILED");
    expect(failedRow.lastError).toContain("known plan");
    expect(failedRow.nextRetryAt).not.toBeNull();

    await harness.prisma.webhookEvent.update({
      where: {
        id: failedRow.id
      },
      data: {
        payloadJson: {
          ...(failedRow.payloadJson as Record<string, unknown>),
          payload: {
            ...((failedRow.payloadJson as { payload: Record<string, unknown> }).payload),
            price_id: config.stripePriceIdProMonthly
          }
        },
        nextRetryAt: new Date(Date.now() - 60_000)
      }
    });

    const retryResult = await runWebhookRetryJob(harness.prisma, {
      paddleProvider: harness.paddleProvider,
      stripeProvider: harness.stripeProvider,
      googlePlayProvider: harness.googlePlayProvider
    });
    const processedRow = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        id: failedRow.id
      }
    });

    expect(retryResult.processed).toBe(1);
    expect(processedRow.status).toBe("PROCESSED");

    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "STRIPE",
          externalSubscriptionId: "sub_retry_1"
        }
      }
    });

    expect(subscription.status).toBe("ACTIVE");
  });

  it("processes queued received rows and reclaims stale processing rows during retry execution", async () => {
    const firstSession = await signIn("billing-webhook-received@example.com");
    const secondSession = await signIn("billing-webhook-stale@example.com");
    const receivedEvent = buildSubscriptionEvent({
      id: "evt_received_retry_1",
      organizationId: firstSession.organization_id,
      customerId: "cus_received_1",
      subscriptionId: "sub_received_1",
      priceId: config.stripePriceIdProMonthly!,
      status: "trialing",
      trialEndsAt: new Date("2026-04-25T04:00:00.000Z")
    });
    const staleEvent = buildSubscriptionEvent({
      id: "evt_stale_retry_1",
      organizationId: secondSession.organization_id,
      customerId: "cus_stale_1",
      subscriptionId: "sub_stale_1",
      priceId: config.stripePriceIdProYearly!,
      status: "active"
    });

    await harness.prisma.webhookEvent.create({
      data: {
        provider: "STRIPE",
        externalEventId: receivedEvent.id,
        payloadJson: serializeWebhookEvent(receivedEvent),
        status: "RECEIVED",
        receivedAt: new Date("2026-03-26T04:00:00.000Z")
      }
    });
    await harness.prisma.webhookEvent.create({
      data: {
        provider: "STRIPE",
        externalEventId: staleEvent.id,
        payloadJson: serializeWebhookEvent(staleEvent),
        status: "PROCESSING",
        attemptCount: 1,
        lockToken: "stale-lock",
        lockedAt: new Date(Date.now() - ((config.billingWebhookStaleLockTimeoutSeconds + 60) * 1000)),
        receivedAt: new Date("2026-03-26T04:05:00.000Z")
      }
    });

    const retryResult = await runWebhookRetryJob(harness.prisma, {
      paddleProvider: harness.paddleProvider,
      stripeProvider: harness.stripeProvider,
      googlePlayProvider: harness.googlePlayProvider
    });
    const processedRows = await harness.prisma.webhookEvent.findMany({
      orderBy: {
        externalEventId: "asc"
      }
    });
    const receivedSubscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "STRIPE",
          externalSubscriptionId: "sub_received_1"
        }
      }
    });
    const staleSubscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "STRIPE",
          externalSubscriptionId: "sub_stale_1"
        }
      }
    });

    expect(retryResult.processed).toBe(2);
    expect(processedRows.map((row) => row.status)).toEqual(["PROCESSED", "PROCESSED"]);
    expect(receivedSubscription.status).toBe("TRIALING");
    expect(staleSubscription.status).toBe("ACTIVE");

    const firstEntitlement = await harness.prisma.entitlement.findUniqueOrThrow({
      where: {
        organizationId: firstSession.organization_id
      }
    });
    const secondEntitlement = await harness.prisma.entitlement.findUniqueOrThrow({
      where: {
        organizationId: secondSession.organization_id
      }
    });

    expect(firstEntitlement.code).toBe("TRIAL_ACTIVE");
    expect(secondEntitlement.code).toBe("PRO_ACTIVE");
  });
});
