import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { getConfig } from "../../src/config/env";
import { runWebhookRetryJob } from "../../src/jobs/webhook-retry";
import type { PaddleWebhookEvent } from "../../src/modules/billing/provider";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("paddle webhook processing", () => {
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
  }): PaddleWebhookEvent {
    return {
      id: input.id,
      type: "subscription.updated",
      occurredAt: new Date("2026-03-27T02:00:00.000Z"),
      payload: {
        entityId: input.subscriptionId,
        status: input.status,
        customerId: input.customerId,
        subscriptionId: input.subscriptionId,
        transactionId: null,
        priceId: input.priceId,
        organizationId: input.organizationId,
        planCode: null,
        currencyCode: "usd",
        currentPeriodStart: new Date("2026-03-27T02:00:00.000Z"),
        currentPeriodEnd: new Date("2026-04-27T02:00:00.000Z"),
        startedAt: new Date("2026-03-27T02:00:00.000Z"),
        nextBilledAt: new Date("2026-04-27T02:00:00.000Z"),
        trialEndsAt: input.trialEndsAt ?? null,
        canceledAt: null
      }
    };
  }

  function serializeWebhookEvent(event: PaddleWebhookEvent) {
    return {
      provider: "paddle",
      external_event_id: event.id,
      type: event.type,
      occurred_at: event.occurredAt.toISOString(),
      payload: {
        entity_id: event.payload.entityId,
        status: event.payload.status,
        customer_id: event.payload.customerId,
        subscription_id: event.payload.subscriptionId,
        transaction_id: event.payload.transactionId,
        price_id: event.payload.priceId,
        organization_id: event.payload.organizationId,
        plan_code: event.payload.planCode,
        currency_code: event.payload.currencyCode,
        current_period_start: event.payload.currentPeriodStart?.toISOString() ?? null,
        current_period_end: event.payload.currentPeriodEnd?.toISOString() ?? null,
        started_at: event.payload.startedAt?.toISOString() ?? null,
        next_billed_at: event.payload.nextBilledAt?.toISOString() ?? null,
        trial_ends_at: event.payload.trialEndsAt?.toISOString() ?? null,
        canceled_at: event.payload.canceledAt?.toISOString() ?? null
      }
    };
  }

  it("verifies Paddle webhook signatures, persists a minimal snapshot, and updates billing state", async () => {
    const session = await signIn("billing-paddle-webhook@example.com");
    const event = buildSubscriptionEvent({
      id: "ntf_paddle_subscription_1",
      organizationId: session.organization_id,
      customerId: "ctm_webhook_1",
      subscriptionId: "sub_webhook_1",
      priceId: config.paddlePriceIdProMonthly,
      status: "active"
    });

    harness.paddleProvider.setWebhookEvent(event);

    const invalidSignatureResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/paddle",
      headers: {
        "content-type": "application/json",
        "paddle-signature": "h1=missing;ts=1"
      },
      payload: JSON.stringify({
        event_id: event.id
      })
    });

    expect(invalidSignatureResponse.statusCode).toBe(400);
    expect(invalidSignatureResponse.json().error.code).toBe("invalid_webhook_signature");

    const validResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/paddle",
      headers: {
        "content-type": "application/json",
        "paddle-signature": `ts=1;h1=${event.id}`
      },
      payload: JSON.stringify({
        event_id: event.id
      })
    });

    expect(validResponse.statusCode).toBe(200);
    expect(validResponse.json().status).toBe("processed");

    const storedEvent = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "PADDLE",
          externalEventId: event.id
        }
      }
    });
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "PADDLE",
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
    expect(storedEvent.payloadJson).toMatchObject({
      provider: "paddle",
      external_event_id: event.id,
      payload: {
        customer_id: "ctm_webhook_1",
        subscription_id: "sub_webhook_1",
        price_id: config.paddlePriceIdProMonthly
      }
    });
    expect(subscription.status).toBe("ACTIVE");
    expect(entitlement.code).toBe("PRO_ACTIVE");
  });

  it("leaves failed Paddle webhook rows retryable and the retry job processes them once the payload is fixable", async () => {
    const session = await signIn("billing-paddle-webhook-retry@example.com");
    const event = buildSubscriptionEvent({
      id: "ntf_paddle_subscription_failed_1",
      organizationId: session.organization_id,
      customerId: "ctm_retry_1",
      subscriptionId: "sub_retry_1",
      priceId: "price_unknown",
      status: "active"
    });

    harness.paddleProvider.setWebhookEvent(event);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/paddle",
      headers: {
        "content-type": "application/json",
        "paddle-signature": `ts=1;h1=${event.id}`
      },
      payload: JSON.stringify({
        event_id: event.id
      })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("failed");

    const failedRow = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "PADDLE",
          externalEventId: event.id
        }
      }
    });

    expect(failedRow.status).toBe("FAILED");
    expect(failedRow.lastError).toContain("known plan");

    await harness.prisma.webhookEvent.update({
      where: {
        id: failedRow.id
      },
      data: {
        payloadJson: {
          ...(failedRow.payloadJson as Record<string, unknown>),
          payload: {
            ...((failedRow.payloadJson as { payload: Record<string, unknown> }).payload),
            price_id: config.paddlePriceIdProMonthly
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
  });

  it("processes queued received rows and reclaims stale Paddle processing rows during retry execution", async () => {
    const firstSession = await signIn("billing-paddle-webhook-received@example.com");
    const secondSession = await signIn("billing-paddle-webhook-stale@example.com");
    const receivedEvent = buildSubscriptionEvent({
      id: "ntf_paddle_received_1",
      organizationId: firstSession.organization_id,
      customerId: "ctm_received_1",
      subscriptionId: "sub_received_1",
      priceId: config.paddlePriceIdProMonthly,
      status: "trialing",
      trialEndsAt: new Date("2026-04-27T02:00:00.000Z")
    });
    const staleEvent = buildSubscriptionEvent({
      id: "ntf_paddle_stale_1",
      organizationId: secondSession.organization_id,
      customerId: "ctm_stale_1",
      subscriptionId: "sub_stale_1",
      priceId: config.paddlePriceIdProYearly,
      status: "active"
    });

    await harness.prisma.webhookEvent.create({
      data: {
        provider: "PADDLE",
        externalEventId: receivedEvent.id,
        payloadJson: serializeWebhookEvent(receivedEvent),
        status: "RECEIVED",
        receivedAt: new Date("2026-03-27T02:00:00.000Z")
      }
    });
    await harness.prisma.webhookEvent.create({
      data: {
        provider: "PADDLE",
        externalEventId: staleEvent.id,
        payloadJson: serializeWebhookEvent(staleEvent),
        status: "PROCESSING",
        attemptCount: 1,
        lockToken: "stale-lock",
        lockedAt: new Date(Date.now() - ((config.billingWebhookStaleLockTimeoutSeconds + 60) * 1000)),
        receivedAt: new Date("2026-03-27T02:05:00.000Z")
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

    expect(retryResult.processed).toBe(2);
    expect(processedRows.map((row) => row.status)).toEqual(["PROCESSED", "PROCESSED"]);

    const receivedSubscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "PADDLE",
          externalSubscriptionId: "sub_received_1"
        }
      }
    });
    const staleSubscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "PADDLE",
          externalSubscriptionId: "sub_stale_1"
        }
      }
    });

    expect(receivedSubscription.status).toBe("TRIALING");
    expect(staleSubscription.status).toBe("ACTIVE");
  });
});
