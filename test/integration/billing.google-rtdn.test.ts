import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedPlans } from "../../prisma/seed";
import { getConfig } from "../../src/config/env";
import { runWebhookRetryJob } from "../../src/jobs/webhook-retry";
import { createTestHarness } from "../helpers/app";
import { resetDatabase } from "../helpers/db";

describe("google play RTDN processing", () => {
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

  async function getMonthlyPlan() {
    return harness.prisma.plan.findUniqueOrThrow({
      where: {
        code: "pro_monthly"
      }
    });
  }

  async function verifyGooglePurchase(input: {
    accessToken: string;
    purchaseToken: string;
    externalSubscriptionId: string;
  }) {
    const monthlyPlan = await getMonthlyPlan();

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: input.purchaseToken,
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: input.externalSubscriptionId,
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T14:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T14:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/billing/google-play/verify-subscription",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "idempotency-key": `verify-${input.purchaseToken}`
      },
      payload: {
        purchase_token: input.purchaseToken,
        product_id: monthlyPlan.googleProductId,
        base_plan_id: monthlyPlan.googleBasePlanId
      }
    });

    expect(response.statusCode).toBe(200);
    return monthlyPlan;
  }

  function buildRtdnPayload(input: {
    messageId: string;
    purchaseToken: string;
    notificationType: string;
    eventTime: string;
    publishedAt: string;
    packageName?: string;
  }) {
    const innerPayload = JSON.stringify({
      packageName: input.packageName ?? config.playPackageName,
      eventTimeMillis: String(new Date(input.eventTime).getTime()),
      subscriptionNotification: {
        purchaseToken: input.purchaseToken,
        notificationType: input.notificationType
      }
    });

    return JSON.stringify({
      message: {
        messageId: input.messageId,
        data: Buffer.from(innerPayload, "utf8").toString("base64"),
        publishTime: input.publishedAt
      }
    });
  }

  it("accepts trusted RTDN, stores a minimal snapshot, dedupes by Pub/Sub messageId, and keeps distinct messages processable", async () => {
    const session = await signIn("google-rtdn@example.com");

    await verifyGooglePurchase({
      accessToken: session.access_token,
      purchaseToken: "gp_token_rtdn_1",
      externalSubscriptionId: "gpsub_rtdn_1"
    });

    const firstResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_1",
        purchaseToken: "gp_token_rtdn_1",
        notificationType: "4",
        eventTime: "2026-03-26T14:05:00.000Z",
        publishedAt: "2026-03-26T14:05:10.000Z"
      })
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toEqual({
      accepted: true,
      event_id: "rtdn_msg_1",
      status: "processed"
    });

    const firstStoredEvent = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "GOOGLE_PLAY",
          externalEventId: "rtdn_msg_1"
        }
      }
    });
    const firstEntitlement = await harness.prisma.entitlement.findUniqueOrThrow({
      where: {
        organizationId: session.organization_id
      }
    });

    expect(firstStoredEvent.status).toBe("PROCESSED");
    expect(firstStoredEvent.payloadJson).toEqual({
      provider: "google_play",
      external_event_id: "rtdn_msg_1",
      message_id: "rtdn_msg_1",
      package_name: config.playPackageName,
      purchase_token: "gp_token_rtdn_1",
      notification_type: "4",
      event_time: "2026-03-26T14:05:00.000Z",
      published_at: "2026-03-26T14:05:10.000Z"
    });
    expect(JSON.stringify(firstStoredEvent.payloadJson)).not.toContain("subscriptionNotification");
    expect(firstEntitlement.code).toBe("PRO_ACTIVE");

    const duplicateResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_1",
        purchaseToken: "gp_token_rtdn_1",
        notificationType: "4",
        eventTime: "2026-03-26T14:05:00.000Z",
        publishedAt: "2026-03-26T14:05:10.000Z"
      })
    });

    expect(duplicateResponse.statusCode).toBe(200);

    const secondResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_2",
        purchaseToken: "gp_token_rtdn_1",
        notificationType: "13",
        eventTime: "2026-03-26T14:06:00.000Z",
        publishedAt: "2026-03-26T14:06:10.000Z"
      })
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json().status).toBe("processed");

    const storedEvents = await harness.prisma.webhookEvent.findMany({
      where: {
        provider: "GOOGLE_PLAY"
      },
      orderBy: {
        externalEventId: "asc"
      }
    });

    expect(storedEvents.map((event) => event.externalEventId)).toEqual([
      "rtdn_msg_1",
      "rtdn_msg_2"
    ]);
  });

  it("rejects untrusted RTDN deliveries without writing durable billing state", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token"
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_invalid",
        purchaseToken: "gp_token_invalid",
        notificationType: "1",
        eventTime: "2026-03-26T14:10:00.000Z",
        publishedAt: "2026-03-26T14:10:10.000Z"
      })
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_google_rtdn_token");

    const eventCount = await harness.prisma.webhookEvent.count({
      where: {
        provider: "GOOGLE_PLAY"
      }
    });

    expect(eventCount).toBe(0);
  });

  it("rejects malformed RTDN payloads with invalid_google_rtdn_payload and no durable writes", async () => {
    const malformedDecodedJson = Buffer.from("{not-json", "utf8").toString("base64");
    const missingPurchaseToken = Buffer.from(JSON.stringify({
      packageName: config.playPackageName,
      eventTimeMillis: "1774521000000",
      subscriptionNotification: {
        notificationType: "3"
      }
    }), "utf8").toString("base64");

    const payloads = [
      "{not-json",
      JSON.stringify({
        message: {
          messageId: "missing_data"
        }
      }),
      JSON.stringify({
        message: {
          messageId: "invalid_base64",
          data: "not-valid-base64"
        }
      }),
      JSON.stringify({
        message: {
          messageId: "invalid_decoded_json",
          data: malformedDecodedJson
        }
      }),
      JSON.stringify({
        message: {
          messageId: "missing_purchase_token",
          data: missingPurchaseToken
        }
      })
    ];

    for (const payload of payloads) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/webhooks/google-play/rtdn",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
        },
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_google_rtdn_payload");
    }

    const eventCount = await harness.prisma.webhookEvent.count({
      where: {
        provider: "GOOGLE_PLAY"
      }
    });

    expect(eventCount).toBe(0);
  });

  it("keeps canceled-but-unexpired Google subscriptions entitled when RTDN sync updates provider state", async () => {
    const session = await signIn("google-rtdn-canceled@example.com");
    const monthlyPlan = await verifyGooglePurchase({
      accessToken: session.access_token,
      purchaseToken: "gp_token_rtdn_canceled_1",
      externalSubscriptionId: "gpsub_rtdn_canceled_1"
    });

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_rtdn_canceled_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_rtdn_canceled_1",
      status: "CANCELED",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
      trialEndsAt: null,
      canceledAt: new Date("2026-03-26T00:00:00.000Z"),
      acknowledged: true,
      shouldAcknowledge: false
    });

    const rtdnResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_canceled_1",
        purchaseToken: "gp_token_rtdn_canceled_1",
        notificationType: "3",
        eventTime: "2026-03-26T14:15:00.000Z",
        publishedAt: "2026-03-26T14:15:10.000Z"
      })
    });
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

    expect(rtdnResponse.statusCode).toBe(200);
    expect(rtdnResponse.json()).toEqual({
      accepted: true,
      event_id: "rtdn_msg_canceled_1",
      status: "processed"
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

  it("leaves failed RTDN rows retryable and the retry job processes them once provider state is fixed", async () => {
    const session = await signIn("google-rtdn-retry@example.com");
    const monthlyPlan = await verifyGooglePurchase({
      accessToken: session.access_token,
      purchaseToken: "gp_token_rtdn_retry_1",
      externalSubscriptionId: "gpsub_rtdn_retry_1"
    });

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_rtdn_retry_1",
      linkedPurchaseToken: null,
      productId: "unknown.google.product",
      basePlanId: "unknown",
      externalSubscriptionId: "gpsub_rtdn_retry_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T14:20:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T14:20:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });

    const failedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/google-play/rtdn",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${harness.googlePlayProvider.validRtdnBearerToken}`
      },
      payload: buildRtdnPayload({
        messageId: "rtdn_msg_retry_1",
        purchaseToken: "gp_token_rtdn_retry_1",
        notificationType: "2",
        eventTime: "2026-03-26T14:21:00.000Z",
        publishedAt: "2026-03-26T14:21:10.000Z"
      })
    });

    expect(failedResponse.statusCode).toBe(200);
    expect(failedResponse.json()).toEqual({
      accepted: true,
      event_id: "rtdn_msg_retry_1",
      status: "failed"
    });

    const failedRow = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: "GOOGLE_PLAY",
          externalEventId: "rtdn_msg_retry_1"
        }
      }
    });

    expect(failedRow.status).toBe("FAILED");
    expect(failedRow.lastError).toContain("Billing plan is invalid.");
    expect(failedRow.nextRetryAt).not.toBeNull();

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_rtdn_retry_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_rtdn_retry_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T14:20:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T14:20:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });
    await harness.prisma.webhookEvent.update({
      where: {
        id: failedRow.id
      },
      data: {
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

  it("reclaims stale Google processing rows during retry execution", async () => {
    const session = await signIn("google-rtdn-stale@example.com");
    const monthlyPlan = await verifyGooglePurchase({
      accessToken: session.access_token,
      purchaseToken: "gp_token_rtdn_stale_1",
      externalSubscriptionId: "gpsub_rtdn_stale_1"
    });

    harness.googlePlayProvider.setSubscriptionState({
      packageName: config.playPackageName,
      purchaseToken: "gp_token_rtdn_stale_1",
      linkedPurchaseToken: null,
      productId: monthlyPlan.googleProductId!,
      basePlanId: monthlyPlan.googleBasePlanId,
      externalSubscriptionId: "gpsub_rtdn_stale_1",
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: new Date("2026-03-26T14:30:00.000Z"),
      currentPeriodEnd: new Date("2026-04-26T14:30:00.000Z"),
      trialEndsAt: null,
      canceledAt: null,
      acknowledged: true,
      shouldAcknowledge: false
    });

    const staleEvent = await harness.prisma.webhookEvent.create({
      data: {
        provider: "GOOGLE_PLAY",
        externalEventId: "rtdn_msg_stale_1",
        payloadJson: {
          provider: "google_play",
          external_event_id: "rtdn_msg_stale_1",
          message_id: "rtdn_msg_stale_1",
          package_name: config.playPackageName,
          purchase_token: "gp_token_rtdn_stale_1",
          notification_type: "3",
          event_time: "2026-03-26T14:30:00.000Z",
          published_at: "2026-03-26T14:30:10.000Z"
        },
        status: "PROCESSING",
        attemptCount: 1,
        lockToken: "stale-google-lock",
        lockedAt: new Date(
          Date.now() - ((config.billingWebhookStaleLockTimeoutSeconds + 60) * 1000)
        ),
        receivedAt: new Date("2026-03-26T14:30:15.000Z")
      }
    });

    const retryResult = await runWebhookRetryJob(harness.prisma, {
      paddleProvider: harness.paddleProvider,
      stripeProvider: harness.stripeProvider,
      googlePlayProvider: harness.googlePlayProvider
    });
    const processedRow = await harness.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        id: staleEvent.id
      }
    });
    const subscription = await harness.prisma.subscription.findUniqueOrThrow({
      where: {
        provider_externalSubscriptionId: {
          provider: "GOOGLE_PLAY",
          externalSubscriptionId: "gpsub_rtdn_stale_1"
        }
      }
    });

    expect(retryResult.processed).toBe(1);
    expect(processedRow.status).toBe("PROCESSED");
    expect(subscription.status).toBe("ACTIVE");
  });
});
